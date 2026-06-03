import { BadRequestException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageRole } from '../../common/enums/message-role.enum';
import { PlanStatus } from '../../common/enums/plan-status.enum';
import { PlanStepStatus } from '../../common/enums/plan-step-status.enum';
import { ToolCallStatus } from '../../common/enums/tool-status.enum';
import { EventsService } from '../events/events.service';
import { ModelConfigsService } from '../model-configs/model-configs.service';
import { Message } from '../sessions/message.entity';
import { SessionsService } from '../sessions/sessions.service';
import { User } from '../users/user.entity';
import { ToolsService } from '../tools/tools.service';
import { ToolCall } from '../tools/tool-call.entity';
import { CODING_TOOL_SPECS } from '../tools/tool-specs';
import { PendingToolMessage, PendingToolResumeContext } from './agent-resume.types';
import { CreatePlanDto } from './dto/create-plan.dto';
import { RunAgentDto } from './dto/run-agent.dto';
import { LlmMessage, LlmToolCall, OpenAiCompatibleService } from './openai-compatible.service';
import { PlanStep } from './plan-step.entity';
import { Plan } from './plan.entity';

interface ParsedPlan {
  summary: string;
  steps: Array<{ title: string; detail?: string }>;
}

interface AssistantToolTurnMetadata extends Record<string, unknown> {
  kind: 'assistant_tool_turn';
  reasoningContent?: string;
  toolCalls: LlmToolCall[];
}

interface ToolResultMessageMetadata extends Record<string, unknown> {
  kind: 'tool_result';
  toolCallId: string;
  toolName: string;
  status: string;
}

