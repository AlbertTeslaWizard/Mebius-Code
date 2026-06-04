import { forwardRef, Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { Repository } from 'typeorm';
import {
  ApprovalStatus,
  CommandRunStatus,
  FilePatchStatus,
  ToolCallStatus,
} from '../../common/enums/tool-status.enum';
import { CommandPolicyService } from '../../common/security/command-policy.service';
import { PathSandboxService } from '../../common/security/path-sandbox.service';
import { AuditService } from '../audit/audit.service';
import { PendingToolResumeContext } from '../agent/agent-resume.types';
import { AgentService } from '../agent/agent.service';
import { EventsService } from '../events/events.service';
import { Project } from '../projects/project.entity';
import { SessionsService } from '../sessions/sessions.service';
import { User } from '../users/user.entity';
import { CommandRun } from './command-run.entity';
import { FilePatch } from './file-patch.entity';
import { ToolApproval } from './tool-approval.entity';
import { ToolCall } from './tool-call.entity';

const APPROVAL_REQUIRED_TOOLS = new Set(['create_patch', 'run_command']);
const DIFF_PREVIEW_LIMIT = 20_000;

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
      truncated: false;
    };

type PendingApprovalResponse = ToolApproval & {
  preview?: ApprovalPreview;
};

interface PatchInputFile {
  path: string;
  content: string;
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
    private readonly sessions: SessionsService,
    private readonly paths: PathSandboxService,
    private readonly commandPolicy: CommandPolicyService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    @Inject(forwardRef(() => AgentService))
    private readonly agent: AgentService,
  ) {}

  async requestOrExecute(input: {
    owner: User;
    sessionId: string;
    name: string;
    args: Record<string, unknown>;
    resumeContext?: PendingToolResumeContext;
  }): Promise<ToolCall> {
    const session = await this.sessions.findOwned(input.owner.id, input.sessionId);
    const requiresApproval = APPROVAL_REQUIRED_TOOLS.has(input.name);
    const toolCall = await this.toolCalls.save(
      this.toolCalls.create({
        session,
        name: input.name,
        arguments: input.args,
        requiresApproval,
        status: requiresApproval ? ToolCallStatus.PendingApproval : ToolCallStatus.Running,
        resultText: requiresApproval ? this.encodeResumeContext(input.resumeContext) : undefined,
      }),
    );

    if (requiresApproval) {
      if (input.name === 'create_patch') {
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
      });
      return toolCall;
    }

    const result = await this.executeTool(toolCall, input.owner);
    toolCall.status = ToolCallStatus.Succeeded;
    toolCall.resultText = result;
    const saved = await this.toolCalls.save(toolCall);
    this.events.publish(session.id, 'tool_call_result', {
      toolCallId: saved.id,
      name: saved.name,
      result,
    });
    return saved;
  }

  async pending(ownerId: string): Promise<PendingApprovalResponse[]> {
    const approvals = await this.approvals.find({
      where: {
        status: ApprovalStatus.Pending,
        requester: { id: ownerId },
      },
      relations: { toolCall: { session: { project: true } }, requester: true },
      order: { createdAt: 'DESC' },
    });
    return Promise.all(
      approvals.map(async (approval) => ({
        ...approval,
        preview: await this.buildApprovalPreview(approval),
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
    const runs = await this.commandRuns.find({
      where: { session: { id: session.id } },
      relations: { toolCall: true },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return runs.map((run) => this.serializeCommandRun(run));
  }

  async approve(owner: User, approvalId: string): Promise<ToolCall> {
    const approval = await this.findPendingApproval(owner.id, approvalId);
    approval.status = ApprovalStatus.Approved;
    approval.approver = owner;
    await this.approvals.save(approval);

    const toolCall = approval.toolCall;
    const resumeContext = this.decodeResumeContext(toolCall.resultText);
    toolCall.status = ToolCallStatus.Running;
    await this.toolCalls.save(toolCall);
    this.events.publish(toolCall.session.id, 'agent_status', {
      status: 'using_tools',
      toolName: toolCall.name,
      tools: [toolCall.name],
    });

    try {
      const result = await this.executeTool(toolCall, owner);
      toolCall.status = ToolCallStatus.Succeeded;
      toolCall.resultText = result;
      const saved = await this.toolCalls.save(toolCall);
      this.events.publish(toolCall.session.id, 'tool_call_result', {
        toolCallId: saved.id,
        name: saved.name,
        result,
      });
      if (resumeContext) {
        await this.agent.recordToolResultMessage(
          saved.session,
          resumeContext.approvedToolCallId,
          saved.name,
          saved.status,
          result,
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
      });
      if (resumeContext) {
        await this.agent.recordToolResultMessage(
          saved.session,
          resumeContext.approvedToolCallId,
          saved.name,
          saved.status,
          saved.resultText ?? 'Tool execution failed.',
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
    if (patch.status !== FilePatchStatus.Applied) {
      throw new BadRequestException('Only applied patches can be reverted.');
    }

    const project = patch.project as Project;
    const target = this.paths.resolveProjectPath(project.workspacePath, patch.relativePath);
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

  private async executeTool(toolCall: ToolCall, owner: User): Promise<string> {
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
        return this.runCommand(toolCall, owner, project, toolCall.arguments);
      default:
        throw new BadRequestException(`Unknown tool: ${toolCall.name}`);
    }
  }

  private async listFiles(project: Project, args: Record<string, unknown>): Promise<string> {
    const relativePath = typeof args.path === 'string' ? args.path : '.';
    const maxDepth = typeof args.maxDepth === 'number' ? args.maxDepth : 2;
    const target = this.paths.resolveProjectPath(project.workspacePath, relativePath);
    const tree = await this.scanFiles(project.workspacePath, target, maxDepth);
    return JSON.stringify(tree, null, 2);
  }

  private async readFile(project: Project, args: Record<string, unknown>): Promise<string> {
    if (typeof args.path !== 'string') {
      throw new BadRequestException('read_file requires path.');
    }
    const target = this.paths.resolveProjectPath(project.workspacePath, args.path);
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
    const target = this.paths.resolveProjectPath(project.workspacePath, relativePath);
    const files = await this.collectFiles(target, 5);
    const results: Array<{ path: string; line: number; text: string }> = [];

    for (const file of files) {
      if (results.length >= maxResults) break;
      const info = await stat(file);
      if (info.size > 512 * 1024) continue;
      const content = await readFile(file, 'utf8').catch(() => '');
      const lines = content.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (results.length < maxResults && line.includes(args.query as string)) {
          results.push({
            path: file.replace(project.workspacePath, '').replaceAll('\\', '/').replace(/^\//, ''),
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
      const target = this.paths.resolveProjectPath(project.workspacePath, patch.relativePath);
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
      const target = this.paths.resolveProjectPath(project.workspacePath, patch.relativePath);
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
      });
    }

    return `Patch applied to ${proposed.map((patch) => patch.relativePath).join(', ')}.`;
  }

  private async runCommand(
    toolCall: ToolCall,
    owner: User,
    project: Project,
    args: Record<string, unknown>,
  ): Promise<string> {
    if (typeof args.command !== 'string') {
      throw new BadRequestException('run_command requires command.');
    }
    const cwd =
      typeof args.cwd === 'string'
        ? this.paths.resolveProjectPath(project.workspacePath, args.cwd)
        : project.workspacePath;
    const parsed = this.commandPolicy.parse(args.command);

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

    const result = await this.spawnCommand(parsed.command, parsed.args, cwd);
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
      relations: { toolCall: { session: { project: true } }, requester: true },
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
      const target = this.paths.resolveProjectPath(project.workspacePath, file.path);
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
    for (const entry of entries.filter((item) => !this.isBlockedName(item.name)).slice(0, 200)) {
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
    for (const entry of entries.filter((item) => !this.isBlockedName(item.name)).slice(0, 200)) {
      files.push(...(await this.collectFiles(join(currentPath, entry.name), depth - 1)));
    }
    return files;
  }

  private isBlockedName(name: string): boolean {
    return ['.git', '.env', 'node_modules', 'dist', 'coverage'].includes(name);
  }

  private async buildApprovalPreview(approval: ToolApproval): Promise<ApprovalPreview | undefined> {
    const toolCall = approval.toolCall;
    if (toolCall.name === 'run_command' && typeof toolCall.arguments.command === 'string') {
      return {
        kind: 'command',
        command: toolCall.arguments.command,
        cwd: typeof toolCall.arguments.cwd === 'string' ? toolCall.arguments.cwd : undefined,
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
