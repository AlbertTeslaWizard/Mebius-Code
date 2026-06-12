import { forwardRef, Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { IsNull, Not, Repository } from 'typeorm';
import {
  ApprovalStatus,
  CommandRunStatus,
  FilePatchStatus,
  ToolCallStatus,
} from '../../common/enums/tool-status.enum';
import { PlanStatus } from '../../common/enums/plan-status.enum';
import { DEFAULT_PERMISSION_MODE } from '../../common/enums/permission-mode.enum';
import { MessageRole } from '../../common/enums/message-role.enum';
import { UserRole } from '../../common/enums/user-role.enum';
import { CommandInspection, CommandPolicyService } from '../../common/security/command-policy.service';
import { PathSandboxService } from '../../common/security/path-sandbox.service';
import { AuditService } from '../audit/audit.service';
import { PendingToolResumeContext } from '../agent/agent-resume.types';
import { AgentService } from '../agent/agent.service';
import { Plan } from '../agent/plan.entity';
import { EventsService } from '../events/events.service';
import { Project } from '../projects/project.entity';
import { AgentTurn, AgentTurnKind, AgentTurnStatus } from '../sessions/agent-turn.entity';
import { Session } from '../sessions/session.entity';
import { Message } from '../sessions/message.entity';
import { SessionsService } from '../sessions/sessions.service';
import { User } from '../users/user.entity';
import { CommandRun } from './command-run.entity';
import { resolveCommandRuntime } from './command-runtime';
import { FilePatch } from './file-patch.entity';
import {
  commandApprovalPattern,
  decidePermission,
  hasExternalToolPath,
  matchesSessionApprovalRule,
  type SessionApprovalRuleLike,
  type ToolPermissionRequest,
} from './permission-decision';
import { SessionApprovalRule } from './session-approval-rule.entity';
import {
  SESSION_SHELL_AUTORUN_GRANT,
  SessionCommandGrant,
} from './session-command-grant.entity';
import { ToolApproval } from './tool-approval.entity';
import { ToolCall } from './tool-call.entity';
import { codingToolNames } from './tool-specs';
import { WebSearchService } from './web-search.service';

const DIFF_PREVIEW_LIMIT = 20_000;
type ApprovalMode = 'once' | 'project' | 'session_auto';

type ApprovalPreview =
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
        status: FilePatchStatus;
      }>;
      truncated: boolean;
    }
  | {
      kind: 'command';
      command: string;
      cwd?: string;
      policyAllowed: boolean;
      policySource?: 'environment' | 'preset' | 'custom' | 'project';
      executionMode: CommandInspection['executionMode'];
      shellTokens: string[];
      sessionAutoRunActive: boolean;
      canGrantSessionAutoRun: boolean;
      truncated: false;
    };

type PendingApprovalResponse = ToolApproval & {
  preview?: ApprovalPreview;
};

export interface CommandAuthorizationView {
  shellAutoRun: boolean;
  canGrantShellAutoRun: boolean;
  grantedAt?: Date;
  grantedById?: string;
}

interface PatchInputFile {
  path: string;
  content: string;
}

type ToolActivityStatus = 'using_tools' | 'waiting_for_approval';

export interface TurnUndoRedoResult {
  direction: 'undo' | 'redo';
  turnId?: string;
  messageCount: number;
  reverted: Array<{ path: string; patchId: string }>;
  restored: Array<{ path: string; patchId: string }>;
  conflicts: Array<{ path: string; patchId: string; reason: string }>;
}

@Injectable()
export class ToolsService {
  constructor(
    @InjectRepository(ToolCall)
    private readonly toolCalls: Repository<ToolCall>,
    @InjectRepository(ToolApproval)
    private readonly approvals: Repository<ToolApproval>,
    @InjectRepository(FilePatch)
    private readonly patches: Repository<FilePatch>,
    @InjectRepository(CommandRun)
    private readonly commandRuns: Repository<CommandRun>,
    @InjectRepository(SessionCommandGrant)
    private readonly sessionCommandGrants: Repository<SessionCommandGrant>,
    @InjectRepository(SessionApprovalRule)
    private readonly sessionApprovalRules: Repository<SessionApprovalRule>,
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
    @InjectRepository(AgentTurn)
    private readonly turns: Repository<AgentTurn>,
    @InjectRepository(Plan)
    private readonly plans: Repository<Plan>,
    private readonly sessions: SessionsService,
    private readonly paths: PathSandboxService,
    private readonly commandPolicy: CommandPolicyService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly webSearch: WebSearchService,
    @Inject(forwardRef(() => AgentService))
    private readonly agent: AgentService,
  ) {}

  async requestOrExecute(input: {
    owner: User;
    sessionId: string;
    name: string;
    args: Record<string, unknown>;
    turn?: AgentTurn | null;
    resumeContext?: PendingToolResumeContext;
  }): Promise<ToolCall> {
    const session = await this.sessions.findOwned(input.owner.id, input.sessionId);
    let commandInspection: CommandInspection | undefined;
    let inspectionError: string | undefined;
    if (input.name === 'run_command') {
      if (typeof input.args.command !== 'string') {
        return this.rejectToolRequestByPermission(input, session, 'run_command requires command.');
      }
      const project = session.project as Project;
      try {
        commandInspection = await this.commandPolicy.inspect(input.args.command, project.id);
      } catch (error) {
        inspectionError = error instanceof Error ? error.message : 'Command is blocked by permission policy.';
      }
    }
    const permissionRequest: ToolPermissionRequest = {
      name: input.name,
      args: input.args,
      commandInspection,
      inspectionError,
    };
    const sessionRules = await this.effectiveSessionApprovalRules(session.id);
    const decision = decidePermission(session.permissionMode ?? DEFAULT_PERMISSION_MODE, permissionRequest, sessionRules);
    if (decision === 'deny') {
      return this.rejectToolRequestByPermission(input, session, inspectionError ?? 'Denied by permission mode.');
    }

    const requiresApproval = decision === 'ask';
    const commandAuthorized = input.name === 'run_command' && decision === 'allow';
    const toolCall = await this.toolCalls.save(
      this.toolCalls.create({
        session,
        turn: input.turn ?? null,
        name: input.name,
        arguments: input.args,
        requiresApproval,
        status: requiresApproval ? ToolCallStatus.PendingApproval : ToolCallStatus.Running,
        resultText: requiresApproval ? this.encodeResumeContext(input.resumeContext) : undefined,
      }),
    );

    if (requiresApproval) {
      if (input.name === 'create_patch' && !hasExternalToolPath(permissionRequest)) {
        this.events.publish(
          session.id,
          'agent_status',
          this.buildToolActivityPayload(input.name, input.args, 'using_tools', 'preparing_patch'),
        );
        await this.createProposedPatches(toolCall, session.project as Project, input.args);
      }
      const approval = await this.approvals.save(
        this.approvals.create({
          toolCall,
          requester: input.owner,
          status: ApprovalStatus.Pending,
          reason: typeof input.args.reason === 'string' ? input.args.reason : undefined,
        }),
      );
      this.events.publish(session.id, 'tool_call_requested', {
        toolCallId: toolCall.id,
        approvalId: approval.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
        ...this.buildToolMetadata(toolCall.name, toolCall.arguments, 'waiting_for_approval'),
      });
      return toolCall;
    }

    const result = await this.executeTool(toolCall, input.owner, {
      commandAuthorized,
    });
    toolCall.status = ToolCallStatus.Succeeded;
    toolCall.resultText = result;
    const saved = await this.toolCalls.save(toolCall);
    this.events.publish(session.id, 'tool_call_result', {
      toolCallId: saved.id,
      name: saved.name,
      result,
      status: saved.status,
      ...this.buildToolMetadata(saved.name, saved.arguments, 'tool_completed'),
    });
    return saved;
  }

