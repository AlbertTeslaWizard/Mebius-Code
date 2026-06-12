import { BadGatewayException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { MessageRole } from '../../common/enums/message-role.enum';
import { PlanStatus } from '../../common/enums/plan-status.enum';
import { ApprovalStatus, ToolCallStatus } from '../../common/enums/tool-status.enum';
import { EventsService } from '../events/events.service';
import { ModelConfigsService, RuntimeModelConfig } from '../model-configs/model-configs.service';
import { AgentTurn, AgentTurnKind, AgentTurnStatus } from '../sessions/agent-turn.entity';
import { Message } from '../sessions/message.entity';
import { Session } from '../sessions/session.entity';
import { SessionsService } from '../sessions/sessions.service';
import { ToolCall } from '../tools/tool-call.entity';
import { ToolsService } from '../tools/tools.service';
import { User } from '../users/user.entity';
import { PendingToolResumeContext } from './agent-resume.types';
import { AgentService } from './agent.service';
import { OpenAiCompatibleService } from './openai-compatible.service';
import { PlanStep } from './plan-step.entity';
import { Plan } from './plan.entity';

describe('AgentService', () => {
  const session = { id: 'session-1', activeModelConfig: { id: 'config-1' } } as Session;
  const owner = { id: 'owner-1' } as User;
  const userMessage = messageFixture('message-user', MessageRole.User, 'Explain this project');

  const plans = {
    create: jest.fn((value) => value),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(() => createPlanQueryBuilder(() => plans.findOne({} as never))),
    save: jest.fn(async (value) => value),
  } as unknown as jest.Mocked<Repository<Plan>>;
  const planSteps = {
    create: jest.fn((value) => value),
    find: jest.fn(),
    save: jest.fn(async (value) => value),
  } as unknown as jest.Mocked<Repository<PlanStep>>;
  const sessions = {
    findOwned: jest.fn(),
    addMessage: jest.fn(),
    latestSummary: jest.fn(),
    listMessages: jest.fn(),
    findPendingApprovalTool: jest.fn(),
    createTurn: jest.fn(),
  } as unknown as jest.Mocked<SessionsService>;
  const modelConfigs = {
    findRuntime: jest.fn(),
  } as unknown as jest.Mocked<ModelConfigsService>;
  const llm = {
    chat: jest.fn(),
    streamChat: jest.fn(),
  } as unknown as jest.Mocked<OpenAiCompatibleService>;
  const tools = {
    requestOrExecute: jest.fn(),
    listAllowedCommands: jest.fn(),
    listMcpToolSpecs: jest.fn(),
    webSearchEnabled: jest.fn(),
  } as unknown as jest.Mocked<ToolsService>;
  const events = {
    publish: jest.fn(),
    complete: jest.fn(),
  } as unknown as jest.Mocked<EventsService>;
  const service = new AgentService(plans, planSteps, sessions, modelConfigs, llm, tools, events);

  beforeEach(() => {
    jest.clearAllMocks();
    sessions.findOwned.mockResolvedValue(session);
    sessions.createTurn.mockImplementation(async (targetSession, kind, metadata = {}) =>
      turnFixture(kind, targetSession, metadata),
    );
    sessions.addMessage.mockImplementation(async (_session, role, content, metadata = {}) =>
      messageFixture(
        `message-${String(role)}-${String(content)}`,
        role as Message['role'],
        content,
        metadata,
      ),
    );
    sessions.latestSummary.mockResolvedValue(null);
    sessions.listMessages.mockResolvedValue([userMessage]);
    sessions.findPendingApprovalTool.mockResolvedValue(null);
    tools.listAllowedCommands.mockResolvedValue([]);
    tools.listMcpToolSpecs.mockResolvedValue([]);
    tools.webSearchEnabled.mockReturnValue(false);
    plans.findOne.mockResolvedValue(null);
    plans.create.mockImplementation((value) => value as Plan);
    plans.save.mockImplementation(async (value) => value as Plan);
    planSteps.create.mockImplementation((value) => value as PlanStep);
    planSteps.find.mockResolvedValue([]);
    (planSteps.save as jest.Mock).mockImplementation(async (value: unknown) => value);
    modelConfigs.findRuntime.mockResolvedValue({
      id: 'config-1',
      displayName: 'Test config',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      modelName: 'gpt-test',
      providerId: null,
      supportsTools: true,
      isDefault: true,
      createdAt: new Date('2026-06-02T00:00:00.000Z'),
      updatedAt: new Date('2026-06-02T00:00:00.000Z'),
    } satisfies RuntimeModelConfig);
  });

  it('creates a plan with the original goal and publishes transcript plan events', async () => {
    llm.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        summary: 'Fix the Plan Mode approval flow.',
        markdown: '# Plan\n\nFix the Plan Mode approval flow.',
        steps: [
          { title: 'Inspect Plan Mode', detail: 'Find the current TUI state machine.' },
          { title: 'Add approval panel', detail: 'Render choices after the plan is ready.' },
        ],
        questions: [],
      }),
    });
    plans.save.mockImplementationOnce(async (value) => ({
      ...(value as Plan),
      id: 'plan-1',
      createdAt: new Date('2026-06-02T00:00:00.000Z'),
      updatedAt: new Date('2026-06-02T00:00:00.000Z'),
    }));
    (planSteps.save as jest.Mock).mockImplementationOnce(async (value: PlanStep[]) =>
      (value as PlanStep[]).map(
        (step, index) =>
          ({
            ...step,
            id: `step-${index + 1}`,
          }) as PlanStep,
      ),
    );

    const result = await service.createPlan(owner, session.id, {
      goal: 'Fix Plan Mode approval UX',
    });

    expect(plans.create).toHaveBeenCalledWith(
      expect.objectContaining({
        session,
        status: PlanStatus.PlanningGenerating,
        goal: 'Fix Plan Mode approval UX',
        summary: '',
      }),
    );
    expect(planSteps.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        plan: expect.objectContaining({ id: 'plan-1' }),
        order: 1,
        title: 'Inspect Plan Mode',
        detail: 'Find the current TUI state machine.',
      }),
    );
    expect(sessions.addMessage).toHaveBeenCalledWith(
      session,
      MessageRole.User,
      'Fix Plan Mode approval UX',
      { type: 'plan_prompt', planId: 'plan-1' },
      expect.objectContaining({ kind: AgentTurnKind.Plan }),
    );
    expect(sessions.addMessage).toHaveBeenCalledWith(
      session,
      MessageRole.Assistant,
      '# Plan\n\nFix the Plan Mode approval flow.',
      { type: 'plan_draft', planId: 'plan-1' },
      expect.objectContaining({ kind: AgentTurnKind.Plan }),
    );
    expect(events.publish).toHaveBeenCalledWith(
      session.id,
      'message_created',
      expect.objectContaining({
        role: MessageRole.Assistant,
        content: '# Plan\n\nFix the Plan Mode approval flow.',
      }),
    );
    expect(events.publish).toHaveBeenCalledWith(
      session.id,
      'plan_updated',
      expect.objectContaining({
        planId: 'plan-1',
        status: PlanStatus.PlanReadyPendingApproval,
        summary: 'Fix the Plan Mode approval flow.',
      }),
    );
    expect(result.plan).toEqual(
      expect.objectContaining({ id: 'plan-1', goal: 'Fix Plan Mode approval UX' }),
    );
    expect(result.steps).toHaveLength(2);
  });

  it('injects active skills into the plan model context', async () => {
    llm.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        summary: 'Explain recursion with Feynman style.',
        markdown: '# Plan\n\nExplain recursion clearly.',
        steps: [{ title: 'Explain recursion', detail: 'Use the active perspective.' }],
        questions: [],
      }),
    });

    await service.createPlan(owner, session.id, {
      goal: 'Explain recursion',
      activeSkills: [
        {
          name: 'feynman-perspective',
          source: 'claude',
          skillFile: 'C:\\Users\\12722\\.claude\\skills\\feynman-perspective\\SKILL.md',
          content: '# Feynman Perspective\n\nExplain with simple analogies.',
        },
      ],
    });

    expect(llm.chat.mock.calls[0]?.[0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('# Skill: feynman-perspective'),
        }),
      ]),
    );
    expect(llm.chat.mock.calls[0]?.[0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining(
            'Source: C:\\Users\\12722\\.claude\\skills\\feynman-perspective\\SKILL.md',
          ),
        }),
      ]),
    );
  });

  it('approves an owned plan and publishes a plan update', async () => {
    const plan = planFixture({ id: 'plan-1', status: PlanStatus.PlanReadyPendingApproval });
    plans.findOne.mockResolvedValueOnce(plan);

    const result = await service.approvePlan(owner, plan.id);

    expect(result.status).toBe(PlanStatus.Approved);
    expect(plans.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: plan.id, status: PlanStatus.Approved }),
    );
    expect(sessions.addMessage).toHaveBeenCalledWith(
      plan.session,
      MessageRole.Assistant,
      expect.stringContaining('# Approved Plan Snapshot'),
      { type: 'plan_final', planId: plan.id },
      expect.objectContaining({ kind: AgentTurnKind.PlanApproval }),
    );
    expect(events.publish).toHaveBeenCalledWith(session.id, 'plan_updated', {
      planId: plan.id,
      status: PlanStatus.Approved,
    });
  });

  it('returns approved plan from latestPlan with normalized status', async () => {
    const plan = planFixture({ id: 'plan-1', status: PlanStatus.Approved });
    plans.findOne.mockResolvedValueOnce(plan);
    planSteps.find.mockResolvedValueOnce([]);

    const result = await service.latestPlan(owner.id, session.id);

    expect(result).not.toBeNull();
    expect(result!.plan.status).toBe(PlanStatus.Approved);
  });

  it('returns plan_ready_pending_approval from latestPlan when plan is awaiting decision', async () => {
    const plan = planFixture({ id: 'plan-2', status: PlanStatus.PlanReadyPendingApproval });
    plans.findOne.mockResolvedValueOnce(plan);
    planSteps.find.mockResolvedValueOnce([]);

    const result = await service.latestPlan(owner.id, session.id);

    expect(result).not.toBeNull();
    expect(result!.plan.status).toBe(PlanStatus.PlanReadyPendingApproval);
  });

  it('normalizes legacy pending_approval status to plan_ready_pending_approval', async () => {
    const plan = planFixture({ id: 'plan-3', status: 'pending_approval' as PlanStatus });
    plans.findOne.mockResolvedValueOnce(plan);
    planSteps.find.mockResolvedValueOnce([]);

    const result = await service.latestPlan(owner.id, session.id);

    expect(result).not.toBeNull();
    expect(result!.plan.status).toBe(PlanStatus.PlanReadyPendingApproval);
  });

  it('normalizes legacy running/completed statuses to approved in latestPlan', async () => {
    for (const legacyStatus of ['running', 'completed'] as unknown as PlanStatus[]) {
      jest.clearAllMocks();
      sessions.findOwned.mockResolvedValueOnce(session);
      const plan = planFixture({ id: 'plan-legacy', status: legacyStatus });
      plans.findOne.mockResolvedValueOnce(plan);
      planSteps.find.mockResolvedValueOnce([]);

      const result = await service.latestPlan(owner.id, session.id);

      expect(result).not.toBeNull();
      expect(result!.plan.status).toBe(PlanStatus.Approved);
    }
  });

  it('cancels an owned plan and publishes a plan update', async () => {
    const plan = planFixture({ id: 'plan-1', status: PlanStatus.PlanReadyPendingApproval });
    plans.findOne.mockResolvedValueOnce(plan);

    const result = await service.cancelPlan(owner, plan.id);

    expect(result.status).toBe(PlanStatus.Cancelled);
    expect(plans.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: plan.id, status: PlanStatus.Cancelled }),
    );
    expect(events.publish).toHaveBeenCalledWith(session.id, 'plan_updated', {
      planId: plan.id,
      status: PlanStatus.Cancelled,
    });
  });

  it('runs an approved plan without mutating plan lifecycle status', async () => {
    const plan = planFixture({
      id: 'plan-1',
      status: PlanStatus.Approved,
      goal: 'Fix Plan Mode approval UX',
    });
    plans.findOne.mockResolvedValueOnce(plan);
    sessions.listMessages.mockResolvedValueOnce([
      messageFixture('message-plan-goal', MessageRole.User, plan.goal),
    ]);
    llm.streamChat.mockResolvedValueOnce({ content: 'Implemented the approved plan.' });

    const result = await service.run(owner, session.id, {
      message: plan.goal,
      approvedPlanId: plan.id,
    });

    expect(events.publish).not.toHaveBeenCalledWith(
      session.id,
      'plan_updated',
      expect.objectContaining({ planId: plan.id }),
    );
    expect(llm.streamChat.mock.calls[0][0].messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'user', content: plan.goal })]),
    );
    expect(result.assistant).toEqual(
      expect.objectContaining({ content: 'Implemented the approved plan.' }),
    );
  });

  it('rejects executing a plan that has not been approved', async () => {
    const plan = planFixture({ id: 'plan-1', status: PlanStatus.PlanReadyPendingApproval });
    plans.findOne.mockResolvedValueOnce(plan);

    await expect(
      service.run(owner, session.id, {
        message: 'Fix Plan Mode approval UX',
        approvedPlanId: plan.id,
      }),
    ).rejects.toThrow('Only approved plans can be executed.');

    expect(sessions.addMessage).not.toHaveBeenCalled();
    expect(llm.streamChat).not.toHaveBeenCalled();
  });

  it('continues the model turn after a non-approval tool call and saves a final answer', async () => {
    llm.streamChat
      .mockResolvedValueOnce({
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'list_files', arguments: '{"path":"."}' },
          },
        ],
      })
      .mockResolvedValueOnce({ content: 'Final project summary' });
    tools.requestOrExecute.mockResolvedValue(
      toolCallFixture({
        id: 'tool-1',
        name: 'list_files',
        status: ToolCallStatus.Succeeded,
        resultText: 'README.md\nsrc/main.ts',
      }),
    );

    const result = await service.run(owner, session.id, { message: 'Explain this project' });

    expect(llm.streamChat).toHaveBeenCalledTimes(2);
    expect(llm.streamChat.mock.calls[0][0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining(`Command runtime: platform ${process.platform}`),
        }),
      ]),
    );
    expect(llm.streamChat.mock.calls[1][0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          tool_calls: expect.arrayContaining([expect.objectContaining({ id: 'call-1' })]),
        }),
        expect.objectContaining({
          role: 'tool',
          tool_call_id: 'call-1',
          content: 'README.md\nsrc/main.ts',
        }),
      ]),
    );
    expect(sessions.addMessage).toHaveBeenNthCalledWith(
      2,
      session,
      'tool',
      'README.md\nsrc/main.ts',
      expect.objectContaining({
        kind: 'tool_result',
        toolCallId: 'call-1',
        toolName: 'list_files',
        status: ToolCallStatus.Succeeded,
      }),
      expect.objectContaining({ kind: AgentTurnKind.Chat }),
    );
    expect(sessions.addMessage).toHaveBeenLastCalledWith(
      session,
      'assistant',
      'Final project summary',
      {},
      expect.objectContaining({ kind: AgentTurnKind.Chat }),
    );
    expect(events.publish).toHaveBeenCalledWith(session.id, 'agent_status', {
      status: 'completed',
    });
    expect(events.complete).toHaveBeenCalledWith(session.id);
    expect(result.assistant).toEqual(
      expect.objectContaining({
        role: MessageRole.Assistant,
        content: 'Final project summary',
      }),
    );
  });

  it('injects active skills into the model system context for the run', async () => {
    llm.streamChat.mockResolvedValueOnce({ content: 'Used the skill.' });

    await service.run(owner, session.id, {
      message: 'Build a better UI',
      activeSkills: [
        {
          name: 'frontend-design',
          source: 'claude',
          skillFile: '~/.claude/skills/frontend-design/SKILL.md',
          content: '# Frontend Design\n\nUse refined production UI patterns.',
        },
      ],
    });

    expect(llm.streamChat.mock.calls[0][0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('# Skill: frontend-design'),
        }),
      ]),
    );
    expect(llm.streamChat.mock.calls[0][0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('Source: ~/.claude/skills/frontend-design/SKILL.md'),
        }),
      ]),
    );
  });

  it('exposes web_search to the model when web search is enabled', async () => {
    tools.webSearchEnabled.mockReturnValue(true);
    llm.streamChat.mockResolvedValueOnce({ content: 'Searched the web.' });

    await service.run(owner, session.id, { message: 'Find the latest NestJS release' });

    expect(llm.streamChat.mock.calls[0][0].tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function: expect.objectContaining({ name: 'web_search' }),
        }),
      ]),
    );
    expect(llm.streamChat.mock.calls[0][0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining(
            'Use web_search when a task needs current public information',
          ),
        }),
      ]),
    );
  });

  it('exposes enabled MCP tools to the model context', async () => {
    tools.listMcpToolSpecs.mockResolvedValueOnce([
      {
        type: 'function',
        function: {
          name: 'mcp__context7__query-docs',
          description: '[MCP:context7] Retrieve current library documentation.',
          parameters: {
            type: 'object',
            properties: {
              libraryId: { type: 'string' },
              query: { type: 'string' },
            },
          },
        },
      },
    ]);
    llm.streamChat.mockResolvedValueOnce({ content: 'Used Context7 docs.' });

    await service.run(owner, session.id, { message: 'Use current NestJS docs' });

    expect(llm.streamChat.mock.calls[0][0].tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function: expect.objectContaining({ name: 'mcp__context7__query-docs' }),
        }),
      ]),
    );
    expect(llm.streamChat.mock.calls[0][0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('MCP tools are available for external context'),
        }),
      ]),
    );
    expect(llm.streamChat.mock.calls[0][0].messages[0].content).not.toContain('or MCP tools');
  });

  it('publishes model diagnostic events without exposing credentials', async () => {
    llm.streamChat.mockResolvedValueOnce({ content: 'Final project summary' });

    await service.run(owner, session.id, { message: 'Explain this project' });

    expect(events.publish).toHaveBeenCalledWith(
      session.id,
      'model_call_started',
      expect.objectContaining({
        mode: 'chat',
        turn: 0,
        modelConfigId: 'config-1',
        displayName: 'Test config',
        modelName: 'gpt-test',
        baseUrl: 'https://api.example.com/v1',
      }),
    );
    expect(events.publish).toHaveBeenCalledWith(
      session.id,
      'model_call_completed',
      expect.objectContaining({
        mode: 'chat',
        turn: 0,
        modelConfigId: 'config-1',
        durationMs: expect.any(Number),
      }),
    );
    const diagnosticEvents = events.publish.mock.calls.filter(([, type]) =>
      String(type).startsWith('model_call_'),
    );
    expect(JSON.stringify(diagnosticEvents)).not.toContain('sk-test');
  });

  it('publishes a responding status when the model call falls back from streaming', async () => {
    llm.streamChat.mockImplementationOnce(async (_input, _onToken, options) => {
      options?.onStreamFallback?.({ reason: 'interrupted' });
      return { content: 'Recovered with non-streaming chat' };
    });

    await service.run(owner, session.id, { message: 'Write a file' });

    expect(events.publish).toHaveBeenCalledWith(session.id, 'stream_fallback', {
      reason: 'interrupted',
      provider: 'Test config',
      model: 'gpt-test',
    });
    expect(events.publish).toHaveBeenCalledWith(session.id, 'agent_status', {
      status: 'responding',
      activity: 'stream_fallback',
      reason: 'interrupted',
    });
    expect(sessions.addMessage).toHaveBeenLastCalledWith(
      session,
      'assistant',
      'Recovered with non-streaming chat',
      {},
      expect.objectContaining({ kind: AgentTurnKind.Chat }),
    );
  });

  it('publishes stream interruption diagnostics when content started before stream failure', async () => {
    llm.streamChat.mockImplementationOnce(async (_input, onToken, options) => {
      onToken({ delta: 'Partial', content: 'Partial' });
      options?.onStreamInterrupted?.({
        reason: 'interrupted',
        message: 'Model stream was interrupted. Please retry.',
      });
      throw new BadGatewayException('Model stream was interrupted. Please retry.');
    });

    await expect(service.run(owner, session.id, { message: 'Write a file' })).rejects.toThrow(
      'Model stream was interrupted. Please retry.',
    );

    expect(events.publish).toHaveBeenCalledWith(session.id, 'token', {
      delta: 'Partial',
      content: 'Partial',
    });
    expect(events.publish).toHaveBeenCalledWith(session.id, 'stream_interrupted', {
      reason: 'interrupted',
      message: 'Model stream was interrupted. Please retry.',
      provider: 'Test config',
      model: 'gpt-test',
    });
  });

  it('publishes failed status and completes the event stream when the model stream is interrupted', async () => {
    llm.streamChat.mockRejectedValueOnce(
      new BadGatewayException('Model stream was interrupted. Please retry.'),
    );

    await expect(service.run(owner, session.id, { message: 'Write a file' })).rejects.toThrow(
      'Model stream was interrupted. Please retry.',
    );

    expect(events.publish).toHaveBeenCalledWith(
      session.id,
      'model_call_failed',
      expect.objectContaining({
        mode: 'chat',
        turn: 0,
        message: 'Model stream was interrupted. Please retry.',
      }),
    );
    expect(events.publish).toHaveBeenCalledWith(session.id, 'agent_status', {
      status: 'failed',
      message: 'Model stream was interrupted. Please retry.',
    });
    expect(events.complete).toHaveBeenCalledWith(session.id);
  });

  it('stops visibly when a tool call requires approval', async () => {
    const assistantToolTurnMessage = messageFixture(
      'message-assistant-tool-turn',
      MessageRole.Assistant,
      '先查看一下仓库结构，再决定是否执行命令。',
      {
        kind: 'assistant_tool_turn',
        reasoningContent: 'Need to inspect the workspace before running the command.',
        toolCalls: [
          {
            id: 'call-approval',
            type: 'function',
            function: { name: 'run_command', arguments: '{"command":"npm test"}' },
          },
        ],
      },
    );
    sessions.addMessage.mockReset();
    sessions.addMessage
      .mockResolvedValueOnce(userMessage)
      .mockResolvedValueOnce(assistantToolTurnMessage);
    llm.streamChat.mockResolvedValueOnce({
      content: '先查看一下仓库结构，再决定是否执行命令。',
      tool_calls: [
        {
          id: 'call-approval',
          type: 'function',
          function: { name: 'run_command', arguments: '{"command":"npm test"}' },
        },
      ],
    });
    tools.requestOrExecute.mockResolvedValue(
      toolCallFixture({
        id: 'tool-approval',
        name: 'run_command',
        status: ToolCallStatus.PendingApproval,
      }),
    );

    const result = await service.run(owner, session.id, { message: 'Run tests' });

    expect(llm.streamChat).toHaveBeenCalledTimes(1);
    expect(sessions.addMessage).toHaveBeenNthCalledWith(
      2,
      session,
      'assistant',
      '先查看一下仓库结构，再决定是否执行命令。',
      expect.objectContaining({
        kind: 'assistant_tool_turn',
        toolCalls: expect.arrayContaining([expect.objectContaining({ id: 'call-approval' })]),
      }),
      expect.objectContaining({ kind: AgentTurnKind.Chat }),
    );
    expect(events.publish).toHaveBeenCalledWith(
      session.id,
      'agent_status',
      expect.objectContaining({
        status: 'waiting_for_approval',
        toolCallId: 'tool-approval',
        toolName: 'run_command',
      }),
    );
    expect(events.complete).toHaveBeenCalledWith(session.id);
    expect(result.assistant).toBeUndefined();
    expect(result.toolCalls).toHaveLength(1);
  });

  it('resumes the model turn after an approved tool call', async () => {
    sessions.listMessages.mockResolvedValue([
      userMessage,
      messageFixture('message-tool-turn', MessageRole.Assistant, 'I will patch the file now.', {
        kind: 'assistant_tool_turn',
        reasoningContent: 'Need to create the file before summarizing.',
        toolCalls: [
          {
            id: 'call-list',
            type: 'function',
            function: { name: 'list_files', arguments: '{"path":"."}' },
          },
          {
            id: 'call-patch',
            type: 'function',
            function: {
              name: 'create_patch',
              arguments: '{"path":"demo.py","content":"print(1)"}',
            },
          },
        ],
      }),
      messageFixture('message-tool-list', MessageRole.Tool, '["demo_1.py"]', {
        kind: 'tool_result',
        toolCallId: 'call-list',
        toolName: 'list_files',
        status: ToolCallStatus.Succeeded,
      }),
      messageFixture('message-tool-patch', MessageRole.Tool, 'Patch applied to demo.py.', {
        kind: 'tool_result',
        toolCallId: 'call-patch',
        toolName: 'create_patch',
        status: ToolCallStatus.Succeeded,
      }),
    ]);
    llm.streamChat.mockResolvedValueOnce({ content: 'Applied the requested file.' });
    const approvedToolCall = toolCallFixture({
      id: 'tool-approved',
      name: 'create_patch',
      status: ToolCallStatus.Succeeded,
      resultText: 'Patch applied to demo.py.',
    });
    approvedToolCall.session = session;
    const resumeContext: PendingToolResumeContext = {
      assistantContent: '',
      assistantReasoningContent: 'Need to create the file before summarizing.',
      assistantToolCalls: [
        {
          id: 'call-list',
          type: 'function',
          function: { name: 'list_files', arguments: '{"path":"."}' },
        },
        {
          id: 'call-patch',
          type: 'function',
          function: {
            name: 'create_patch',
            arguments: '{"path":"demo.py","content":"print(1)"}',
          },
        },
      ],
      priorToolMessages: [{ tool_call_id: 'call-list', content: '["demo_1.py"]' }],
      approvedToolCallId: 'call-patch',
    };

    await service.resumeAfterToolApproval(owner, approvedToolCall, resumeContext);

    expect(llm.streamChat).toHaveBeenCalledTimes(1);
    const resumedMessages = llm.streamChat.mock.calls[0][0].messages;
    expect(resumedMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'Explain this project' }),
        expect.objectContaining({
          role: 'assistant',
          content: 'I will patch the file now.',
          reasoning_content: 'Need to create the file before summarizing.',
          tool_calls: expect.arrayContaining([
            expect.objectContaining({ id: 'call-list' }),
            expect.objectContaining({ id: 'call-patch' }),
          ]),
        }),
        expect.objectContaining({
          role: 'tool',
          tool_call_id: 'call-list',
          content: '["demo_1.py"]',
        }),
        expect.objectContaining({
          role: 'tool',
          tool_call_id: 'call-patch',
          content: 'Patch applied to demo.py.',
        }),
      ]),
    );
    expect(
      resumedMessages.filter(
        (message) =>
          message.role === 'assistant' &&
          Array.isArray(message.tool_calls) &&
          message.tool_calls.some((toolCall) => toolCall.id === 'call-patch'),
      ),
    ).toHaveLength(1);
    expect(sessions.addMessage).toHaveBeenLastCalledWith(
      session,
      'assistant',
      'Applied the requested file.',
      {},
      undefined,
    );
    expect(events.publish).toHaveBeenCalledWith(session.id, 'agent_status', {
      status: 'completed',
    });
    expect(events.complete).toHaveBeenCalledWith(session.id);
  });

  it('publishes failed status when the resumed model turn is interrupted', async () => {
    llm.streamChat.mockRejectedValueOnce(
      new BadGatewayException('Model stream was interrupted. Please retry.'),
    );
    const approvedToolCall = toolCallFixture({
      id: 'tool-approved',
      name: 'create_patch',
      status: ToolCallStatus.Succeeded,
      resultText: 'Patch applied to demo.py.',
    });
    approvedToolCall.session = session;
    const resumeContext: PendingToolResumeContext = {
      assistantContent: '',
      assistantReasoningContent: 'Need to create the file before summarizing.',
      assistantToolCalls: [
        {
          id: 'call-patch',
          type: 'function',
          function: {
            name: 'create_patch',
            arguments: '{"path":"demo.py","content":"print(1)"}',
          },
        },
      ],
      priorToolMessages: [],
      approvedToolCallId: 'call-patch',
    };

    await expect(
      service.resumeAfterToolApproval(owner, approvedToolCall, resumeContext),
    ).rejects.toThrow('Model stream was interrupted. Please retry.');

    expect(events.publish).toHaveBeenCalledWith(session.id, 'agent_status', {
      status: 'failed',
      message: 'Model stream was interrupted. Please retry.',
    });
    expect(events.complete).toHaveBeenCalledWith(session.id);
  });

  it('blocks a new run when a tool approval is still pending', async () => {
    sessions.findPendingApprovalTool.mockResolvedValue({
      id: 'approval-1',
      status: ApprovalStatus.Pending,
      toolCall: { name: 'run_command' },
      requester: owner,
      createdAt: new Date('2026-06-02T00:00:00.000Z'),
      updatedAt: new Date('2026-06-02T00:00:00.000Z'),
    } as unknown as ReturnType<SessionsService['findPendingApprovalTool']> extends Promise<infer T>
      ? T
      : never);

    await expect(service.run(owner, session.id, { message: 'Can you continue?' })).rejects.toThrow(
      'A tool approval is still pending for run_command.',
    );

    expect(sessions.addMessage).not.toHaveBeenCalled();
    expect(llm.streamChat).not.toHaveBeenCalled();
  });

  it('reuses persisted tool messages when rebuilding history for a later run', async () => {
    sessions.listMessages.mockResolvedValue([
      userMessage,
      messageFixture('message-tool-turn', MessageRole.Assistant, 'I checked the workspace.', {
        kind: 'assistant_tool_turn',
        reasoningContent: 'Need repository structure first.',
        toolCalls: [
          {
            id: 'call-list',
            type: 'function',
            function: { name: 'list_files', arguments: '{"path":"."}' },
          },
        ],
      }),
      messageFixture('message-tool-result', MessageRole.Tool, '["demo_sarsa.py"]', {
        kind: 'tool_result',
        toolCallId: 'call-list',
        toolName: 'list_files',
        status: ToolCallStatus.Succeeded,
      }),
      messageFixture('message-final', MessageRole.Assistant, 'The file is in the project root.'),
      messageFixture('message-follow-up', MessageRole.User, 'Then why is it missing on GitHub?'),
    ]);
    llm.streamChat.mockResolvedValueOnce({
      content: 'The local file may not have been pushed yet.',
    });

    await service.run(owner, session.id, { message: 'Then why is it missing on GitHub?' });

    expect(llm.streamChat.mock.calls[0][0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: 'I checked the workspace.',
          tool_calls: expect.arrayContaining([expect.objectContaining({ id: 'call-list' })]),
        }),
        expect.objectContaining({
          role: 'tool',
          tool_call_id: 'call-list',
          content: '["demo_sarsa.py"]',
        }),
      ]),
    );
  });

  it('downgrades orphaned assistant tool calls to plain assistant history', async () => {
    sessions.listMessages.mockResolvedValue([
      userMessage,
      messageFixture('message-tool-turn', MessageRole.Assistant, 'I checked the workspace.', {
        kind: 'assistant_tool_turn',
        reasoningContent: 'Need repository structure first.',
        toolCalls: [
          {
            id: 'call-list',
            type: 'function',
            function: { name: 'list_files', arguments: '{"path":"."}' },
          },
        ],
      }),
      messageFixture('message-final', MessageRole.Assistant, 'The file is in the project root.'),
      messageFixture('message-follow-up', MessageRole.User, 'Then where is it stored?'),
    ]);
    llm.streamChat.mockResolvedValueOnce({
      content: 'It is stored in your local project workspace.',
    });

    await service.run(owner, session.id, { message: 'Then where is it stored?' });

    const rebuiltMessages = llm.streamChat.mock.calls[0][0].messages;
    expect(
      rebuiltMessages.filter(
        (message) => message.role === 'assistant' && Array.isArray(message.tool_calls),
      ),
    ).toHaveLength(0);
    expect(rebuiltMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: 'I checked the workspace.',
        }),
      ]),
    );
  });
});