const MAX_TOOL_TURNS = 4;

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
    @Inject(forwardRef(() => ToolsService))
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

  async latestPlan(ownerId: string, sessionId: string): Promise<{
    plan: Plan;
    steps: PlanStep[];
  } | null> {
    const session = await this.sessions.findOwned(ownerId, sessionId);
    const plan = await this.plans.findOne({
      where: { session: { id: session.id } },
      order: { createdAt: 'DESC' },
    });
    if (!plan) {
      return null;
    }
    const steps = await this.planSteps.find({
      where: { plan: { id: plan.id } },
      order: { order: 'ASC' },
    });
    return { plan, steps };
  }

  async run(owner: User, sessionId: string, dto: RunAgentDto): Promise<{
    assistant?: Message;
    toolCalls: unknown[];
  }> {
    const session = await this.sessions.findOwned(owner.id, sessionId);
    const pendingApproval = await this.sessions.findPendingApprovalTool(session.id);
    if (pendingApproval?.toolCall) {
      throw new BadRequestException(
        `A tool approval is still pending for ${pendingApproval.toolCall.name}. Please approve or reject it before sending another message.`,
      );
    }
    try {
      if (dto.message) {
        const userMessage = await this.sessions.addMessage(session, MessageRole.User, dto.message);
        this.events.publish(session.id, 'message_created', {
          id: userMessage.id,
          role: userMessage.role,
          content: userMessage.content,
        });
      }

      const modelConfigId = dto.modelConfigId ?? session.activeModelConfig?.id;
      const config = await this.modelConfigs.findRuntime(owner.id, modelConfigId);
      const [summary, history] = await Promise.all([
        this.sessions.latestSummary(session.id),
        this.sessions.listMessages(owner.id, session.id),
      ]);
      const messages = this.buildModelMessages(summary?.content, history);
      return await this.continueRun(owner, session, config, messages, []);
    } catch (error) {
      this.events.publish(session.id, 'agent_status', {
        status: 'failed',
        message: error instanceof Error ? error.message : 'Agent run failed.',
      });
      this.events.complete(session.id);
      throw error;
    }
  }

  async resumeAfterToolApproval(
    owner: User,
    approvedToolCall: ToolCall,
    resumeContext: PendingToolResumeContext,
  ): Promise<void> {
    const sessionId = this.getSessionId(approvedToolCall.session);
    const session = await this.sessions.findOwned(owner.id, sessionId);
    const modelConfigId = session.activeModelConfig?.id;
    const config = await this.modelConfigs.findRuntime(owner.id, modelConfigId);
    const [summary, history] = await Promise.all([
      this.sessions.latestSummary(session.id),
      this.sessions.listMessages(owner.id, session.id),
    ]);
    const messages = this.buildModelMessages(summary?.content, history);
    if (!this.hasAssistantToolCall(messages, resumeContext.approvedToolCallId)) {
      messages.push({
        role: 'assistant',
        content: resumeContext.assistantContent ?? null,
        reasoning_content: resumeContext.assistantReasoningContent ?? null,
        tool_calls: resumeContext.assistantToolCalls,
      });
    }
    resumeContext.priorToolMessages.forEach((message) => {
      if (!this.hasToolMessage(messages, message.tool_call_id)) {
        messages.push({
          role: 'tool',
          tool_call_id: message.tool_call_id,
          content: message.content,
        });
      }
    });
    if (!this.hasToolMessage(messages, resumeContext.approvedToolCallId)) {
      messages.push({
        role: 'tool',
        tool_call_id: resumeContext.approvedToolCallId,
        content:
          approvedToolCall.resultText ??
          `Tool ${approvedToolCall.name} finished with status ${approvedToolCall.status}.`,
      });
    }

    await this.continueRun(owner, session, config, messages, [approvedToolCall], 'using_tools');
  }

  private async continueRun(
    owner: User,
    session: Message['session'],
    config: Awaited<ReturnType<ModelConfigsService['findRuntime']>>,
    messages: LlmMessage[],
    createdToolCalls: ToolCall[],
    initialStatus: 'thinking' | 'using_tools' = 'thinking',
  ): Promise<{
    assistant?: Message;
    toolCalls: unknown[];
  }> {
    for (let turn = 0; turn <= MAX_TOOL_TURNS; turn += 1) {
      this.events.publish(session.id, 'agent_status', {
        status: turn === 0 ? initialStatus : 'using_tools',
      });
      const response = await this.llm.streamChat(
        {
          config,
          messages,
          tools: CODING_TOOL_SPECS,
        },
        ({ delta, content }) => {
          this.events.publish(session.id, 'token', { delta, content });
        },
      );

      const toolCalls = response.tool_calls ?? [];
      if (toolCalls.length === 0) {
        const assistant = await this.saveAssistantResponse(session, response.content ?? '');
        this.events.publish(session.id, 'agent_status', { status: 'completed' });
        this.events.complete(session.id);
        return { assistant, toolCalls: createdToolCalls };
      }

      if (this.hasAssistantContent(response.content)) {
        await this.saveAssistantResponse(
          session,
          response.content,
          this.createAssistantToolTurnMetadata(response.reasoning_content, toolCalls),
        );
      }

      messages.push({
        role: 'assistant',
        content: response.content ?? null,
        reasoning_content: response.reasoning_content ?? null,
        tool_calls: toolCalls,
      });
      this.events.publish(session.id, 'agent_status', {
        status: 'using_tools',
        tools: toolCalls.map((toolCall) => toolCall.function.name),
      });

      const completedToolMessages: PendingToolMessage[] = [];

      for (const toolCall of toolCalls) {
        const parsedArgs = this.parseToolArguments(toolCall.function.arguments);
        let created: ToolCall;
        try {
          created = await this.tools.requestOrExecute({
            owner,
            sessionId: session.id,
            name: toolCall.function.name,
            args: parsedArgs,
            resumeContext: this.requiresApproval(toolCall.function.name)
              ? {
                  assistantContent: response.content ?? null,
                  assistantReasoningContent: response.reasoning_content ?? null,
                  assistantToolCalls: toolCalls,
                  priorToolMessages: [...completedToolMessages],
                  approvedToolCallId: toolCall.id,
                }
              : undefined,
          });
        } catch (error) {
          const failedToolMessage =
            error instanceof Error ? error.message : `Tool ${toolCall.function.name} failed.`;
          await this.recordToolResultMessage(
            session,
            toolCall.id,
            toolCall.function.name,
            ToolCallStatus.Failed,
            failedToolMessage,
          );
          throw error;
        }
        createdToolCalls.push(created);

        if (created.status === ToolCallStatus.PendingApproval) {
          this.events.publish(session.id, 'agent_status', {
            status: 'waiting_for_approval',
            toolCallId: created.id,
            toolName: created.name,
          });
          this.events.complete(session.id);
          return { toolCalls: createdToolCalls };
        }

        const toolMessageContent =
          created.resultText ?? `Tool ${created.name} finished with status ${created.status}.`;
        await this.recordToolResultMessage(
          session,
          toolCall.id,
          created.name,
          created.status,
          toolMessageContent,
        );
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolMessageContent,
        });
        completedToolMessages.push({
          tool_call_id: toolCall.id,
          content: toolMessageContent,
        });
      }
    }

    const assistant = await this.saveAssistantResponse(
      session,
      'I inspected the project, but the tool workflow did not finish within the configured turn limit. Please narrow the request or ask me to continue from the latest tool results.',
    );
    this.events.publish(session.id, 'agent_status', { status: 'completed' });
    this.events.complete(session.id);
    return { assistant, toolCalls: createdToolCalls };
  }

  private getSessionId(session: Message['session']): string {
    if (typeof session === 'string') {
      return session;
    }
    if (session && typeof session === 'object' && 'id' in session && typeof session.id === 'string') {
      return session.id;
    }
    throw new NotFoundException('Session not found for tool approval.');
  }

  private requiresApproval(toolName: string): boolean {
    return toolName === 'create_patch' || toolName === 'run_command';
  }

  private buildModelMessages(summary: string | undefined, history: Message[]): LlmMessage[] {
    return [
      {
        role: 'system',
        content:
          'You are Mebius Code, an agentic coding assistant. Prefer Plan Mode for risky work. Use tools when you need project context. Mutating tools require approval.',
      },
      ...(summary
        ? [
            {
              role: 'system' as const,
              content: summary,
            },
          ]
        : []),
      ...this.normalizeHistory(history.slice(-50)),
    ];
  }

  private async saveAssistantResponse(
    session: Message['session'],
    content: string,
    metadata: Record<string, unknown> = {},
  ): Promise<Message> {
    const assistant = await this.sessions.addMessage(session, MessageRole.Assistant, content, metadata);
    this.events.publish(session.id, 'message_created', {
      id: assistant.id,
      role: assistant.role,
      content: assistant.content,
    });
    return assistant;
  }

  async recordToolResultMessage(
    session: Message['session'],
    toolCallId: string,
    toolName: string,
    status: string,
    content: string,
  ): Promise<Message> {
    return this.sessions.addMessage(session, MessageRole.Tool, content, {
      kind: 'tool_result',
      toolCallId,
      toolName,
      status,
    } satisfies ToolResultMessageMetadata);
  }

  private normalizeHistory(history: Message[]): LlmMessage[] {
    const messages: LlmMessage[] = [];

    for (let index = 0; index < history.length; index += 1) {
      const message = history[index];
      if (message.role === MessageRole.Tool) {
        continue;
      }

      if (message.role !== MessageRole.Assistant) {
        messages.push({
          role: this.mapRole(message.role),
          content: message.content,
        });
        continue;
      }

      const assistantToolTurn = this.readAssistantToolTurnMetadata(message.metadata);
      if (!assistantToolTurn) {
        messages.push({
          role: 'assistant',
          content: message.content,
        });
        continue;
      }

      const toolMessages = this.collectSequentialToolMessages(history, index + 1, assistantToolTurn.toolCalls);
      if (toolMessages.length === assistantToolTurn.toolCalls.length) {
        messages.push({
          role: 'assistant',
          content: message.content,
          reasoning_content: assistantToolTurn.reasoningContent ?? null,
          tool_calls: assistantToolTurn.toolCalls,
        });
        toolMessages.forEach((toolMessage) => messages.push(toolMessage.llmMessage));
        index = toolMessages[toolMessages.length - 1]?.index ?? index;
        continue;
      }

      messages.push({
        role: 'assistant',
        content: message.content,
      });
    }

    return messages;
  }

  private hasAssistantContent(content: string | null | undefined): content is string {
    return typeof content === 'string' && content.trim().length > 0;
  }

  private createAssistantToolTurnMetadata(
    reasoningContent: string | null | undefined,
    toolCalls: LlmToolCall[],
  ): AssistantToolTurnMetadata {
    return {
      kind: 'assistant_tool_turn',
      reasoningContent: reasoningContent ?? undefined,
      toolCalls,
    };
  }

  private readAssistantToolTurnMetadata(
    metadata: Record<string, unknown> | null | undefined,
  ): AssistantToolTurnMetadata | null {
    if (!metadata || metadata.kind !== 'assistant_tool_turn' || !Array.isArray(metadata.toolCalls)) {
      return null;
    }

    const toolCalls = metadata.toolCalls.filter((toolCall): toolCall is LlmToolCall =>
      this.isLlmToolCall(toolCall),
    );
    if (toolCalls.length === 0) {
      return null;
    }

    return {
      kind: 'assistant_tool_turn',
      reasoningContent:
        typeof metadata.reasoningContent === 'string' ? metadata.reasoningContent : undefined,
      toolCalls,
    };
  }

  private readToolResultMessageMetadata(
    metadata: Record<string, unknown> | null | undefined,
  ): ToolResultMessageMetadata | null {
    if (!metadata || metadata.kind !== 'tool_result') {
      return null;
    }

    if (
      typeof metadata.toolCallId !== 'string' ||
      typeof metadata.toolName !== 'string' ||
      typeof metadata.status !== 'string'
    ) {
      return null;
    }

    return {
      kind: 'tool_result',
      toolCallId: metadata.toolCallId,
      toolName: metadata.toolName,
      status: metadata.status,
    };
  }

  private isLlmToolCall(value: unknown): value is LlmToolCall {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const toolCall = value as Partial<LlmToolCall>;
    return (
      typeof toolCall.id === 'string' &&
      toolCall.type === 'function' &&
      !!toolCall.function &&
      typeof toolCall.function.name === 'string' &&
      typeof toolCall.function.arguments === 'string'
    );
  }

  private hasAssistantToolCall(messages: LlmMessage[], toolCallId: string): boolean {
    return messages.some(
      (message) =>
        message.role === 'assistant' &&
        Array.isArray(message.tool_calls) &&
        message.tool_calls.some((toolCall) => toolCall.id === toolCallId),
    );
  }

  private hasToolMessage(messages: LlmMessage[], toolCallId: string): boolean {
    return messages.some(
      (message) => message.role === 'tool' && message.tool_call_id === toolCallId,
    );
  }

  private collectSequentialToolMessages(
    history: Message[],
    startIndex: number,
    toolCalls: LlmToolCall[],
  ): Array<{ index: number; llmMessage: LlmMessage }> {
    const requiredIds = new Set(toolCalls.map((toolCall) => toolCall.id));
    const seenIds = new Set<string>();
    const collected: Array<{ index: number; llmMessage: LlmMessage }> = [];

    for (let index = startIndex; index < history.length; index += 1) {
      const message = history[index];
      if (message.role !== MessageRole.Tool) {
        break;
      }

      const metadata = this.readToolResultMessageMetadata(message.metadata);
      if (!metadata || !requiredIds.has(metadata.toolCallId) || seenIds.has(metadata.toolCallId)) {
        break;
      }

      collected.push({
        index,
        llmMessage: {
          role: 'tool',
          tool_call_id: metadata.toolCallId,
          content: message.content,
        },
      });
      seenIds.add(metadata.toolCallId);
    }

    return seenIds.size === requiredIds.size ? collected : [];
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