  private async effectiveSessionApprovalRules(sessionId: string): Promise<SessionApprovalRuleLike[]> {
    const rules = await this.sessionApprovalRules.find({
      where: { session: { id: sessionId } },
      order: { createdAt: 'ASC' },
    });
    const legacyShellGrant = await this.hasSessionShellAutoRunGrant(sessionId);
    return [
      ...rules.map((rule) => ({
        toolKind: rule.toolKind,
        pattern: rule.pattern,
        scope: rule.scope,
      })),
      ...(legacyShellGrant ? [{ toolKind: 'run_command', scope: 'session' }] : []),
    ];
  }

  private async rejectToolRequestByPermission(
    input: {
      owner: User;
      sessionId: string;
      name: string;
      args: Record<string, unknown>;
      turn?: AgentTurn | null;
    },
    session: Session,
    reason: string,
  ): Promise<ToolCall> {
    const resultText = reason.startsWith('Denied by permission mode')
      ? reason
      : `Denied by permission mode: ${reason}`;
    const toolCall = await this.toolCalls.save(
      this.toolCalls.create({
        session,
        turn: input.turn ?? null,
        name: input.name,
        arguments: input.args,
        requiresApproval: false,
        status: ToolCallStatus.Rejected,
        resultText,
      }),
    );
    this.events.publish(session.id, 'tool_call_result', {
      toolCallId: toolCall.id,
      name: toolCall.name,
      result: resultText,
      status: toolCall.status,
      ...this.buildToolMetadata(toolCall.name, toolCall.arguments, 'tool_rejected'),
    });
    return toolCall;
  }

  async pending(ownerId: string): Promise<PendingApprovalResponse[]> {
    const approvals = await this.approvals.find({
      where: {
        status: ApprovalStatus.Pending,
        requester: { id: ownerId },
      },
      relations: { toolCall: { session: { project: true }, turn: true }, requester: true },
      order: { createdAt: 'DESC' },
    });
    return Promise.all(
      approvals.map(async (approval) => ({
        ...approval,
        preview: await this.buildApprovalPreview(approval).catch(() => undefined),
      })),
    );
  }

