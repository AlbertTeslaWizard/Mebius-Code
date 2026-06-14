import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PlanStatus } from '../../common/enums/plan-status.enum';
import { ApprovalStatus, ToolCallStatus } from '../../common/enums/tool-status.enum';
import { AuthService, PublicUser } from '../auth/auth.service';
import { Plan } from '../agent/plan.entity';
import { SystemService } from '../system/system.service';
import { ModelConfigsService } from '../model-configs/model-configs.service';
import { Project } from '../projects/project.entity';
import { Session } from '../sessions/session.entity';
import { ToolApproval } from '../tools/tool-approval.entity';
import { ToolCall } from '../tools/tool-call.entity';

const RECENT_SESSION_LIMIT = 20;
const PENDING_APPROVAL_LIMIT = 20;

type MobileProject = Pick<
  Project,
  'id' | 'name' | 'sourceType' | 'workspaceMode' | 'createdAt' | 'updatedAt'
> & {
  description?: string;
};

type MobileApproval = ToolApproval & {
  preview?: MobileApprovalPreview;
};

type MobileApprovalPreview =
  | {
      kind: 'patch';
      path: string;
      diffText: string;
      truncated: boolean;
    }
  | {
      kind: 'patch_set';
      files: Array<{
        path: string;
        diffText: string;
        truncated: boolean;
        status: string;
      }>;
      truncated: boolean;
    }
  | {
      kind: 'command';
      command: string;
      cwd?: string;
      policyAllowed: boolean;
      executionMode: 'argv' | 'shell';
      shellTokens: string[];
      sessionAutoRunActive: boolean;
      canGrantSessionAutoRun: boolean;
      truncated: false;
    };

interface MobileRecentSession {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  status: string;
  permissionMode: string;
  activeModelConfig: ReturnType<ModelConfigsService['sanitize']> | null;
  agentActivity: MobileAgentActivity | null;
  latestPlanStatus?: PlanStatus;
  pendingApprovalCount: number;
  createdAt: Date;
  updatedAt: Date;
}

interface MobileAgentActivity {
  status: 'using_tools' | 'waiting_for_approval';
  toolName?: string;
  activity?: string;
  targetPaths?: string[];
  command?: string;
}

export interface MobileOverview {
  user: PublicUser;
  capabilities: ReturnType<SystemService['capabilities']>;
  projects: MobileProject[];
  recentSessions: MobileRecentSession[];
  pendingApprovals: MobileApproval[];
}

@Injectable()
export class MobileService {
  constructor(
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    @InjectRepository(Session)
    private readonly sessions: Repository<Session>,
    @InjectRepository(Plan)
    private readonly plans: Repository<Plan>,
    @InjectRepository(ToolApproval)
    private readonly approvals: Repository<ToolApproval>,
    @InjectRepository(ToolCall)
    private readonly toolCalls: Repository<ToolCall>,
    private readonly auth: AuthService,
    private readonly system: SystemService,
    private readonly modelConfigs: ModelConfigsService,
  ) {}

  async overview(ownerId: string): Promise<MobileOverview> {
    const [user, capabilities, projects, sessions, pendingApprovals] = await Promise.all([
      this.auth.currentUser(ownerId),
      Promise.resolve(this.system.capabilities()),
      this.listProjects(ownerId),
      this.listRecentSessions(ownerId),
      this.listPendingApprovals(ownerId),
    ]);

    const latestPlanBySession = await this.latestPlanStatusBySession(sessions.map((session) => session.id));
    const approvalCountBySession = this.pendingApprovalCountBySession(pendingApprovals);
    const runningToolBySession = await this.runningToolBySession(sessions.map((session) => session.id));

    return {
      user,
      capabilities,
      projects,
      recentSessions: sessions.map((session) =>
        this.toRecentSession(
          session,
          latestPlanBySession.get(session.id),
          approvalCountBySession.get(session.id) ?? 0,
          runningToolBySession.get(session.id),
        ),
      ),
      pendingApprovals,
    };
  }

