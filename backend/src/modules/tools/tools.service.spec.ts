import { Repository } from 'typeorm';
import { ApprovalStatus, ToolCallStatus } from '../../common/enums/tool-status.enum';
import { CommandPolicyService } from '../../common/security/command-policy.service';
import { PathSandboxService } from '../../common/security/path-sandbox.service';
import { AgentService } from '../agent/agent.service';
import { PendingToolResumeContext } from '../agent/agent-resume.types';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { Session } from '../sessions/session.entity';
import { SessionsService } from '../sessions/sessions.service';
import { User } from '../users/user.entity';
import { CommandRun } from './command-run.entity';
import { FilePatch } from './file-patch.entity';
import { ToolApproval } from './tool-approval.entity';
import { ToolCall } from './tool-call.entity';
import { ToolsService } from './tools.service';

describe('ToolsService', () => {
  const owner = { id: 'owner-1' } as User;
  const session = { id: 'session-1', project: { id: 'project-1', workspacePath: 'D:/workspace' } } as Session;
  const resumeContext: PendingToolResumeContext = {
    assistantContent: '',
    assistantReasoningContent: 'Apply the patch and then summarize.',
    assistantToolCalls: [
      {
        id: 'provider-call',
        type: 'function',
        function: {
          name: 'create_patch',
          arguments: '{"path":"demo.py","content":"print(1)"}',
        },
      },
    ],
    priorToolMessages: [],
    approvedToolCallId: 'provider-call',
  };
  const pendingToolCall = {
    id: 'tool-1',
    session,
    name: 'create_patch',
    arguments: { path: 'demo.py', content: 'print(1)' },
    requiresApproval: true,
    status: ToolCallStatus.PendingApproval,
    resultText: JSON.stringify({ kind: 'pending_tool_resume', payload: resumeContext }),
  } as unknown as ToolCall;
  const approval = {
    id: 'approval-1',
    status: ApprovalStatus.Pending,
    toolCall: pendingToolCall,
  } as ToolApproval;

  const toolCalls = {
    save: jest.fn(async (value) => value),
  } as unknown as jest.Mocked<Repository<ToolCall>>;
  const approvals = {
    findOne: jest.fn(),
    save: jest.fn(async (value) => value),
  } as unknown as jest.Mocked<Repository<ToolApproval>>;
  const patches = {} as jest.Mocked<Repository<FilePatch>>;
  const commandRuns = {} as jest.Mocked<Repository<CommandRun>>;
  const sessions = {} as jest.Mocked<SessionsService>;
  const paths = {} as jest.Mocked<PathSandboxService>;
  const commandPolicy = {} as jest.Mocked<CommandPolicyService>;
  const audit = {} as jest.Mocked<AuditService>;
  const events = {
    publish: jest.fn(),
    complete: jest.fn(),
  } as unknown as jest.Mocked<EventsService>;
  const agent = {
    resumeAfterToolApproval: jest.fn().mockResolvedValue(undefined),
    recordToolResultMessage: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AgentService>;
  const service = new ToolsService(
    toolCalls,
    approvals,
    patches,
    commandRuns,
    sessions,
    paths,
    commandPolicy,
    audit,
    events,
    agent,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    pendingToolCall.status = ToolCallStatus.PendingApproval;
    pendingToolCall.resultText = JSON.stringify({ kind: 'pending_tool_resume', payload: resumeContext });
    approvals.findOne.mockResolvedValue(approval);
  });

  it('continues the agent after approving a pending tool call with resume context', async () => {
    jest
      .spyOn(service as any, 'executeTool')
      .mockImplementation(async () => 'Patch applied to demo.py.');

    const result = await service.approve(owner, approval.id);

    expect(result.status).toBe(ToolCallStatus.Succeeded);
    expect(result.resultText).toBe('Patch applied to demo.py.');
    expect(events.publish).toHaveBeenCalledWith(session.id, 'agent_status', {
      status: 'using_tools',
      toolName: pendingToolCall.name,
      tools: [pendingToolCall.name],
    });
    expect(events.publish).toHaveBeenCalledWith(session.id, 'tool_call_result', {
      toolCallId: pendingToolCall.id,
      name: pendingToolCall.name,
      result: 'Patch applied to demo.py.',
    });
    expect(agent.recordToolResultMessage).toHaveBeenCalledWith(
      session,
      'provider-call',
      pendingToolCall.name,
      ToolCallStatus.Succeeded,
      'Patch applied to demo.py.',
    );
    expect(agent.resumeAfterToolApproval).toHaveBeenCalledWith(owner, result, resumeContext);
  });

  it('publishes failure state and completes the stream when approved tool execution fails', async () => {
    jest.spyOn(service as any, 'executeTool').mockRejectedValue(new Error('boom'));

    const result = await service.approve(owner, approval.id);

    expect(result.status).toBe(ToolCallStatus.Failed);
    expect(events.publish).toHaveBeenCalledWith(session.id, 'agent_status', {
      status: 'failed',
      message: 'boom',
    });
    expect(agent.recordToolResultMessage).toHaveBeenCalledWith(
      session,
      'provider-call',
      pendingToolCall.name,
      ToolCallStatus.Failed,
      'boom',
    );
    expect(events.complete).toHaveBeenCalledWith(session.id);
  });

  it('publishes completion and completes the stream when approval is rejected', async () => {
    const result = await service.reject(owner, approval.id);

    expect(result.status).toBe(ApprovalStatus.Rejected);
    expect(agent.recordToolResultMessage).toHaveBeenCalledWith(
      session,
      'provider-call',
      pendingToolCall.name,
      ToolCallStatus.Rejected,
      'Tool create_patch was rejected by the user.',
    );
    expect(events.publish).toHaveBeenCalledWith(session.id, 'agent_status', {
      status: 'completed',
    });
    expect(events.complete).toHaveBeenCalledWith(session.id);
  });
});
