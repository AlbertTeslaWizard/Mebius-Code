import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageRole } from '../../common/enums/message-role.enum';
import { PlanStatus } from '../../common/enums/plan-status.enum';
import { PlanStepStatus } from '../../common/enums/plan-step-status.enum';
import { EventsService } from '../events/events.service';
import { ModelConfigsService } from '../model-configs/model-configs.service';
import { Message } from '../sessions/message.entity';
import { SessionsService } from '../sessions/sessions.service';
import { User } from '../users/user.entity';
import { ToolsService } from '../tools/tools.service';
import { CODING_TOOL_SPECS } from '../tools/tool-specs';
import { CreatePlanDto } from './dto/create-plan.dto';
import { RunAgentDto } from './dto/run-agent.dto';
import { OpenAiCompatibleService } from './openai-compatible.service';
import { PlanStep } from './plan-step.entity';
import { Plan } from './plan.entity';

interface ParsedPlan {
  summary: string;
  steps: Array<{ title: string; detail?: string }>;
}

@Injectable()
export class AgentService {
  constructor(
    @InjectRepository(Plan)
    private readonly plans: Repository<Plan>,
    @InjectRepository(PlanStep)
    private readonly planSteps: Repository<PlanStep>,
    private readonly sessions: SessionsService,
    private readonly modelConfigs: ModelConfigsService,
    private readonly llm: OpenAiCompatibleService,
    private readonly tools: ToolsService,
    private readonly events: EventsService,
  ) {}

  async createPlan(owner: User, sessionId: string, dto: CreatePlanDto): Promise<{
    plan: Plan;
    steps: PlanStep[];
  }> {
    const session = await this.sessions.findOwned(owner.id, sessionId);
    const modelConfigId = dto.modelConfigId ?? session.activeModelConfig?.id;
    const config = await this.modelConfigs.findRuntime(owner.id, modelConfigId);
    const response = await this.llm.chat({
      config,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content:
            'You are Mebius Code Plan Mode. Return strict JSON with keys summary and steps. steps must be an array of {title, detail}. Do not execute tools.',
        },
        {
          role: 'user',
          content: dto.goal,
        },
      ],
    });
    const parsed = this.parsePlan(response.content ?? '', dto.goal);
    const plan = await this.plans.save(
      this.plans.create({
        session,
        status: PlanStatus.PendingApproval,
        summary: parsed.summary,
      }),
    );
    const steps = await this.planSteps.save(
      parsed.steps.map((step, index) =>
        this.planSteps.create({
          plan,
          order: index + 1,
          title: step.title,
          detail: step.detail,
          status: PlanStepStatus.Pending,
        }),
      ),
    );
    await this.sessions.addMessage(session, MessageRole.Assistant, parsed.summary, {
      type: 'plan',
      planId: plan.id,
    });
    this.events.publish(session.id, 'plan_updated', {
      planId: plan.id,
      status: plan.status,
      summary: plan.summary,
      steps,
    });
    return { plan, steps };
  }

  async approvePlan(owner: User, planId: string): Promise<Plan> {
    const plan = await this.findOwnedPlan(owner.id, planId);
    plan.status = PlanStatus.Approved;
    const saved = await this.plans.save(plan);
    this.events.publish(plan.session.id, 'plan_updated', {
      planId: plan.id,
      status: saved.status,
    });
    return saved;
  }

  async run(owner: User, sessionId: string, dto: RunAgentDto): Promise<{
    assistant?: Message;
    toolCalls: unknown[];
  }> {
    const session = await this.sessions.findOwned(owner.id, sessionId);
    if (dto.message) {
      await this.sessions.addMessage(session, MessageRole.User, dto.message);
    }

    const modelConfigId = dto.modelConfigId ?? session.activeModelConfig?.id;
    const config = await this.modelConfigs.findRuntime(owner.id, modelConfigId);
    const [summary, history] = await Promise.all([
      this.sessions.latestSummary(session.id),
      this.sessions.listMessages(owner.id, session.id),
    ]);

    this.events.publish(session.id, 'agent_status', { status: 'thinking' });
    const response = await this.llm.chat({
      config,
      messages: [
        {
          role: 'system',
          content:
            'You are Mebius Code, an agentic coding assistant. Prefer Plan Mode for risky work. Use tools when you need project context. Mutating tools require approval.',
        },
        ...(summary
          ? [
              {
                role: 'system' as const,
                content: summary.content,
              },
            ]
          : []),
        ...history.slice(-30).map((message) => ({
          role: this.mapRole(message.role),
          content: message.content,
        })),
      ],
      tools: CODING_TOOL_SPECS,
    });

    const toolCalls = response.tool_calls ?? [];
    if (toolCalls.length > 0) {
      const created = [];
      for (const toolCall of toolCalls) {
        created.push(
          await this.tools.requestOrExecute({
            owner,
            sessionId: session.id,
            name: toolCall.function.name,
            args: this.parseToolArguments(toolCall.function.arguments),
          }),
        );
      }
      return { toolCalls: created };
    }

    const content = response.content ?? '';
    const assistant = await this.sessions.addMessage(session, MessageRole.Assistant, content);
    this.events.publish(session.id, 'token', { content });
    this.events.complete(session.id);
    return { assistant, toolCalls: [] };
  }

  private async findOwnedPlan(ownerId: string, planId: string): Promise<Plan> {
    const plan = await this.plans.findOne({
      where: { id: planId, session: { owner: { id: ownerId } } },
      relations: { session: true },
    });
    if (!plan) {
      throw new NotFoundException('Plan not found.');
    }
    return plan;
  }

  private parsePlan(content: string, goal: string): ParsedPlan {
    try {
      const parsed = JSON.parse(content) as ParsedPlan;
      if (parsed.summary && Array.isArray(parsed.steps)) {
        return parsed;
      }
    } catch {
      // Fall through to deterministic plan.
    }

    return {
      summary: content || `Plan for: ${goal}`,
      steps: [
        { title: 'Understand the target project', detail: 'Inspect files and identify relevant modules.' },
        { title: 'Design the change', detail: 'Describe the implementation path before editing.' },
        { title: 'Apply approved edits', detail: 'Use patch tools only after approval.' },
        { title: 'Verify behavior', detail: 'Run allowlisted checks and summarize results.' },
      ],
    };
  }

  private parseToolArguments(payload: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      return parsed;
    } catch {
      throw new BadRequestException('Tool arguments are not valid JSON.');
    }
  }

  private mapRole(role: MessageRole): 'system' | 'user' | 'assistant' | 'tool' {
    if (role === MessageRole.User) return 'user';
    if (role === MessageRole.Assistant) return 'assistant';
    if (role === MessageRole.Tool) return 'tool';
    return 'system';
  }
}

