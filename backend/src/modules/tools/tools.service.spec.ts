import { Repository } from 'typeorm';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import {
  ApprovalStatus,
  CommandRunStatus,
  FilePatchStatus,
  ToolCallStatus,
} from '../../common/enums/tool-status.enum';
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
  const patches = {
    create: jest.fn((value) => value),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(async (value) => value),
  } as unknown as jest.Mocked<Repository<FilePatch>>;
  const commandRuns = {
    create: jest.fn((value) => value),
    find: jest.fn(),
    save: jest.fn(async (value) => value),
  } as unknown as jest.Mocked<Repository<CommandRun>>;
  const sessions = {
    findOwned: jest.fn(),
  } as unknown as jest.Mocked<SessionsService>;
  const paths = {
    resolveProjectPath: jest.fn(),
    normalizeRelativePath: jest.fn(),
  } as unknown as jest.Mocked<PathSandboxService>;
  const commandPolicy = {
    parse: jest.fn(),
  } as unknown as jest.Mocked<CommandPolicyService>;
  const audit = {
    record: jest.fn(),
  } as unknown as jest.Mocked<AuditService>;
  const events = {
    publish: jest.fn(),
    complete: jest.fn(),
  } as unknown as jest.Mocked<EventsService>;
  const agent = {
    resumeAfterToolApproval: jest.fn().mockResolvedValue(undefined),
    recordToolResultMessage: jest.fn().mockResolvedValue(undefined),
    markLatestRunningPlanFailed: jest.fn().mockResolvedValue(undefined),
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
    sessions.findOwned.mockResolvedValue(session);
    paths.resolveProjectPath.mockImplementation((_root, path) => `D:/workspace/${path}`);
    paths.normalizeRelativePath.mockImplementation((path = '.') => path);
    patches.find.mockResolvedValue([
      {
        id: 'patch-1',
        project: session.project,
        session,
        toolCall: pendingToolCall,
        relativePath: 'demo.py',
        originalContent: '',
        patchedContent: 'print(1)',
        diffText: '--- demo.py\n+++ demo.py\n@@\n+print(1)',
        status: FilePatchStatus.Proposed,
        createdAt: new Date('2026-06-03T00:00:00.000Z'),
      } as FilePatch,
    ]);
    commandPolicy.parse.mockReturnValue({ command: 'npm', args: ['test'] });
    commandRuns.save.mockImplementation(async (value: any) => ({
      id: 'run-1',
      stdout: '',
      stderr: '',
      createdAt: new Date('2026-06-03T00:00:00.000Z'),
      ...value,
    }) as CommandRun);
    audit.record.mockResolvedValue({} as any);
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

  it('lists command runs for an owned session', async () => {
    commandRuns.find.mockResolvedValue([
      {
        id: 'run-1',
        session,
        command: 'npm test',
        cwd: 'D:/workspace',
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        status: CommandRunStatus.Succeeded,
        createdAt: new Date('2026-06-03T00:00:00.000Z'),
        toolCall: { id: 'tool-1', name: 'run_command', status: ToolCallStatus.Succeeded } as ToolCall,
      } as CommandRun,
    ]);

    const result = await service.listSessionCommandRuns(owner.id, session.id);

    expect(sessions.findOwned).toHaveBeenCalledWith(owner.id, session.id);
    expect(commandRuns.find).toHaveBeenCalledWith({
      where: { session: { id: session.id } },
      relations: { toolCall: true },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    expect(result[0]).toMatchObject({
      id: 'run-1',
      command: 'npm test',
      exitCode: 0,
      stdout: 'ok',
      status: CommandRunStatus.Succeeded,
      toolCall: { id: 'tool-1', name: 'run_command', status: ToolCallStatus.Succeeded },
    });
  });

  it('publishes command_started before command output', async () => {
    jest
      .spyOn(service as any, 'spawnCommand')
      .mockResolvedValue({ exitCode: 0, stdout: 'passed', stderr: '' });
    const toolCall = {
      id: 'tool-command',
      session,
      name: 'run_command',
      arguments: { command: 'npm test' },
    } as unknown as ToolCall;

    const result = await (service as any).runCommand(toolCall, owner, session.project, toolCall.arguments);

    expect(result).toContain('Command exited with 0');
    expect(events.publish).toHaveBeenCalledWith(
      session.id,
      'command_started',
      expect.objectContaining({
        id: 'run-1',
        command: 'npm test',
        status: CommandRunStatus.Running,
      }),
    );
    expect(events.publish).toHaveBeenCalledWith(
      session.id,
      'command_output',
      expect.objectContaining({
        commandRunId: 'run-1',
        command: 'npm test',
        exitCode: 0,
        stdout: 'passed',
      }),
    );
  });

  it('applies a multi-file patch set after validating snapshots', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'mebius-patch-'));
    try {
      await writeFile(join(workspace, 'existing.ts'), 'old', 'utf8');
      paths.resolveProjectPath.mockImplementation((root, path = '.') => resolve(root, path));
      patches.find.mockResolvedValueOnce([]);
      patches.create.mockImplementation((value) => value as FilePatch);
      patches.save.mockImplementation(async (value: any) => {
        if (Array.isArray(value)) {
          return value.map((patch, index) => ({
            id: `patch-${index + 1}`,
            createdAt: new Date('2026-06-03T00:00:00.000Z'),
            ...patch,
          }));
        }
        return value;
      });
      const project = { id: 'project-1', workspacePath: workspace } as any;
      const toolCall = {
        id: 'tool-patch',
        session,
        name: 'create_patch',
        arguments: {
          files: [
            { path: 'existing.ts', content: 'new' },
            { path: 'nested/created.ts', content: 'created' },
          ],
        },
      } as unknown as ToolCall;

      const result = await (service as any).applyPatch(toolCall, owner, project, toolCall.arguments);

      expect(result).toBe('Patch applied to existing.ts, nested/created.ts.');
      await expect(readFile(join(workspace, 'existing.ts'), 'utf8')).resolves.toBe('new');
      await expect(readFile(join(workspace, 'nested/created.ts'), 'utf8')).resolves.toBe('created');
      expect(audit.record).toHaveBeenCalledTimes(2);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('marks proposed patches conflicted without writing when snapshots changed', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'mebius-conflict-'));
    try {
      await writeFile(join(workspace, 'demo.ts'), 'changed', 'utf8');
      paths.resolveProjectPath.mockImplementation((root, path = '.') => resolve(root, path));
      const proposedPatch = {
        id: 'patch-conflict',
        project: { id: 'project-1', workspacePath: workspace },
        session,
        toolCall: pendingToolCall,
        relativePath: 'demo.ts',
        originalContent: 'old',
        patchedContent: 'new',
        diffText: 'diff',
        status: FilePatchStatus.Proposed,
        createdAt: new Date('2026-06-03T00:00:00.000Z'),
      } as FilePatch;
      patches.find.mockResolvedValueOnce([proposedPatch]);

      await expect(
        (service as any).applyPatch(pendingToolCall, owner, proposedPatch.project, pendingToolCall.arguments),
      ).rejects.toThrow('Patch conflict detected');

      expect(proposedPatch.status).toBe(FilePatchStatus.Conflicted);
      await expect(readFile(join(workspace, 'demo.ts'), 'utf8')).resolves.toBe('changed');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('reverts an applied patch when the file still matches patched content', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'mebius-revert-'));
    try {
      await writeFile(join(workspace, 'demo.ts'), 'new', 'utf8');
      paths.resolveProjectPath.mockImplementation((root, path = '.') => resolve(root, path));
      const patch = {
        id: 'patch-revert',
        project: { id: 'project-1', workspacePath: workspace },
        session,
        toolCall: pendingToolCall,
        relativePath: 'demo.ts',
        originalContent: 'old',
        patchedContent: 'new',
        diffText: 'diff',
        status: FilePatchStatus.Applied,
        createdAt: new Date('2026-06-03T00:00:00.000Z'),
      } as FilePatch;
      patches.findOne.mockResolvedValueOnce(patch);

      const result = await service.revertPatch(owner, patch.id);

      expect(result.status).toBe(FilePatchStatus.Reverted);
      await expect(readFile(join(workspace, 'demo.ts'), 'utf8')).resolves.toBe('old');
      expect(events.publish).toHaveBeenCalledWith(session.id, 'patch_reverted', {
        patchId: patch.id,
        path: patch.relativePath,
        status: FilePatchStatus.Reverted,
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
