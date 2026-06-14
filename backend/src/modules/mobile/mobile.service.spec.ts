import { Repository } from 'typeorm';
import { PlanStatus } from '../../common/enums/plan-status.enum';
import { PermissionMode } from '../../common/enums/permission-mode.enum';
import { SessionStatus } from '../../common/enums/session-status.enum';
import { ApprovalStatus, ToolCallStatus } from '../../common/enums/tool-status.enum';
import { AuthService } from '../auth/auth.service';
import { Plan } from '../agent/plan.entity';
import { ModelConfigsService } from '../model-configs/model-configs.service';
import { Project, ProjectSourceType, ProjectWorkspaceMode } from '../projects/project.entity';
import { Session } from '../sessions/session.entity';
import { SystemService } from '../system/system.service';
import { ToolApproval } from '../tools/tool-approval.entity';
import { ToolCall } from '../tools/tool-call.entity';
import { User } from '../users/user.entity';
import { MobileService } from './mobile.service';

describe('MobileService', () => {
  const projects = {
    find: jest.fn(),
  } as unknown as jest.Mocked<Repository<Project>>;
  const sessions = {
    find: jest.fn(),
  } as unknown as jest.Mocked<Repository<Session>>;
  const plans = {
    find: jest.fn(),
  } as unknown as jest.Mocked<Repository<Plan>>;
  const approvals = {
    find: jest.fn(),
  } as unknown as jest.Mocked<Repository<ToolApproval>>;
  const toolCalls = {
    find: jest.fn(),
  } as unknown as jest.Mocked<Repository<ToolCall>>;
  const auth = {
    currentUser: jest.fn(),
  } as unknown as jest.Mocked<AuthService>;
  const system = {
    capabilities: jest.fn(),
  } as unknown as jest.Mocked<SystemService>;
  const modelConfigs = {
    sanitize: jest.fn((config) => ({
      id: config.id,
      displayName: config.displayName,
      baseUrl: config.baseUrl,
      modelName: config.modelName,
      providerId: config.providerId ?? null,
      supportsTools: config.supportsTools,
      isDefault: config.isDefault,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    })),
  } as unknown as jest.Mocked<ModelConfigsService>;

  const service = new MobileService(
    projects,
    sessions,
    plans,
    approvals,
    toolCalls,
    auth,
    system,
    modelConfigs,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    auth.currentUser.mockResolvedValue({
      id: 'owner-1',
      email: 'dev@example.com',
      name: 'Dev',
      role: 'user',
      preferences: {
        layout: {
          leftSidebarCollapsed: false,
          rightSidebarCollapsed: false,
          leftSidebarWidth: 280,
          rightSidebarWidth: 360,
        },
        theme: { mode: 'dark' },
      },
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    } as never);
    system.capabilities.mockReturnValue({
      version: '0.1.0',
      serverMode: 'local_runtime',
      localWorkspacesEnabled: true,
      workspaceModes: ['managed', 'attached'],
      sourceTypes: ['manual', 'git', 'archive', 'local'],
      features: {
        localWorkspaces: true,
        sseSessionEvents: true,
        planMode: true,
        toolApprovals: true,
        commandApprovals: true,
        mcpTools: true,
      },
    } as never);
  });

  it('returns a mobile overview scoped to the current owner', async () => {
    const project = projectFixture();
    const session = sessionFixture(project);
    const approval = approvalFixture(session);

    projects.find.mockResolvedValue([project]);
    sessions.find.mockResolvedValue([session]);
    approvals.find.mockResolvedValue([approval]);
    plans.find.mockResolvedValue([
      {
        id: 'plan-1',
        session,
        status: 'pending_approval' as PlanStatus,
        createdAt: new Date('2026-06-03T00:00:00.000Z'),
      } as Plan,
    ]);
    toolCalls.find.mockResolvedValue([
      {
        id: 'tool-running',
        session,
        name: 'run_command',
        arguments: { command: 'npm test' },
        status: ToolCallStatus.Running,
        requiresApproval: false,
        createdAt: new Date('2026-06-03T00:00:00.000Z'),
        updatedAt: new Date('2026-06-03T00:00:00.000Z'),
      } as ToolCall,
    ]);

    const overview = await service.overview('owner-1');

    expect(auth.currentUser).toHaveBeenCalledWith('owner-1');
    expect(projects.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { owner: { id: 'owner-1' } },
      }),
    );
    expect(sessions.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { owner: { id: 'owner-1' } },
        relations: { project: true, activeModelConfig: true },
      }),
    );
    expect(approvals.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: ApprovalStatus.Pending,
          requester: { id: 'owner-1' },
        },
      }),
    );
    expect(overview.projects).toEqual([
      expect.objectContaining({
        id: 'project-1',
        name: 'Mebius',
        sourceType: ProjectSourceType.Local,
        workspaceMode: ProjectWorkspaceMode.Attached,
      }),
    ]);
    expect(overview.recentSessions).toEqual([
      expect.objectContaining({
        id: 'session-1',
        projectId: 'project-1',
        projectName: 'Mebius',
        latestPlanStatus: PlanStatus.PlanReadyPendingApproval,
        pendingApprovalCount: 1,
        agentActivity: expect.objectContaining({
          status: 'waiting_for_approval',
        }),
      }),
    ]);
    expect(overview.pendingApprovals[0]).toEqual(
      expect.objectContaining({
        id: 'approval-1',
        preview: expect.objectContaining({
          kind: 'command',
          command: 'npm test',
        }),
      }),
    );
  });
});

function projectFixture(): Project {
  return {
    id: 'project-1',
    owner: { id: 'owner-1' } as User,
    name: 'Mebius',
    description: 'Agent workspace',
    sourceType: ProjectSourceType.Local,
    workspaceMode: ProjectWorkspaceMode.Attached,
    workspacePath: 'D:/Code/MebiusCode',
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-02T00:00:00.000Z'),
  } as Project;
}

function sessionFixture(project: Project): Session {
  return {
    id: 'session-1',
    owner: { id: 'owner-1' } as User,
    project,
    title: 'Mobile task',
    status: SessionStatus.Active,
    permissionMode: PermissionMode.AskFirst,
    activeModelConfig: {
      id: 'model-1',
      displayName: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      modelName: 'deepseek-chat',
      providerId: 'deepseek',
      supportsTools: true,
      isDefault: true,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    } as never,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-03T00:00:00.000Z'),
  } as Session;
}

function approvalFixture(session: Session): ToolApproval {
  return {
    id: 'approval-1',
    status: ApprovalStatus.Pending,
    requester: { id: 'owner-1' } as User,
    toolCall: {
      id: 'tool-1',
      session,
      name: 'run_command',
      arguments: { command: 'npm test' },
      status: ToolCallStatus.PendingApproval,
      requiresApproval: true,
      createdAt: new Date('2026-06-03T00:00:00.000Z'),
      updatedAt: new Date('2026-06-03T00:00:00.000Z'),
    } as ToolCall,
    createdAt: new Date('2026-06-03T00:00:00.000Z'),
  } as ToolApproval;
}