  private async listProjects(ownerId: string): Promise<MobileProject[]> {
    const projects = await this.projects.find({
      where: { owner: { id: ownerId } },
      order: { updatedAt: 'DESC' },
      take: 50,
    });
    return projects.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      sourceType: project.sourceType,
      workspaceMode: project.workspaceMode,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }));
  }

  private async listRecentSessions(ownerId: string): Promise<Session[]> {
    return this.sessions.find({
      where: { owner: { id: ownerId } },
      relations: { project: true, activeModelConfig: true },
      order: { updatedAt: 'DESC' },
      take: RECENT_SESSION_LIMIT,
    });
  }

  private async listPendingApprovals(ownerId: string): Promise<MobileApproval[]> {
    const approvals = await this.approvals.find({
      where: {
        status: ApprovalStatus.Pending,
        requester: { id: ownerId },
      },
      relations: { toolCall: { session: { project: true } }, requester: true },
      order: { createdAt: 'DESC' },
      take: PENDING_APPROVAL_LIMIT,
    });
    return approvals.map((approval) => ({
      ...approval,
      preview: this.buildLightweightPreview(approval),
    }));
  }

  private async latestPlanStatusBySession(sessionIds: string[]): Promise<Map<string, PlanStatus>> {
    if (sessionIds.length === 0) return new Map();
    const plans = await this.plans.find({
      where: { session: { id: In(sessionIds) } },
      relations: { session: true },
      order: { createdAt: 'DESC' },
    });
    const result = new Map<string, PlanStatus>();
    for (const plan of plans) {
      const sessionId = plan.session.id;
      if (!result.has(sessionId)) {
        result.set(sessionId, normalizePlanStatus(plan.status));
      }
    }
    return result;
  }

  private pendingApprovalCountBySession(approvals: ToolApproval[]): Map<string, number> {
    const result = new Map<string, number>();
    for (const approval of approvals) {
      const sessionId = approval.toolCall?.session?.id;
      if (!sessionId) continue;
      result.set(sessionId, (result.get(sessionId) ?? 0) + 1);
    }
    return result;
  }

  private async runningToolBySession(sessionIds: string[]): Promise<Map<string, ToolCall>> {
    if (sessionIds.length === 0) return new Map();
    const calls = await this.toolCalls.find({
      where: {
        session: { id: In(sessionIds) },
        status: ToolCallStatus.Running,
      },
      relations: { session: true },
      order: { updatedAt: 'DESC' },
    });
    const result = new Map<string, ToolCall>();
    for (const call of calls) {
      const sessionId = call.session.id;
      if (!result.has(sessionId)) {
        result.set(sessionId, call);
      }
    }
    return result;
  }

  private toRecentSession(
    session: Session,
    latestPlanStatus: PlanStatus | undefined,
    pendingApprovalCount: number,
    runningTool: ToolCall | undefined,
  ): MobileRecentSession {
    const project = session.project as Project;
    const pendingTool = pendingApprovalCount > 0 ? undefined : runningTool;
    return {
      id: session.id,
      projectId: project.id,
      projectName: project.name,
      title: session.title,
      status: session.status,
      permissionMode: session.permissionMode,
      activeModelConfig: session.activeModelConfig
        ? this.modelConfigs.sanitize(session.activeModelConfig)
        : null,
      agentActivity:
        pendingApprovalCount > 0
          ? {
              status: 'waiting_for_approval',
              activity: 'waiting_for_approval',
            }
          : pendingTool
            ? this.buildToolActivity(pendingTool, 'using_tools')
            : null,
      latestPlanStatus,
      pendingApprovalCount,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  private buildToolActivity(toolCall: ToolCall, status: MobileAgentActivity['status']): MobileAgentActivity {
    const args = toolCall.arguments ?? {};
    const activity: MobileAgentActivity = {
      status,
      toolName: toolCall.name,
      activity: toolCall.name === 'create_patch' ? 'applying_patch' : 'running_tool',
    };
    const targetPaths = extractPatchTargetPaths(toolCall.name, args);
    if (targetPaths.length > 0) activity.targetPaths = targetPaths;
    if (toolCall.name === 'run_command' && typeof args.command === 'string') {
      activity.command = args.command;
    }
    return activity;
  }

  private buildLightweightPreview(approval: ToolApproval): MobileApprovalPreview | undefined {
    const toolCall = approval.toolCall;
    if (!toolCall) return undefined;
    if (toolCall.name === 'run_command' && typeof toolCall.arguments.command === 'string') {
      return {
        kind: 'command',
        command: toolCall.arguments.command,
        cwd: typeof toolCall.arguments.cwd === 'string' ? toolCall.arguments.cwd : undefined,
        policyAllowed: false,
        executionMode: 'shell',
        shellTokens: [],
        sessionAutoRunActive: false,
        canGrantSessionAutoRun: false,
        truncated: false,
      };
    }
    if (toolCall.name !== 'create_patch') return undefined;
    const paths = extractPatchTargetPaths(toolCall.name, toolCall.arguments);
    if (paths.length <= 1) {
      return {
        kind: 'patch',
        path: paths[0] ?? 'patch',
        diffText: 'Open the session to load the full diff preview.',
        truncated: true,
      };
    }
    return {
      kind: 'patch_set',
      files: paths.map((path) => ({
        path,
        diffText: 'Open the session to load the full diff preview.',
        truncated: true,
        status: 'proposed',
      })),
      truncated: true,
    };
  }
}

function normalizePlanStatus(status: PlanStatus | string): PlanStatus {
  if (status === 'pending_approval') return PlanStatus.PlanReadyPendingApproval;
  if (status === 'rejected') return PlanStatus.Cancelled;
  if (status === 'running' || status === 'completed') return PlanStatus.Approved;
  if (Object.values(PlanStatus).includes(status as PlanStatus)) return status as PlanStatus;
  return PlanStatus.Failed;
}

function extractPatchTargetPaths(toolName: string, args: Record<string, unknown>): string[] {
  if (toolName !== 'create_patch') return [];
  const rawPaths = Array.isArray(args.files)
    ? args.files.map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>).path : undefined))
    : [args.path];
  return rawPaths
    .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
    .map((path) => path.trim().replaceAll('\\', '/'));
}
