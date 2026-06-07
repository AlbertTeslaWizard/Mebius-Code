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
import { UserRole } from '../../common/enums/user-role.enum';
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
import { SessionCommandGrant } from './session-command-grant.entity';
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
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
  } as unknown as jest.Mocked<Repository<ToolCall>>;
  const approvals = {
    create: jest.fn((value) => value),
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
  const sessionCommandGrants = {
    create: jest.fn((value) => value),
    findOne: jest.fn(),
    remove: jest.fn(async (value) => value),
    save: jest.fn(async (value) => value),
  } as unknown as jest.Mocked<Repository<SessionCommandGrant>>;
  const sessions = {
    findOwned: jest.fn(),
  } as unknown as jest.Mocked<SessionsService>;
  const paths = {
    resolveProjectPath: jest.fn(),
    normalizeRelativePath: jest.fn(),
  } as unknown as jest.Mocked<PathSandboxService>;
  const commandPolicy = {
    inspect: jest.fn(),
    parse: jest.fn(),
    parseAuthorized: jest.fn(),
    rememberProjectCommand: jest.fn(),
    listAllowedCommands: jest.fn(),
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
    sessionCommandGrants,
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
    commandPolicy.inspect.mockResolvedValue({
      normalized: 'npm test',
      command: 'npm',
      args: ['test'],
      allowed: true,
      source: 'environment',
      executionMode: 'argv',
      shellTokens: [],
    });
    commandPolicy.parse.mockResolvedValue({ command: 'npm', args: ['test'], executionMode: 'argv' });
    commandPolicy.parseAuthorized.mockReturnValue({ command: 'npm', args: ['test'], executionMode: 'argv' });
    commandPolicy.listAllowedCommands.mockResolvedValue(['npm test']);
    sessionCommandGrants.findOne.mockResolvedValue(null);
    commandRuns.save.mockImplementation(async (value: any) => ({
      id: 'run-1',
      stdout: '',
      stderr: '',
      createdAt: new Date('2026-06-03T00:00:00.000Z'),
      ...value,
    }) as CommandRun);
    audit.record.mockResolvedValue({} as any);
  });

  it('publishes user-facing patch metadata while preparing an approval request', async () => {
    const result = await service.requestOrExecute({
      owner,
      sessionId: session.id,
      name: 'create_patch',
      args: { path: 'demo.py', content: 'print(1)' },
      resumeContext,
    });

    expect(result.status).toBe(ToolCallStatus.PendingApproval);
    expect(events.publish).toHaveBeenCalledWith(
      session.id,
      'agent_status',
      expect.objectContaining({
        status: 'using_tools',
        toolName: 'create_patch',
        activity: 'preparing_patch',
        targetPaths: ['demo.py'],
      }),
    );
    expect(events.publish).toHaveBeenCalledWith(
      session.id,
      'tool_call_requested',
      expect.objectContaining({
        name: 'create_patch',
        toolName: 'create_patch',
        activity: 'waiting_for_approval',
        targetPaths: ['demo.py'],
      }),
    );
  });

  it('creates an approval for a non-enabled command instead of failing before review', async () => {
    commandPolicy.inspect.mockResolvedValueOnce({
      normalized: 'python --version',
      command: 'python',
      args: ['--version'],
      allowed: false,
      executionMode: 'argv',
      shellTokens: [],
    });

    const result = await service.requestOrExecute({
      owner: { ...owner, role: UserRole.User },
      sessionId: session.id,
      name: 'run_command',
      args: { command: 'python --version' },
    });

    expect(result.status).toBe(ToolCallStatus.PendingApproval);
    expect(approvals.save).toHaveBeenCalled();
    expect(events.publish).toHaveBeenCalledWith(
      session.id,
      'tool_call_requested',
      expect.objectContaining({
        name: 'run_command',
        command: 'python --version',
      }),
    );
  });

  it('remembers an administrator-authorized command only after successful execution', async () => {
    const commandToolCall = {
      id: 'tool-command-approval',
      session,
      name: 'run_command',
      arguments: { command: 'python --version' },
      requiresApproval: true,
      status: ToolCallStatus.PendingApproval,
    } as unknown as ToolCall;
    approvals.findOne.mockResolvedValueOnce({
      id: 'approval-command',
      status: ApprovalStatus.Pending,
      toolCall: commandToolCall,
    } as ToolApproval);
    commandPolicy.inspect.mockResolvedValueOnce({
      normalized: 'python --version',
      command: 'python',
      args: ['--version'],
      allowed: false,
      executionMode: 'argv',
      shellTokens: [],
    });
    jest.spyOn(service as any, 'executeTool').mockResolvedValueOnce('Command exited with 0.');

    const admin = { ...owner, role: UserRole.Admin } as User;
    const result = await service.approve(admin, 'approval-command', 'project');

    expect(result.status).toBe(ToolCallStatus.Succeeded);
    expect(commandPolicy.rememberProjectCommand).toHaveBeenCalledWith(
      session.project,
      admin,
      'python --version',
    );
  });

  it('grants session command auto-run when approving with session_auto', async () => {
    const commandToolCall = {
      id: 'tool-command-approval',
      session,
      name: 'run_command',
      arguments: { command: 'npm test && npm run build' },
      requiresApproval: true,
      status: ToolCallStatus.PendingApproval,
    } as unknown as ToolCall;
    approvals.findOne.mockResolvedValueOnce({
      id: 'approval-command',
      status: ApprovalStatus.Pending,
      toolCall: commandToolCall,
    } as ToolApproval);
    commandPolicy.inspect.mockResolvedValueOnce({
      normalized: 'npm test && npm run build',
      command: 'npm test && npm run build',
      args: [],
      allowed: false,
      executionMode: 'shell',
      shellTokens: ['&&'],
    });
    jest.spyOn(service as any, 'executeTool').mockResolvedValueOnce('Command exited with 0.');

    const result = await service.approve(owner, 'approval-command', 'session_auto');

    expect(result.status).toBe(ToolCallStatus.Succeeded);
    expect(sessionCommandGrants.save).toHaveBeenCalledWith(
      expect.objectContaining({
        session,
        createdBy: owner,
        grantType: 'shell_autorun',
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'command_policy.session_shell_autorun_granted',
        resourceType: 'session',
        resourceId: session.id,
      }),
    );
  });

  it('auto-executes run_command when the session has a shell autorun grant', async () => {
    sessionCommandGrants.findOne.mockResolvedValue({
      id: 'grant-1',
      grantType: 'shell_autorun',
    } as SessionCommandGrant);
    jest.spyOn(service as any, 'executeTool').mockResolvedValueOnce('Command exited with 0.');

    const result = await service.requestOrExecute({
      owner,
      sessionId: session.id,
      name: 'run_command',
      args: { command: 'npm test && npm run build' },
    });

    expect(result.status).toBe(ToolCallStatus.Succeeded);
    expect(approvals.save).not.toHaveBeenCalled();
    expect((service as any).executeTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'run_command' }),
      owner,
      { commandAuthorized: true },
    );
  });

  it('continues the agent after approving a pending tool call with resume context', async () => {
    jest
      .spyOn(service as any, 'executeTool')
      .mockImplementation(async () => 'Patch applied to demo.py.');

    const result = await service.approve(owner, approval.id);

    expect(result.status).toBe(ToolCallStatus.Succeeded);
    expect(result.resultText).toBe('Patch applied to demo.py.');
    expect(events.publish).toHaveBeenCalledWith(
      session.id,
      'agent_status',
      expect.objectContaining({
        status: 'using_tools',
        toolName: pendingToolCall.name,
        tools: [pendingToolCall.name],
        activity: 'applying_patch',
        targetPaths: ['demo.py'],
      }),
    );
    expect(events.publish).toHaveBeenCalledWith(
      session.id,
      'tool_call_result',
      expect.objectContaining({
        toolCallId: pendingToolCall.id,
        name: pendingToolCall.name,
        result: 'Patch applied to demo.py.',
        status: ToolCallStatus.Succeeded,
        activity: 'patch_applied',
        targetPaths: ['demo.py'],
      }),
    );
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

  it('lists allowed commands for an owned session project', async () => {
    commandPolicy.listAllowedCommands.mockResolvedValueOnce(['npm test', 'python --version']);

    const result = await service.listSessionAllowedCommands(owner.id, session.id);

    expect(sessions.findOwned).toHaveBeenCalledWith(owner.id, session.id);
    expect(commandPolicy.listAllowedCommands).toHaveBeenCalledWith('project-1');
    expect(result).toEqual(['npm test', 'python --version']);
  });

  it('does not list allowed commands when session ownership fails', async () => {
    sessions.findOwned.mockRejectedValueOnce(new Error('Session not found.'));

    await expect(service.listSessionAllowedCommands(owner.id, 'missing-session')).rejects.toThrow('Session not found.');

    expect(commandPolicy.listAllowedCommands).not.toHaveBeenCalled();
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

  it('uses shell execution for authorized shell commands', async () => {
    commandPolicy.parseAuthorized.mockReturnValueOnce({
      command: 'npm test && npm run build',
      args: [],
      executionMode: 'shell',
    });
    jest
      .spyOn(service as any, 'spawnShellCommand')
      .mockResolvedValue({ exitCode: 0, stdout: 'passed', stderr: '' });
    const toolCall = {
      id: 'tool-command',
      session,
      name: 'run_command',
      arguments: { command: 'npm test && npm run build' },
    } as unknown as ToolCall;

    const result = await (service as any).runCommand(toolCall, owner, session.project, toolCall.arguments, true);

    expect(result).toContain('Command exited with 0');
    expect((service as any).spawnShellCommand).toHaveBeenCalledWith('npm test && npm run build', 'D:/workspace');
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
