import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { spawn } from 'child_process';
import { Dirent } from 'fs';
import { readdir, readFile, rm, stat } from 'fs/promises';
import { basename, join, relative, resolve } from 'path';
import { Repository } from 'typeorm';
import { PathSandboxService } from '../../common/security/path-sandbox.service';
import { AuditService } from '../audit/audit.service';
import { User } from '../users/user.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { ImportGitDto } from './dto/import-git.dto';
import { Project, ProjectSourceType } from './project.entity';

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

export interface GitRemoteInfo {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

export interface GitStatusFile {
  path: string;
  indexStatus: string;
  workTreeStatus: string;
  state: 'untracked' | 'staged' | 'modified' | 'deleted' | 'renamed' | 'conflicted' | 'unknown';
}

export interface GitStatusView {
  isGitRepo: boolean;
  branch: string | null;
  tracking: string | null;
  ahead: number;
  behind: number;
  hasRemote: boolean;
  remotes: GitRemoteInfo[];
  files: GitStatusFile[];
  counts: {
    staged: number;
    unstaged: number;
    untracked: number;
  };
}

export interface GitCommitResult {
  summary: string;
  commitSha: string;
}

export interface GitActionResult {
  summary: string;
}

export interface GitPushResult {
  summary: string;
  branch: string | null;
  remote: string | null;
}

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    private readonly paths: PathSandboxService,
    private readonly audit: AuditService,
  ) {}

  async create(owner: User, dto: CreateProjectDto): Promise<Project> {
    const project = await this.projects.save(
      this.projects.create({
        owner,
        name: dto.name,
        description: dto.description,
        sourceType: ProjectSourceType.Manual,
        workspacePath: '',
      }),
    );
    project.workspacePath = await this.paths.ensureProjectRoot(project.id);
    const saved = await this.projects.save(project);
    await this.audit.record({
      actor: owner,
      action: 'project.created',
      resourceType: 'project',
      resourceId: saved.id,
    });
    return saved;
  }

  async list(ownerId: string): Promise<Project[]> {
    return this.projects.find({
      where: { owner: { id: ownerId } },
      order: { createdAt: 'DESC' },
    });
  }

  async findOwned(ownerId: string, projectId: string): Promise<Project> {
    const project = await this.projects.findOne({
      where: { id: projectId, owner: { id: ownerId } },
      relations: { owner: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }
    return project;
  }

  async importGit(owner: User, projectId: string, dto: ImportGitDto): Promise<Project> {
    const project = await this.findOwned(owner.id, projectId);
    const workspacePath = await this.ensureCurrentWorkspacePath(project);
    const existingFiles = await readdir(workspacePath);
    if (existingFiles.length > 0) {
      throw new BadRequestException('Workspace is not empty.');
    }

    await this.cloneRepository(dto.gitUrl, workspacePath, dto.branch);
    project.sourceType = ProjectSourceType.Git;
    project.gitUrl = dto.gitUrl;
    const saved = await this.projects.save(project);
    await this.audit.record({
      actor: owner,
      action: 'project.git_imported',
      resourceType: 'project',
      resourceId: project.id,
      metadata: { gitUrl: dto.gitUrl, branch: dto.branch },
    });
    return saved;
  }

  async remove(owner: User, projectId: string): Promise<{ deleted: true }> {
    const project = await this.findOwned(owner.id, projectId);
    const workspacePath = this.paths.assertExactProjectRoot(
      project.id,
      this.paths.getProjectRoot(project.id),
    );

    await this.audit.record({
      actor: owner,
      action: 'project.deleted',
      resourceType: 'project',
      resourceId: project.id,
      metadata: {
        workspacePath,
        persistedWorkspacePath: project.workspacePath,
      },
    });
    await this.projects.remove(project);
    await rm(workspacePath, { recursive: true, force: true });

    return { deleted: true };
  }

  async readProjectFile(ownerId: string, projectId: string, relativePath: string): Promise<{
    path: string;
    content: string;
    size: number;
  }> {
    const project = await this.findOwned(ownerId, projectId);
    const projectRoot = await this.ensureCurrentWorkspacePath(project);
    const absolutePath = this.paths.resolveProjectPath(projectRoot, relativePath);
    const info = await stat(absolutePath);
    if (!info.isFile()) {
      throw new BadRequestException('Path is not a file.');
    }
    if (info.size > 512 * 1024) {
      throw new BadRequestException('File is too large to read through the API.');
    }
    return {
      path: this.toRelative(projectRoot, absolutePath),
      content: await readFile(absolutePath, 'utf8'),
      size: info.size,
    };
  }

  async buildTree(ownerId: string, projectId: string, relativePath = '.', depth = 3): Promise<TreeNode[]> {
    const project = await this.findOwned(ownerId, projectId);
    const projectRoot = await this.ensureCurrentWorkspacePath(project);
    const root = this.paths.resolveProjectPath(projectRoot, relativePath);
    return this.readTree(projectRoot, root, depth);
  }

  async gitStatus(ownerId: string, projectId: string): Promise<GitStatusView> {
    const project = await this.findOwned(ownerId, projectId);
    const projectRoot = await this.ensureCurrentWorkspacePath(project);
    const isGitRepo = await this.isGitRepository(projectRoot);
    if (!isGitRepo) {
      return {
        isGitRepo: false,
        branch: null,
        tracking: null,
        ahead: 0,
        behind: 0,
        hasRemote: false,
        remotes: [],
        files: [],
        counts: { staged: 0, unstaged: 0, untracked: 0 },
      };
    }

    const [statusResult, remotes] = await Promise.all([
      this.runGit(projectRoot, ['status', '--short', '--branch']),
      this.listGitRemotes(projectRoot),
    ]);
    return this.parseGitStatus(statusResult.stdout, remotes);
  }

  async stageGitPath(owner: User, projectId: string, filePath: string): Promise<GitActionResult> {
    const project = await this.findOwned(owner.id, projectId);
    const projectRoot = await this.ensureCurrentWorkspacePath(project);
    await this.assertGitRepository(projectRoot);
    const safePath = this.paths.normalizeRelativePath(filePath);

    await this.runGit(projectRoot, ['add', '--', safePath]);
    await this.audit.record({
      actor: owner,
      action: 'project.git_staged',
      resourceType: 'project',
      resourceId: project.id,
      metadata: { path: safePath },
    });
    return {
      summary: `Staged ${safePath}.`,
    };
  }

  async unstageGitPath(owner: User, projectId: string, filePath: string): Promise<GitActionResult> {
    const project = await this.findOwned(owner.id, projectId);
    const projectRoot = await this.ensureCurrentWorkspacePath(project);
    await this.assertGitRepository(projectRoot);
    const safePath = this.paths.normalizeRelativePath(filePath);

    await this.runGit(projectRoot, ['restore', '--staged', '--', safePath]);
    await this.audit.record({
      actor: owner,
      action: 'project.git_unstaged',
      resourceType: 'project',
      resourceId: project.id,
      metadata: { path: safePath },
    });
    return {
      summary: `Unstaged ${safePath}.`,
    };
  }

  async stageAllGit(owner: User, projectId: string): Promise<GitActionResult> {
    const project = await this.findOwned(owner.id, projectId);
    const projectRoot = await this.ensureCurrentWorkspacePath(project);
    await this.assertGitRepository(projectRoot);

    await this.runGit(projectRoot, ['add', '-A']);
    await this.audit.record({
      actor: owner,
      action: 'project.git_staged_all',
      resourceType: 'project',
      resourceId: project.id,
    });
    return {
      summary: 'Staged all changes.',
    };
  }

  async unstageAllGit(owner: User, projectId: string): Promise<GitActionResult> {
    const project = await this.findOwned(owner.id, projectId);
    const projectRoot = await this.ensureCurrentWorkspacePath(project);
    await this.assertGitRepository(projectRoot);

    await this.runGit(projectRoot, ['restore', '--staged', '.']);
    await this.audit.record({
      actor: owner,
      action: 'project.git_unstaged_all',
      resourceType: 'project',
      resourceId: project.id,
    });
    return {
      summary: 'Unstaged all changes.',
    };
  }

  async commitGit(
    owner: User,
    projectId: string,
    input: { message: string },
  ): Promise<GitCommitResult> {
    const message = input.message.trim();
    if (!message) {
      throw new BadRequestException('Commit message cannot be empty.');
    }

    const project = await this.findOwned(owner.id, projectId);
    const projectRoot = await this.ensureCurrentWorkspacePath(project);
    await this.assertGitRepository(projectRoot);
    const status = await this.gitStatus(owner.id, projectId);
    if (status.counts.staged === 0) {
      throw new BadRequestException('There are no staged changes to commit.');
    }

    const commitResult = await this.runGit(projectRoot, ['commit', '-m', message]);
    const commitSha = (await this.runGit(projectRoot, ['rev-parse', 'HEAD'])).stdout.trim();
    await this.audit.record({
      actor: owner,
      action: 'project.git_committed',
      resourceType: 'project',
      resourceId: project.id,
      metadata: { message, commitSha },
    });
    return {
      summary: this.compactCommandOutput(commitResult.stdout, commitResult.stderr) || 'Commit created.',
      commitSha,
    };
  }

  async pushGit(owner: User, projectId: string): Promise<GitPushResult> {
    const project = await this.findOwned(owner.id, projectId);
    const projectRoot = await this.ensureCurrentWorkspacePath(project);
    await this.assertGitRepository(projectRoot);

    const status = await this.gitStatus(owner.id, projectId);
    if (!status.hasRemote || status.remotes.length === 0) {
      throw new BadRequestException('This repository has no remote configured.');
    }

    const pushResult = await this.runGit(projectRoot, ['push']);
    const remote = status.remotes[0]?.name ?? null;
    await this.audit.record({
      actor: owner,
      action: 'project.git_pushed',
      resourceType: 'project',
      resourceId: project.id,
      metadata: { remote, branch: status.branch },
    });
    return {
      summary: this.compactCommandOutput(pushResult.stdout, pushResult.stderr) || 'Push completed.',
      branch: status.branch,
      remote,
    };
  }

  private async ensureCurrentWorkspacePath(project: Project): Promise<string> {
    const workspacePath = await this.paths.ensureProjectRoot(project.id);

    if (resolve(project.workspacePath) !== workspacePath) {
      project.workspacePath = workspacePath;
      await this.projects.save(project);
    }

    return workspacePath;
  }

  private async readTree(projectRoot: string, currentPath: string, depth: number): Promise<TreeNode[]> {
    const entries = await readdir(currentPath, { withFileTypes: true });
    const visibleEntries = entries
      .filter((entry) => !this.isHiddenOrBlocked(entry))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));

    const nodes: TreeNode[] = [];
    for (const entry of visibleEntries.slice(0, 200)) {
      const absolute = join(currentPath, entry.name);
      const node: TreeNode = {
        name: entry.name,
        path: this.toRelative(projectRoot, absolute),
        type: entry.isDirectory() ? 'directory' : 'file',
      };
      if (entry.isDirectory() && depth > 0) {
        node.children = await this.readTree(projectRoot, absolute, depth - 1);
      }
      nodes.push(node);
    }
    return nodes;
  }

  private isHiddenOrBlocked(entry: Dirent): boolean {
    return ['.git', '.env', 'node_modules', 'dist', 'coverage'].includes(entry.name);
  }

  private toRelative(projectRoot: string, absolutePath: string): string {
    const value = relative(projectRoot, absolutePath).replaceAll('\\', '/');
    return value || basename(projectRoot);
  }

  private cloneRepository(gitUrl: string, targetPath: string, branch?: string): Promise<void> {
    const args = ['clone', '--depth', '1'];
    if (branch) {
      args.push('--branch', branch);
    }
    args.push(gitUrl, targetPath);

    return new Promise((resolvePromise, reject) => {
      const child = spawn('git', args, { shell: false });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolvePromise();
        } else {
          reject(new BadRequestException(stderr || `git clone failed with exit code ${code}`));
        }
      });
    });
  }

  private async assertGitRepository(projectRoot: string): Promise<void> {
    if (!(await this.isGitRepository(projectRoot))) {
      throw new BadRequestException('This project is not a Git repository.');
    }
  }

  private async isGitRepository(projectRoot: string): Promise<boolean> {
    try {
      const result = await this.runGit(projectRoot, ['rev-parse', '--is-inside-work-tree'], true);
      return result.exitCode === 0 && result.stdout.trim() === 'true';
    } catch {
      return false;
    }
  }

  private async listGitRemotes(projectRoot: string): Promise<GitRemoteInfo[]> {
    const result = await this.runGit(projectRoot, ['remote', '-v'], true);
    if (result.exitCode !== 0) {
      return [];
    }

    const remotes = new Map<string, GitRemoteInfo>();
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
        if (!match) return;
        const [, name, url, kind] = match;
        const existing = remotes.get(name) ?? { name };
        if (kind === 'fetch') {
          existing.fetchUrl = url;
        } else {
          existing.pushUrl = url;
        }
        remotes.set(name, existing);
      });

    return [...remotes.values()];
  }

  private parseGitStatus(output: string, remotes: GitRemoteInfo[]): GitStatusView {
    const lines = output.split(/\r?\n/).filter(Boolean);
    const branchLine = lines[0]?.startsWith('## ') ? lines.shift()?.slice(3) ?? '' : '';
    const { branch, tracking, ahead, behind } = this.parseBranchLine(branchLine);
    const files = lines.map((line) => this.parseStatusLine(line));

    return {
      isGitRepo: true,
      branch,
      tracking,
      ahead,
      behind,
      hasRemote: remotes.length > 0,
      remotes,
      files,
      counts: {
        staged: files.filter((file) => file.indexStatus !== ' ' && file.indexStatus !== '?').length,
        unstaged: files.filter((file) => file.workTreeStatus !== ' ' && file.workTreeStatus !== '?').length,
        untracked: files.filter((file) => file.state === 'untracked').length,
      },
    };
  }

  private parseBranchLine(value: string): {
    branch: string | null;
    tracking: string | null;
    ahead: number;
    behind: number;
  } {
    if (!value) {
      return { branch: null, tracking: null, ahead: 0, behind: 0 };
    }

    const [head, divergencePart] = value.split(' [', 2);
    const [branchPart, trackingPart] = head.split('...', 2);
    const divergence = divergencePart?.replace(/\]$/, '') ?? '';
    const ahead = Number(divergence.match(/ahead (\d+)/)?.[1] ?? 0);
    const behind = Number(divergence.match(/behind (\d+)/)?.[1] ?? 0);
    return {
      branch: branchPart || null,
      tracking: trackingPart || null,
      ahead,
      behind,
    };
  }

  private parseStatusLine(line: string): GitStatusFile {
    const indexStatus = line[0] ?? ' ';
    const workTreeStatus = line[1] ?? ' ';
    const path = line.slice(3).trim();
    return {
      path,
      indexStatus,
      workTreeStatus,
      state: this.resolveGitFileState(indexStatus, workTreeStatus),
    };
  }

  private resolveGitFileState(indexStatus: string, workTreeStatus: string): GitStatusFile['state'] {
    if (indexStatus === '?' && workTreeStatus === '?') return 'untracked';
    if (indexStatus === 'U' || workTreeStatus === 'U') return 'conflicted';
    if (indexStatus === 'R' || workTreeStatus === 'R') return 'renamed';
    if (indexStatus === 'D' || workTreeStatus === 'D') return 'deleted';
    if (indexStatus !== ' ' && indexStatus !== '?') return 'staged';
    if (workTreeStatus === 'M') return 'modified';
    return 'unknown';
  }

  private compactCommandOutput(stdout: string, stderr: string): string {
    return [stdout.trim(), stderr.trim()].filter(Boolean).join('\n').trim();
  }

  private runGit(
    cwd: string,
    args: string[],
    allowFailure = false,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn('git', args, { cwd, shell: false });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        if (allowFailure) {
          resolvePromise({ exitCode: 1, stdout, stderr: stderr + error.message });
          return;
        }
        reject(new BadRequestException(error.message));
      });
      child.on('close', (code) => {
        const exitCode = code ?? 1;
        const result = {
          exitCode,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        };
        if (exitCode === 0 || allowFailure) {
          resolvePromise(result);
          return;
        }
        reject(new BadRequestException(result.stderr || result.stdout || `git ${args[0]} failed.`));
      });
    });
  }
}