  async listSessionPatches(ownerId: string, sessionId: string) {
    const session = await this.sessions.findOwned(ownerId, sessionId);
    const patches = await this.patches.find({
      where: { session: { id: session.id } },
      relations: { toolCall: true },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return patches.map((patch) => ({
      id: patch.id,
      relativePath: patch.relativePath,
      diffText: patch.diffText,
      status: patch.status,
      createdAt: patch.createdAt,
      toolCall: patch.toolCall
        ? {
            id: patch.toolCall.id,
            name: patch.toolCall.name,
            status: patch.toolCall.status,
          }
        : undefined,
    }));
  }

  async listSessionCommandRuns(ownerId: string, sessionId: string) {
    const session = await this.sessions.findOwned(ownerId, sessionId);
    const runs = await this.commandRuns
      .createQueryBuilder('run')
      .leftJoinAndSelect('run.toolCall', 'toolCall')
      .leftJoin('toolCall.turn', 'turn')
      .where('run.session_id = :sessionId', { sessionId: session.id })
      .andWhere('(toolCall.turn_id IS NULL OR turn.status = :activeStatus)', {
        activeStatus: AgentTurnStatus.Active,
      })
      .orderBy('run.created_at', 'DESC')
      .take(50)
      .getMany();
    return runs.map((run) => this.serializeCommandRun(run));
  }

  async requestManualCommand(
    owner: User,
    sessionId: string,
    input: { command: string; cwd?: string },
  ): Promise<ToolCall> {
    const session = await this.sessions.findOwned(owner.id, sessionId);
    const turn = await this.sessions.createTurn(session, AgentTurnKind.ManualCommand, {
      command: input.command,
      ...(input.cwd ? { cwd: input.cwd } : {}),
    });
    return this.requestOrExecute({
      owner,
      sessionId,
      name: 'run_command',
      turn,
      args: {
        command: input.command,
        ...(input.cwd ? { cwd: input.cwd } : {}),
        reason: 'Requested manually from the Runs panel.',
      },
    });
  }

  async listAllowedCommands(projectId?: string): Promise<string[]> {
    return this.commandPolicy.listAllowedCommands(projectId);
  }

  webSearchEnabled(): boolean {
    return this.webSearch.isEnabled();
  }

  async listSessionAllowedCommands(ownerId: string, sessionId: string): Promise<string[]> {
    const session = await this.sessions.findOwned(ownerId, sessionId);
    const project = session.project as Project;
    return this.listAllowedCommands(project.id);
  }

  async getSessionCommandAuthorization(ownerId: string, sessionId: string): Promise<CommandAuthorizationView> {
    const session = await this.sessions.findOwned(ownerId, sessionId);
    return this.buildSessionCommandAuthorizationView(session.id);
  }

  async revokeSessionCommandAuthorization(owner: User, sessionId: string): Promise<CommandAuthorizationView> {
    const session = await this.sessions.findOwned(owner.id, sessionId);
    const grant = await this.findSessionShellAutoRunGrant(session.id);
    if (grant) {
      await this.sessionCommandGrants.remove(grant);
      await this.audit.record({
        actor: owner,
        action: 'command_policy.session_shell_autorun_revoked',
        resourceType: 'session',
        resourceId: session.id,
        metadata: {},
      });
    }
    return this.buildSessionCommandAuthorizationView(session.id);
  }

  async approve(owner: User, approvalId: string, mode: ApprovalMode = 'once'): Promise<ToolCall> {
    const approval = await this.findPendingApproval(owner.id, approvalId);
    const toolCall = approval.toolCall;
    const resumeContext = this.decodeResumeContext(toolCall.resultText);
    let projectCommandToRemember: { project: Project; command: string; normalized: string } | null = null;
    let sessionApprovalRuleCreated = false;
    if (toolCall.name === 'run_command') {
      const project = toolCall.session.project as Project;
      const command = toolCall.arguments.command;
      if (typeof command !== 'string') {
        throw new BadRequestException('run_command requires command.');
      }
      const inspection = await this.commandPolicy.inspect(command, project.id);
      if (mode === 'project') {
        if (inspection.executionMode === 'shell') {
          throw new BadRequestException('Shell commands cannot be enabled for a project.');
        }
        if (!inspection.allowed && owner.role !== UserRole.Admin) {
          throw new BadRequestException('Only administrators can authorize a command outside the enabled policy.');
        }
        projectCommandToRemember = { project, command, normalized: inspection.normalized };
      }
      if (mode === 'session_auto') {
        await this.sessions.findOwned(owner.id, toolCall.session.id);
        sessionApprovalRuleCreated = await this.ensureSessionApprovalRule(toolCall, owner, {
          toolKind: 'run_command',
          pattern: commandApprovalPattern(inspection.normalized),
          scope: 'workspace',
        });
        if (sessionApprovalRuleCreated) {
          await this.audit.record({
            actor: owner,
            action: 'tool.session_approval_rule_granted',
            resourceType: 'session',
            resourceId: toolCall.session.id,
            metadata: { toolKind: 'run_command', command, pattern: commandApprovalPattern(inspection.normalized) },
          });
        }
      }
    }
    if (toolCall.name === 'create_patch' && mode === 'session_auto') {
      await this.sessions.findOwned(owner.id, toolCall.session.id);
      sessionApprovalRuleCreated = await this.ensureSessionApprovalRule(toolCall, owner, {
        toolKind: 'create_patch',
        scope: 'workspace',
      });
      if (sessionApprovalRuleCreated) {
        await this.audit.record({
          actor: owner,
          action: 'tool.session_approval_rule_granted',
          resourceType: 'session',
          resourceId: toolCall.session.id,
          metadata: { toolKind: 'create_patch', scope: 'workspace' },
        });
      }
    }
    approval.status = ApprovalStatus.Approved;
    approval.approver = owner;
    await this.approvals.save(approval);
    toolCall.status = ToolCallStatus.Running;
    await this.toolCalls.save(toolCall);
    this.events.publish(
      toolCall.session.id,
      'agent_status',
      this.buildToolActivityPayload(
        toolCall.name,
        toolCall.arguments,
        'using_tools',
        toolCall.name === 'create_patch' ? 'applying_patch' : 'running_tool',
      ),
    );

    try {
      const result = await this.executeTool(toolCall, owner, {
        commandAuthorized: toolCall.name === 'run_command',
      });
      if (projectCommandToRemember) {
        await this.commandPolicy.rememberProjectCommand(
          projectCommandToRemember.project,
          owner,
          projectCommandToRemember.command,
        );
        await this.audit.record({
          actor: owner,
          action: 'command_policy.project_command_added',
          resourceType: 'project',
          resourceId: projectCommandToRemember.project.id,
          metadata: { command: projectCommandToRemember.normalized },
        });
      }
      toolCall.status = ToolCallStatus.Succeeded;
      toolCall.resultText = result;
      const saved = await this.toolCalls.save(toolCall);
      this.events.publish(toolCall.session.id, 'tool_call_result', {
        toolCallId: saved.id,
        name: saved.name,
        result,
        status: saved.status,
        ...this.buildToolMetadata(
          saved.name,
          saved.arguments,
          saved.name === 'create_patch' ? 'patch_applied' : 'tool_completed',
        ),
      });
      if (resumeContext) {
        await this.agent.recordToolResultMessage(
          saved.session,
          resumeContext.approvedToolCallId,
          saved.name,
          saved.status,
          result,
          saved.turn,
        );
      }
      if (resumeContext) {
        void this.agent.resumeAfterToolApproval(owner, saved, resumeContext).catch(() => undefined);
      }
      return saved;
    } catch (error) {
      toolCall.status = ToolCallStatus.Failed;
      toolCall.resultText = error instanceof Error ? error.message : 'Tool execution failed.';
      const saved = await this.toolCalls.save(toolCall);
      this.events.publish(toolCall.session.id, 'tool_call_result', {
        toolCallId: saved.id,
        name: saved.name,
        result: saved.resultText,
        status: saved.status,
        ...this.buildToolMetadata(saved.name, saved.arguments, 'tool_failed'),
      });
      if (resumeContext) {
        await this.agent.recordToolResultMessage(
          saved.session,
          resumeContext.approvedToolCallId,
          saved.name,
          saved.status,
          saved.resultText ?? 'Tool execution failed.',
          saved.turn,
        );
      }
      this.events.publish(toolCall.session.id, 'agent_status', {
        status: 'failed',
        message: saved.resultText,
      });
      await this.agent.markLatestRunningPlanFailed(toolCall.session.id);
      this.events.complete(toolCall.session.id);
      return saved;
    }
  }

  async reject(owner: User, approvalId: string): Promise<ToolApproval> {
    const approval = await this.findPendingApproval(owner.id, approvalId);
    const resumeContext = this.decodeResumeContext(approval.toolCall.resultText);
    approval.status = ApprovalStatus.Rejected;
    approval.approver = owner;
    approval.toolCall.status = ToolCallStatus.Rejected;
    await this.toolCalls.save(approval.toolCall);
    if (approval.toolCall.name === 'create_patch') {
      const proposed = await this.patches.find({
        where: { toolCall: { id: approval.toolCall.id }, status: FilePatchStatus.Proposed },
      });
      await Promise.all(
        proposed.map((patch) => {
          patch.status = FilePatchStatus.Rejected;
          return this.patches.save(patch);
        }),
      );
    }
    const saved = await this.approvals.save(approval);
    if (resumeContext) {
      await this.agent.recordToolResultMessage(
        approval.toolCall.session,
        resumeContext.approvedToolCallId,
        approval.toolCall.name,
        approval.toolCall.status,
        `Tool ${approval.toolCall.name} was rejected by the user.`,
        approval.toolCall.turn,
      );
    }
    this.events.publish(approval.toolCall.session.id, 'agent_status', {
      status: 'completed',
    });
    await this.agent.markLatestRunningPlanFailed(approval.toolCall.session.id);
    this.events.complete(approval.toolCall.session.id);
    return saved;
  }

  async revertPatch(owner: User, patchId: string): Promise<FilePatch> {
    const patch = await this.patches.findOne({
      where: { id: patchId, project: { owner: { id: owner.id } } },
      relations: { project: { owner: true }, session: true, toolCall: true },
    });
    if (!patch) {
      throw new NotFoundException('Patch not found.');
    }
    return this.revertPatchEntity(patch, patch.project as Project, owner);
  }

  async undoLastTurn(owner: User, sessionId: string): Promise<TurnUndoRedoResult> {
    const session = await this.sessions.findOwned(owner.id, sessionId);
    const pendingApproval = await this.sessions.findPendingApprovalTool(session.id);
    if (pendingApproval?.toolCall) {
      throw new BadRequestException(
        `A tool approval is still pending for ${pendingApproval.toolCall.name}. Please approve or reject it before undoing.`,
      );
    }

    const turn = await this.findUndoTurn(session);
    if (!turn) return this.emptyTurnResult('undo');

    const messages = await this.messages.find({
      where: { turn: { id: turn.id }, deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });
    const patches = await this.turnPatches(turn.id, owner.id, FilePatchStatus.Applied);
    const undoPatches = [...patches].reverse();
    const conflicts = await this.patchSnapshotConflicts(undoPatches, 'undo');
    if (conflicts.length > 0) {
      return { ...this.emptyTurnResult('undo'), turnId: turn.id, conflicts };
    }

    const reverted: Array<{ path: string; patchId: string }> = [];
    for (const patch of undoPatches) {
      await this.writePatchSnapshot(patch, owner, patch.originalContent ?? null, FilePatchStatus.Reverted, 'undo');
      reverted.push({ path: patch.relativePath, patchId: patch.id });
    }

    await this.applyPlanTurnState(turn, 'undo');
    const now = new Date();
    messages.forEach((message) => {
      message.deletedAt = now;
    });
    if (messages.length > 0) {
      await this.messages.save(messages);
    }
    turn.status = AgentTurnStatus.Undone;
    turn.undoneAt = now;
    await this.turns.save(turn);
    await this.publishPlanVisibilityTurn(turn);
    this.events.publish(session.id, 'turn_undone', {
      turnId: turn.id,
      kind: turn.kind,
      messageCount: messages.length,
      reverted,
      conflicts: [],
    });

    return {
      direction: 'undo',
      turnId: turn.id,
      messageCount: messages.length,
      reverted,
      restored: [],
      conflicts: [],
    };
  }

  async redoLastTurn(owner: User, sessionId: string): Promise<TurnUndoRedoResult> {
    const session = await this.sessions.findOwned(owner.id, sessionId);
    const turn = await this.findRedoTurn(session);
    if (!turn) return this.emptyTurnResult('redo');

    const messages = await this.messages.find({
      where: { turn: { id: turn.id }, deletedAt: Not(IsNull()) },
      order: { createdAt: 'ASC' },
    });
    const patches = await this.turnPatches(turn.id, owner.id, FilePatchStatus.Reverted);
    const conflicts = await this.patchSnapshotConflicts(patches, 'redo');
    if (conflicts.length > 0) {
      return { ...this.emptyTurnResult('redo'), turnId: turn.id, conflicts };
    }

    const restored: Array<{ path: string; patchId: string }> = [];
    for (const patch of patches) {
      await this.writePatchSnapshot(patch, owner, patch.patchedContent, FilePatchStatus.Applied, 'redo');
      restored.push({ path: patch.relativePath, patchId: patch.id });
    }

    messages.forEach((message) => {
      message.deletedAt = null;
    });
    if (messages.length > 0) {
      await this.messages.save(messages);
    }
    turn.status = AgentTurnStatus.Active;
    turn.undoneAt = null;
    await this.turns.save(turn);
    await this.applyPlanTurnState(turn, 'redo');
    await this.publishPlanVisibilityTurn(turn);
    this.events.publish(session.id, 'turn_redone', {
      turnId: turn.id,
      kind: turn.kind,
      messageCount: messages.length,
      restored,
      conflicts: [],
    });

    return {
      direction: 'redo',
      turnId: turn.id,
      messageCount: messages.length,
      reverted: [],
      restored,
      conflicts: [],
    };
  }

  private emptyTurnResult(direction: 'undo' | 'redo'): TurnUndoRedoResult {
    return {
      direction,
      messageCount: 0,
      reverted: [],
      restored: [],
      conflicts: [],
    };
  }

  private async findUndoTurn(session: Session): Promise<AgentTurn | null> {
    const turn = await this.turns.findOne({
      where: { session: { id: session.id }, status: AgentTurnStatus.Active },
      relations: { session: true },
      order: { createdAt: 'DESC' },
    });
    if (turn) return turn;
    return this.createLegacyTurn(session);
  }

  private async findRedoTurn(session: Session): Promise<AgentTurn | null> {
    const latestActive = await this.turns.findOne({
      where: { session: { id: session.id }, status: AgentTurnStatus.Active },
      order: { createdAt: 'DESC' },
    });
    const query = this.turns
      .createQueryBuilder('turn')
      .where('turn.session_id = :sessionId', { sessionId: session.id })
      .andWhere('turn.status = :status', { status: AgentTurnStatus.Undone });
    if (latestActive) {
      query.andWhere('turn.created_at > :after', { after: latestActive.createdAt });
    }
    return query.orderBy('turn.created_at', 'ASC').getOne();
  }

  private async createLegacyTurn(session: Session): Promise<AgentTurn | null> {
    const lastUserMessage = await this.messages
      .createQueryBuilder('message')
      .where('message.session_id = :sessionId', { sessionId: session.id })
      .andWhere('message.role = :role', { role: MessageRole.User })
      .andWhere('message.deleted_at IS NULL')
      .andWhere('message.turn_id IS NULL')
      .orderBy('message.created_at', 'DESC')
      .getOne();
    if (!lastUserMessage) return null;

    const turn = await this.sessions.createTurn(session, AgentTurnKind.Legacy, {
      migratedFrom: 'last_user_message',
      userMessageId: lastUserMessage.id,
    });
    const messages = await this.messages
      .createQueryBuilder('message')
      .where('message.session_id = :sessionId', { sessionId: session.id })
      .andWhere('message.created_at >= :after', { after: lastUserMessage.createdAt })
      .andWhere('message.deleted_at IS NULL')
      .andWhere('message.turn_id IS NULL')
      .orderBy('message.created_at', 'ASC')
      .getMany();
    messages.forEach((message) => {
      message.turn = turn;
    });
    if (messages.length > 0) await this.messages.save(messages);

    const toolCalls = await this.toolCalls
      .createQueryBuilder('toolCall')
      .where('toolCall.session_id = :sessionId', { sessionId: session.id })
      .andWhere('toolCall.created_at > :after', { after: lastUserMessage.createdAt })
      .andWhere('toolCall.turn_id IS NULL')
      .orderBy('toolCall.created_at', 'ASC')
      .getMany();
    toolCalls.forEach((toolCall) => {
      toolCall.turn = turn;
    });
    if (toolCalls.length > 0) await this.toolCalls.save(toolCalls);

    const plans = await this.plans
      .createQueryBuilder('plan')
      .where('plan.session_id = :sessionId', { sessionId: session.id })
      .andWhere('plan.created_at >= :after', { after: lastUserMessage.createdAt })
      .andWhere('plan.turn_id IS NULL')
      .orderBy('plan.created_at', 'ASC')
      .getMany();
    plans.forEach((plan) => {
      plan.turn = turn;
    });
    if (plans.length > 0) await this.plans.save(plans);

    return turn;
  }

  private async turnPatches(
    turnId: string,
    ownerId: string,
    status: FilePatchStatus,
  ): Promise<FilePatch[]> {
    return this.patches
      .createQueryBuilder('patch')
      .innerJoinAndSelect('patch.toolCall', 'toolCall')
      .innerJoinAndSelect('patch.project', 'project')
      .innerJoin('project.owner', 'owner')
      .leftJoinAndSelect('patch.session', 'session')
      .where('toolCall.turn_id = :turnId', { turnId })
      .andWhere('owner.id = :ownerId', { ownerId })
      .andWhere('patch.status = :status', { status })
      .orderBy('patch.created_at', 'ASC')
      .getMany();
  }

  private async patchSnapshotConflicts(
    patches: FilePatch[],
    direction: 'undo' | 'redo',
  ): Promise<Array<{ path: string; patchId: string; reason: string }>> {
    const simulated = new Map<string, string | null>();
    const conflicts: Array<{ path: string; patchId: string; reason: string }> = [];

    for (const patch of patches) {
      const project = patch.project as Project;
      const key = `${project.id}:${patch.relativePath}`;
      const current = simulated.has(key) ? simulated.get(key)! : await this.currentPatchContent(patch, project);
      const expected = direction === 'undo' ? patch.patchedContent : (patch.originalContent ?? null);
      if (current !== expected) {
        conflicts.push({
          path: patch.relativePath,
          patchId: patch.id,
          reason:
            direction === 'undo'
              ? 'Patch cannot be reverted because the file changed after it was applied.'
              : 'Patch cannot be restored because the file changed after it was reverted.',
        });
        continue;
      }
      simulated.set(key, direction === 'undo' ? (patch.originalContent ?? null) : patch.patchedContent);
    }

    return conflicts;
  }

  private async currentPatchContent(patch: FilePatch, project: Project): Promise<string | null> {
    const target = await this.paths.resolveNewProjectPath(project.workspacePath, patch.relativePath);
    return existsSync(target) ? readFile(target, 'utf8') : null;
  }

  private async writePatchSnapshot(
    patch: FilePatch,
    owner: User,
    nextContent: string | null,
    nextStatus: FilePatchStatus,
    direction: 'undo' | 'redo',
  ): Promise<FilePatch> {
    const project = patch.project as Project;
    const target = await this.paths.resolveNewProjectPath(project.workspacePath, patch.relativePath);
    if (nextContent === null) {
      await rm(target, { force: true });
    } else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, nextContent, 'utf8');
    }

    patch.status = nextStatus;
    const saved = await this.patches.save(patch);
    await this.audit.record({
      actor: owner,
      action: direction === 'undo' ? 'tool.patch_reverted' : 'tool.patch_restored',
      resourceType: 'file_patch',
      resourceId: patch.id,
      metadata: { path: patch.relativePath, toolCallId: patch.toolCall?.id },
    });
    this.events.publish((patch.session as { id: string }).id, direction === 'undo' ? 'patch_reverted' : 'patch_created', {
      patchId: patch.id,
      path: patch.relativePath,
      status: saved.status,
      targetPaths: [patch.relativePath],
      activity: direction === 'undo' ? 'patch_reverted' : 'patch_restored',
    });
    return saved;
  }

  private async applyPlanTurnState(turn: AgentTurn, direction: 'undo' | 'redo'): Promise<void> {
    if (turn.kind !== AgentTurnKind.PlanApproval) return;
    const planId = typeof turn.metadata?.planId === 'string' ? turn.metadata.planId : undefined;
    const status =
      direction === 'undo'
        ? typeof turn.metadata?.previousStatus === 'string'
          ? turn.metadata.previousStatus
          : undefined
        : typeof turn.metadata?.nextStatus === 'string'
          ? turn.metadata.nextStatus
          : undefined;
    if (!planId || !status) return;

    const plan = await this.plans.findOne({
      where: { id: planId, session: { id: (turn.session as Session).id } },
      relations: { session: true },
    });
    if (!plan) return;
    plan.status = status as PlanStatus;
    const saved = await this.plans.save(plan);
    this.events.publish((saved.session as Session).id, 'plan_updated', {
      planId: saved.id,
      status: saved.status,
    });
  }

  private async publishPlanVisibilityTurn(turn: AgentTurn): Promise<void> {
    if (turn.kind !== AgentTurnKind.Plan && turn.kind !== AgentTurnKind.Legacy) return;
    const plan = await this.plans.findOne({
      where: { turn: { id: turn.id } },
      relations: { session: true },
      order: { createdAt: 'DESC' },
    });
    if (!plan) return;
    this.events.publish((plan.session as Session).id, 'plan_updated', {
      planId: plan.id,
      status: turn.status === AgentTurnStatus.Active ? plan.status : 'undone',
    });
  }

  private async revertPatchEntity(patch: FilePatch, project: Project, owner: User): Promise<FilePatch> {
    if (patch.status !== FilePatchStatus.Applied) {
      throw new BadRequestException('Only applied patches can be reverted.');
    }

    const target = await this.paths.resolveNewProjectPath(project.workspacePath, patch.relativePath);
    const currentContent = existsSync(target) ? await readFile(target, 'utf8') : null;
    if (currentContent !== patch.patchedContent) {
      throw new BadRequestException('Patch cannot be reverted because the file changed after it was applied.');
    }

    if (patch.originalContent === undefined || patch.originalContent === null) {
      await rm(target, { force: true });
    } else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, patch.originalContent, 'utf8');
    }