function createPlanQueryBuilder(getOne: () => Promise<Plan | null>) {
  return {
    leftJoin: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn(getOne),
  };
}

function turnFixture(
  kind: AgentTurnKind,
  session: Message['session'],
  metadata: Record<string, unknown> = {},
): AgentTurn {
  return {
    id: `turn-${kind}`,
    session,
    kind,
    status: AgentTurnStatus.Active,
    metadata,
    undoneAt: null,
    createdAt: new Date('2026-06-02T00:00:00.000Z'),
    updatedAt: new Date('2026-06-02T00:00:00.000Z'),
  } as AgentTurn;
}

function planFixture(input: {
  id: string;
  status: PlanStatus;
  goal?: string;
  summary?: string;
}): Plan {
  return {
    id: input.id,
    session: { id: 'session-1' } as Session,
    status: input.status,
    goal: input.goal ?? 'Fix Plan Mode approval UX',
    summary: input.summary ?? 'Fix the Plan Mode approval flow.',
    draftMarkdown: '# Plan\n\nFix the Plan Mode approval flow.',
    finalMarkdown: null,
    questions: [],
    answers: [],
    clientRequestId: null,
    createdAt: new Date('2026-06-02T00:00:00.000Z'),
    updatedAt: new Date('2026-06-02T00:00:00.000Z'),
  } as Plan;
}

function messageFixture(
  id: string,
  role: Message['role'],
  content: string,
  metadata: Record<string, unknown> = {},
): Message {
  return {
    id,
    role,
    content,
    metadata,
    createdAt: new Date('2026-06-02T00:00:00.000Z'),
  } as Message;
}

function toolCallFixture(input: {
  id: string;
  name: string;
  status: ToolCallStatus;
  resultText?: string;
}): ToolCall {
  return {
    id: input.id,
    name: input.name,
    status: input.status,
    resultText: input.resultText,
    arguments: {},
    requiresApproval: input.status === ToolCallStatus.PendingApproval,
  } as ToolCall;
}
