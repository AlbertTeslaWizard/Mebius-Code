import { Repository } from 'typeorm';
import { MessageRole } from '../../common/enums/message-role.enum';
import { ApprovalStatus, ToolCallStatus } from '../../common/enums/tool-status.enum';
import { EventsService } from '../events/events.service';
import { ModelConfigsService, RuntimeModelConfig } from '../model-configs/model-configs.service';
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
  const assistantMessage = messageFixture(
    'message-assistant',
    MessageRole.Assistant,
    'Final project summary',
  );

  const plans = {} as jest.Mocked<Repository<Plan>>;
  const planSteps = {} as jest.Mocked<Repository<PlanStep>>;
  const sessions = {
    findOwned: jest.fn(),
    addMessage: jest.fn(),
    latestSummary: jest.fn(),
    listMessages: jest.fn(),
    findPendingApprovalTool: jest.fn(),
  } as unknown as jest.Mocked<SessionsService>;
  const modelConfigs = {
    findRuntime: jest.fn(),
  } as unknown as jest.Mocked<ModelConfigsService>;
  const llm = {
    streamChat: jest.fn(),
  } as unknown as jest.Mocked<OpenAiCompatibleService>;
  const tools = {
    requestOrExecute: jest.fn(),
  } as unknown as jest.Mocked<ToolsService>;
  const events = {
    publish: jest.fn(),
    complete: jest.fn(),
  } as unknown as jest.Mocked<EventsService>;
  const service = new AgentService(
    plans,
    planSteps,
    sessions,
    modelConfigs,
    llm,
    tools,
    events,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    sessions.findOwned.mockResolvedValue(session);
    sessions.addMessage.mockImplementation(async (_session, role, content, metadata = {}) =>
      messageFixture(`message-${String(role)}-${String(content)}`, role as Message['role'], content, metadata),
    );
    sessions.latestSummary.mockResolvedValue(null);
    sessions.listMessages.mockResolvedValue([userMessage]);
    sessions.findPendingApprovalTool.mockResolvedValue(null);
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
    expect(llm.streamChat.mock.calls[1][0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          tool_calls: expect.arrayContaining([
            expect.objectContaining({ id: 'call-1' }),
          ]),
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
    );
    expect(sessions.addMessage).toHaveBeenLastCalledWith(
      session,
      'assistant',
      'Final project summary',
      {},
    );
    expect(events.publish).toHaveBeenCalledWith(session.id, 'agent_status', { status: 'completed' });
    expect(events.complete).toHaveBeenCalledWith(session.id);
    expect(result.assistant).toEqual(
      expect.objectContaining({
        role: MessageRole.Assistant,
        content: 'Final project summary',
      }),
    );
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
    );
    expect(events.publish).toHaveBeenCalledWith(session.id, 'agent_status', { status: 'completed' });
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
    llm.streamChat.mockResolvedValueOnce({ content: 'The local file may not have been pushed yet.' });

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
    llm.streamChat.mockResolvedValueOnce({ content: 'It is stored in your local project workspace.' });

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