    patch.status = FilePatchStatus.Reverted;
    const saved = await this.patches.save(patch);
    await this.audit.record({
      actor: owner,
      action: 'tool.patch_reverted',
      resourceType: 'file_patch',
      resourceId: patch.id,
      metadata: { path: patch.relativePath, toolCallId: patch.toolCall?.id },
    });
    this.events.publish((patch.session as { id: string }).id, 'patch_reverted', {
      patchId: patch.id,
      path: patch.relativePath,
      status: saved.status,
    });
    return saved;
  }

  private async executeTool(
    toolCall: ToolCall,
    owner: User,
    options: { commandAuthorized?: boolean } = {},
  ): Promise<string> {
    const session = toolCall.session;
    const project = session.project as Project;

    switch (toolCall.name) {
      case 'list_files':
        return this.listFiles(project, toolCall.arguments);
      case 'read_file':
        return this.readFile(project, toolCall.arguments);
      case 'search_text':
        return this.searchText(project, toolCall.arguments);
      case 'create_patch':
        return this.applyPatch(toolCall, owner, project, toolCall.arguments);
      case 'run_command':
        return this.runCommand(toolCall, owner, project, toolCall.arguments, options.commandAuthorized ?? false);
      case 'web_search':
        return this.webSearch.search(toolCall.arguments);
      default:
        return `Error: Unknown tool "${toolCall.name}". Available tools: ${codingToolNames(this.webSearchEnabled()).join(', ')}. Do not call "${toolCall.name}" again.`;
    }
  }

  private async listFiles(project: Project, args: Record<string, unknown>): Promise<string> {
    const relativePath = typeof args.path === 'string' ? args.path : '.';
    const maxDepth = typeof args.maxDepth === 'number' ? args.maxDepth : 2;
    const target = await this.paths.resolveExistingDirectory(project.workspacePath, relativePath);
    const tree = await this.scanFiles(project.workspacePath, target, maxDepth);
    return JSON.stringify(tree, null, 2);
  }

  private async readFile(project: Project, args: Record<string, unknown>): Promise<string> {
    if (typeof args.path !== 'string') {
      throw new BadRequestException('read_file requires path.');
    }
    const target = await this.paths.resolveExistingProjectPath(project.workspacePath, args.path);
    const info = await stat(target);
    if (!info.isFile() || info.size > 512 * 1024) {
      throw new BadRequestException('File is not readable through this tool.');
    }
    return readFile(target, 'utf8');
  }

  private async searchText(project: Project, args: Record<string, unknown>): Promise<string> {
    if (typeof args.query !== 'string') {
      throw new BadRequestException('search_text requires query.');
    }
    const relativePath = typeof args.path === 'string' ? args.path : '.';
    const maxResults = typeof args.maxResults === 'number' ? args.maxResults : 50;
    const target = await this.paths.resolveExistingProjectPath(project.workspacePath, relativePath);
    const files = await this.collectFiles(target, 5);
    const results: Array<{ path: string; line: number; text: string }> = [];

    for (const file of files) {
      if (results.length >= maxResults) break;
      const safeFile = await this.paths.assertExistingAbsolutePathInsideRoot(project.workspacePath, file);
      const info = await stat(safeFile);
      if (info.size > 512 * 1024) continue;
      const content = await readFile(safeFile, 'utf8').catch(() => '');
      const lines = content.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (results.length < maxResults && line.includes(args.query as string)) {
          results.push({
            path: safeFile.replace(project.workspacePath, '').replaceAll('\\', '/').replace(/^\//, ''),
            line: index + 1,
            text: line,
          });
        }
      });
    }

    return JSON.stringify(results, null, 2);
  }

  private async applyPatch(
    toolCall: ToolCall,
    owner: User,
    project: Project,
    args: Record<string, unknown>,
  ): Promise<string> {
    const proposed = await this.ensureProposedPatches(toolCall, project, args);
    if (proposed.length === 0) {
      throw new BadRequestException('There are no proposed patches to apply.');
    }
    const conflicts: FilePatch[] = [];

    for (const patch of proposed) {
      const target = await this.paths.resolveNewProjectPath(project.workspacePath, patch.relativePath);
      const currentContent = existsSync(target) ? await readFile(target, 'utf8') : null;
      const originalContent = patch.originalContent ?? null;
      if (currentContent !== originalContent) {
        conflicts.push(patch);
      }
    }

    if (conflicts.length > 0) {
      await Promise.all(
        conflicts.map((patch) => {
          patch.status = FilePatchStatus.Conflicted;
          return this.patches.save(patch);
        }),
      );
      throw new BadRequestException(
        `Patch conflict detected for ${conflicts.map((patch) => patch.relativePath).join(', ')}. Regenerate the patch from the latest file contents.`,
      );
    }

    for (const patch of proposed) {
      const target = await this.paths.resolveNewProjectPath(project.workspacePath, patch.relativePath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, patch.patchedContent, 'utf8');
      patch.status = FilePatchStatus.Applied;
      await this.patches.save(patch);
      await this.audit.record({
        actor: owner,
        action: 'tool.patch_applied',
        resourceType: 'file_patch',
        resourceId: patch.id,
        metadata: { path: patch.relativePath, toolCallId: toolCall.id },
      });
      this.events.publish(toolCall.session.id, 'patch_created', {
        patchId: patch.id,
        path: patch.relativePath,
        status: patch.status,
        targetPaths: [patch.relativePath],
        activity: 'patch_applied',
      });
    }

    return `Patch applied to ${proposed.map((patch) => patch.relativePath).join(', ')}.`;
  }

  private async runCommand(
    toolCall: ToolCall,
    owner: User,
    project: Project,
    args: Record<string, unknown>,
    commandAuthorized: boolean,
  ): Promise<string> {
    if (typeof args.command !== 'string') {
      throw new BadRequestException('run_command requires command.');
    }
    const cwd =
      typeof args.cwd === 'string'
        ? await this.paths.resolveExistingDirectory(project.workspacePath, args.cwd)
        : await this.paths.resolveExistingDirectory(project.workspacePath, '.');
    const parsed = commandAuthorized
      ? this.commandPolicy.parseAuthorized(args.command)
      : await this.commandPolicy.parse(args.command, project.id);

    const run = await this.commandRuns.save(
      this.commandRuns.create({
        project,
        session: toolCall.session,
        toolCall,
        command: args.command,
        cwd,
        status: CommandRunStatus.Running,
      }),
    );
    this.events.publish(toolCall.session.id, 'command_started', this.serializeCommandRun(run));

    const result =
      parsed.executionMode === 'shell'
        ? await this.spawnShellCommand(parsed.command, cwd)
        : await this.spawnCommand(parsed.command, parsed.args, cwd);
    run.exitCode = result.exitCode;
    run.stdout = result.stdout;
    run.stderr = result.stderr;
    run.status = result.exitCode === 0 ? CommandRunStatus.Succeeded : CommandRunStatus.Failed;
    await this.commandRuns.save(run);
    await this.audit.record({
      actor: owner,
      action: 'tool.command_run',
      resourceType: 'command_run',
      resourceId: run.id,
      metadata: { command: args.command, exitCode: result.exitCode },
    });
    this.events.publish(toolCall.session.id, 'command_output', {
      commandRunId: run.id,
      command: args.command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
    return `Command exited with ${result.exitCode}.\n${result.stdout}\n${result.stderr}`.trim();
  }

  private async findPendingApproval(ownerId: string, approvalId: string): Promise<ToolApproval> {
    const approval = await this.approvals.findOne({
      where: {
        id: approvalId,
        requester: { id: ownerId },
        status: ApprovalStatus.Pending,
      },
      relations: { toolCall: { session: { project: true }, turn: true }, requester: true },
    });
    if (!approval) {
      throw new NotFoundException('Pending approval not found.');
    }
    return approval;
  }

  private serializeCommandRun(run: CommandRun) {
    return {
      id: run.id,
      command: run.command,
      cwd: run.cwd,
      status: run.status,
      exitCode: run.exitCode,
      stdout: run.stdout,
      stderr: run.stderr,
      createdAt: run.createdAt,
      toolCall: run.toolCall
        ? {
            id: run.toolCall.id,
            name: run.toolCall.name,
            status: run.toolCall.status,
          }
      : undefined,
    };
  }

  private async buildSessionCommandAuthorizationView(sessionId: string): Promise<CommandAuthorizationView> {
    const grant = await this.findSessionShellAutoRunGrant(sessionId);
    const createdBy = grant?.createdBy as User | undefined;
    return {
      shellAutoRun: Boolean(grant),
      canGrantShellAutoRun: !grant,
      grantedAt: grant?.createdAt,
      grantedById: createdBy?.id,
    };
  }

  private async findSessionShellAutoRunGrant(sessionId: string): Promise<SessionCommandGrant | null> {
    return this.sessionCommandGrants.findOne({
      where: {
        session: { id: sessionId },
        grantType: SESSION_SHELL_AUTORUN_GRANT,
      },
      relations: { createdBy: true },
    });
  }

  private async hasSessionShellAutoRunGrant(sessionId: string): Promise<boolean> {
    const grant = await this.sessionCommandGrants.findOne({
      where: {
        session: { id: sessionId },
        grantType: SESSION_SHELL_AUTORUN_GRANT,
      },
    });
    return Boolean(grant);
  }

  private async ensureSessionShellAutoRunGrant(session: Session, owner: User): Promise<boolean> {
    const existing = await this.findSessionShellAutoRunGrant(session.id);
    if (existing) {
      return false;
    }
    await this.sessionCommandGrants.save(
      this.sessionCommandGrants.create({
        session,
        createdBy: owner,
        grantType: SESSION_SHELL_AUTORUN_GRANT,
      }),
    );
    return true;
  }

  private async ensureSessionApprovalRule(
    toolCall: ToolCall,
    owner: User,
    input: { toolKind: string; pattern?: string; scope?: string },
  ): Promise<boolean> {
    const existingRules = await this.sessionApprovalRules.find({
      where: {
        session: { id: toolCall.session.id },
        toolKind: input.toolKind,
      },
    });
    const existing = existingRules.find(
      (rule) => (rule.pattern ?? null) === (input.pattern ?? null) && (rule.scope ?? null) === (input.scope ?? null),
    );
    if (existing) {
      return false;
    }
    await this.sessionApprovalRules.save(
      this.sessionApprovalRules.create({
        session: toolCall.session,
        createdBy: owner,
        toolKind: input.toolKind,
        pattern: input.pattern,
        scope: input.scope,
      }),
    );
    return true;
  }

  private buildToolActivityPayload(
    toolName: string,
    args: Record<string, unknown>,
    status: ToolActivityStatus,
    activity: string,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      status,
      ...this.buildToolMetadata(toolName, args, activity),
    };
    if (status === 'using_tools') {
      payload.tools = [toolName];
    }
    return payload;
  }

  private buildToolMetadata(
    toolName: string,
    args: Record<string, unknown>,
    activity: string,
  ): Record<string, unknown> {
    const metadata: Record<string, unknown> = {
      toolName,
      activity,
    };
    const targetPaths = this.extractToolTargetPaths(toolName, args);
    if (targetPaths.length > 0) {
      metadata.targetPaths = targetPaths;
    }
    if (toolName === 'run_command' && typeof args.command === 'string') {
      metadata.command = args.command;
    }
    if (toolName === 'web_search' && typeof args.query === 'string') {
      metadata.query = args.query;
    }
    return metadata;
  }

  private extractToolTargetPaths(toolName: string, args: Record<string, unknown>): string[] {
    if (toolName !== 'create_patch') {
      return [];
    }

    const rawPaths = Array.isArray(args.files)
      ? args.files.map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>).path : undefined))
      : [args.path];
    return rawPaths
      .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
      .map((path) => path.trim().replaceAll('\\', '/'));
  }

  private async ensureProposedPatches(
    toolCall: ToolCall,
    project: Project,
    args: Record<string, unknown>,
  ): Promise<FilePatch[]> {
    const existing = await this.patches.find({
      where: { toolCall: { id: toolCall.id } },
      order: { createdAt: 'ASC' },
    });
    if (existing.length > 0) {
      return existing.filter((patch) => patch.status === FilePatchStatus.Proposed);
    }
    return this.createProposedPatches(toolCall, project, args);
  }

  private async createProposedPatches(
    toolCall: ToolCall,
    project: Project,
    args: Record<string, unknown>,
  ): Promise<FilePatch[]> {
    const files = this.normalizePatchFiles(args);
    const patches: FilePatch[] = [];

    for (const file of files) {
      const target = await this.paths.resolveNewProjectPath(project.workspacePath, file.path);
      const originalContent = existsSync(target) ? await readFile(target, 'utf8') : null;
      const diff = this.makeDiff(file.path, originalContent ?? '', file.content);
      patches.push(
        this.patches.create({
          project,
          session: toolCall.session,
          toolCall,
          relativePath: file.path,
          originalContent: originalContent ?? undefined,
          patchedContent: file.content,
          diffText: diff.diffText,
          status: FilePatchStatus.Proposed,
        }),
      );
    }

    return this.patches.save(patches);
  }

  private normalizePatchFiles(args: Record<string, unknown>): PatchInputFile[] {
    const rawFiles = Array.isArray(args.files)
      ? args.files.map((item) => {
          if (!item || typeof item !== 'object') {
            throw new BadRequestException('create_patch files must contain objects.');
          }
          const file = item as Record<string, unknown>;
          return { path: file.path, content: file.content };
        })
      : [{ path: args.path, content: args.content }];

    const files = rawFiles.map((file) => {
      if (typeof file.path !== 'string' || typeof file.content !== 'string') {
        throw new BadRequestException('create_patch requires path and content.');
      }
      const path = this.paths.normalizeRelativePath(file.path);
      if (path === '.') {
        throw new BadRequestException('create_patch path must be a file.');
      }
      if (Buffer.byteLength(file.content, 'utf8') > 512 * 1024) {
        throw new BadRequestException(`Patch content for ${path} is too large.`);
      }
      return { path, content: file.content };
    });

    if (files.length === 0) {
      throw new BadRequestException('create_patch requires at least one file.');
    }

    const seen = new Set<string>();
    files.forEach((file) => {
      if (seen.has(file.path)) {
        throw new BadRequestException(`Duplicate patch path: ${file.path}`);
      }
      seen.add(file.path);
    });
    return files;
  }

  private async scanFiles(projectRoot: string, currentPath: string, depth: number): Promise<unknown[]> {
    const entries = await readdir(currentPath, { withFileTypes: true });
    const nodes: unknown[] = [];
    for (const entry of entries.filter((item) => !this.isBlockedEntry(item)).slice(0, 200)) {
      const absolute = join(currentPath, entry.name);
      const node: Record<string, unknown> = {
        name: entry.name,
        path: absolute.replace(projectRoot, '').replaceAll('\\', '/').replace(/^\//, ''),
        type: entry.isDirectory() ? 'directory' : 'file',
      };
      if (entry.isDirectory() && depth > 0) {
        node.children = await this.scanFiles(projectRoot, absolute, depth - 1);
      }
      nodes.push(node);
    }
    return nodes;
  }

  private async collectFiles(currentPath: string, depth: number): Promise<string[]> {
    const info = await stat(currentPath);
    if (info.isFile()) {
      return [currentPath];
    }
    if (depth <= 0) {
      return [];
    }
    const entries = await readdir(currentPath, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries.filter((item) => !this.isBlockedEntry(item)).slice(0, 200)) {
      files.push(...(await this.collectFiles(join(currentPath, entry.name), depth - 1)));
    }
    return files;
  }

  private isBlockedEntry(entry: { name: string; isDirectory(): boolean }): boolean {
    return entry.isDirectory() ? this.paths.shouldIgnoreDirectory(entry.name) : entry.name === '.env';
  }

  private async buildApprovalPreview(approval: ToolApproval): Promise<ApprovalPreview | undefined> {
    const toolCall = approval.toolCall;
    if (toolCall.name === 'run_command' && typeof toolCall.arguments.command === 'string') {
      const project = toolCall.session.project as Project;
      const inspection = await this.commandPolicy.inspect(toolCall.arguments.command, project.id);
      const sessionAutoRunActive = matchesSessionApprovalRule(
        {
          name: 'run_command',
          args: toolCall.arguments,
          commandInspection: inspection,
        },
        await this.effectiveSessionApprovalRules(toolCall.session.id),
      );
      return {
        kind: 'command',
        command: toolCall.arguments.command,
        cwd: typeof toolCall.arguments.cwd === 'string' ? toolCall.arguments.cwd : undefined,
        policyAllowed: inspection.allowed,
        policySource: inspection.source,
        executionMode: inspection.executionMode,
        shellTokens: inspection.shellTokens,
        sessionAutoRunActive,
        canGrantSessionAutoRun: !sessionAutoRunActive,
        truncated: false,
      };
    }
    if (toolCall.name !== 'create_patch') {
      return undefined;
    }

    const project = toolCall.session.project as Project;
    const patches = await this.ensureProposedPatches(toolCall, project, toolCall.arguments);
    if (patches.length === 1) {
      const [patch] = patches;
      return {
        kind: 'patch',
        path: patch.relativePath,
        diffText: patch.diffText,
        truncated: patch.diffText.length > DIFF_PREVIEW_LIMIT,
      };
    }

    const files = patches.map((patch) => ({
      path: patch.relativePath,
      diffText: patch.diffText,
      truncated: patch.diffText.length > DIFF_PREVIEW_LIMIT,
      status: patch.status,
    }));
    return {
      kind: 'patch_set',
      files,
      truncated: files.some((file) => file.truncated),
    };
  }

  private makeDiff(path: string, before: string, after: string): { diffText: string; truncated: boolean } {
    const beforePreview = this.truncateForDiff(before);
    const afterPreview = this.truncateForDiff(after);
    const beforeLines = beforePreview.value.split(/\r?\n/);
    const afterLines = afterPreview.value.split(/\r?\n/);
    const rows = this.diffLines(beforeLines, afterLines);
    return {
      diffText: [`--- ${path}`, `+++ ${path}`, '@@', ...rows].join('\n'),
      truncated: beforePreview.truncated || afterPreview.truncated,
    };
  }

  private truncateForDiff(value: string): { value: string; truncated: boolean } {
    if (value.length <= DIFF_PREVIEW_LIMIT) {
      return { value, truncated: false };
    }
    return {
      value: `${value.slice(0, DIFF_PREVIEW_LIMIT)}\n[diff preview truncated]`,
      truncated: true,
    };
  }

  private diffLines(before: string[], after: string[]): string[] {
    const table = Array.from({ length: before.length + 1 }, () =>
      Array.from({ length: after.length + 1 }, () => 0),
    );
    for (let i = before.length - 1; i >= 0; i -= 1) {
      for (let j = after.length - 1; j >= 0; j -= 1) {
        table[i][j] =
          before[i] === after[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }

    const rows: string[] = [];
    let i = 0;
    let j = 0;
    while (i < before.length && j < after.length) {
      if (before[i] === after[j]) {
        rows.push(` ${before[i]}`);
        i += 1;
        j += 1;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        rows.push(`-${before[i]}`);
        i += 1;
      } else {
        rows.push(`+${after[j]}`);
        j += 1;
      }
    }
    while (i < before.length) {
      rows.push(`-${before[i]}`);
      i += 1;
    }
    while (j < after.length) {
      rows.push(`+${after[j]}`);
      j += 1;
    }
    return rows;
  }

  private spawnCommand(
    command: string,
    args: string[],
    cwd: string,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(command, args, { cwd, shell: false });
      let stdout = '';
      let stderr = '';
      const killTimer = setTimeout(() => child.kill(), 30_000);
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(killTimer);
        resolve({ exitCode: 1, stdout, stderr: stderr + error.message });
      });
      child.on('close', (code) => {
        clearTimeout(killTimer);
        resolve({
          exitCode: code ?? 1,
          stdout: stdout.slice(-20_000),
          stderr: stderr.slice(-20_000),
        });
      });
    });
  }

  private spawnShellCommand(
    command: string,
    cwd: string,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(command, [], { cwd, shell: resolveCommandRuntime().shellExecutable });
      let stdout = '';
      let stderr = '';
      const killTimer = setTimeout(() => child.kill(), 30_000);
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(killTimer);
        resolve({ exitCode: 1, stdout, stderr: stderr + error.message });
      });
      child.on('close', (code) => {
        clearTimeout(killTimer);
        resolve({
          exitCode: code ?? 1,
          stdout: stdout.slice(-20_000),
          stderr: stderr.slice(-20_000),
        });
      });
    });
  }

  private encodeResumeContext(resumeContext?: PendingToolResumeContext): string | undefined {
    if (!resumeContext) {
      return undefined;
    }
    return JSON.stringify({ kind: 'pending_tool_resume', payload: resumeContext });
  }

  private decodeResumeContext(value?: string): PendingToolResumeContext | null {
    if (!value) {
      return null;
    }
    try {
      const parsed = JSON.parse(value) as {
        kind?: string;
        payload?: PendingToolResumeContext;
      };
      if (parsed.kind !== 'pending_tool_resume' || !parsed.payload) {
        return null;
      }
      return parsed.payload;
    } catch {
      return null;
    }
  }
}
