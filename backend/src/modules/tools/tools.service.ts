import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises';
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
import { EventsService } from '../events/events.service';
import { Project } from '../projects/project.entity';
import { SessionsService } from '../sessions/sessions.service';
import { User } from '../users/user.entity';
import { CommandRun } from './command-run.entity';
import { FilePatch } from './file-patch.entity';
import { ToolApproval } from './tool-approval.entity';
import { ToolCall } from './tool-call.entity';

const APPROVAL_REQUIRED_TOOLS = new Set(['create_patch', 'run_command']);

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
  ) {}

  async requestOrExecute(input: {
    owner: User;
    sessionId: string;
    name: string;
    args: Record<string, unknown>;
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
      }),
    );

    if (requiresApproval) {
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

  async pending(ownerId: string): Promise<ToolApproval[]> {
    return this.approvals.find({
      where: {
        status: ApprovalStatus.Pending,
        requester: { id: ownerId },
      },
      relations: { toolCall: { session: { project: true } }, requester: true },
      order: { createdAt: 'DESC' },
    });
  }

  async approve(owner: User, approvalId: string): Promise<ToolCall> {
    const approval = await this.findPendingApproval(owner.id, approvalId);
    approval.status = ApprovalStatus.Approved;
    approval.approver = owner;
    await this.approvals.save(approval);

    const toolCall = approval.toolCall;
    toolCall.status = ToolCallStatus.Running;
    await this.toolCalls.save(toolCall);

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
      return saved;
    } catch (error) {
      toolCall.status = ToolCallStatus.Failed;
      toolCall.resultText = error instanceof Error ? error.message : 'Tool execution failed.';
      return this.toolCalls.save(toolCall);
    }
  }

  async reject(owner: User, approvalId: string): Promise<ToolApproval> {
    const approval = await this.findPendingApproval(owner.id, approvalId);
    approval.status = ApprovalStatus.Rejected;
    approval.approver = owner;
    approval.toolCall.status = ToolCallStatus.Rejected;
    await this.toolCalls.save(approval.toolCall);
    return this.approvals.save(approval);
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
    if (typeof args.path !== 'string' || typeof args.content !== 'string') {
      throw new BadRequestException('create_patch requires path and content.');
    }
    const target = this.paths.resolveProjectPath(project.workspacePath, args.path);
    const originalContent = existsSync(target) ? await readFile(target, 'utf8') : '';
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, args.content, 'utf8');

    const patch = await this.patches.save(
      this.patches.create({
        project,
        session: toolCall.session,
        toolCall,
        relativePath: args.path,
        originalContent,
        patchedContent: args.content,
        diffText: this.makeSimpleDiff(args.path, originalContent, args.content),
        status: FilePatchStatus.Applied,
      }),
    );

    await this.audit.record({
      actor: owner,
      action: 'tool.patch_applied',
      resourceType: 'file_patch',
      resourceId: patch.id,
      metadata: { path: args.path, toolCallId: toolCall.id },
    });
    this.events.publish(toolCall.session.id, 'patch_created', {
      patchId: patch.id,
      path: patch.relativePath,
      status: patch.status,
    });
    return `Patch applied to ${args.path}.`;
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

  private makeSimpleDiff(path: string, before: string, after: string): string {
    return [`--- ${path}`, `+++ ${path}`, '@@', `-${before}`, `+${after}`].join('\n');
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
}

