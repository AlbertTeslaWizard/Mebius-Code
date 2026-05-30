import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { spawn } from 'child_process';
import { Dirent } from 'fs';
import { mkdir, readdir, readFile, stat } from 'fs/promises';
import { basename, join, relative } from 'path';
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
    await mkdir(project.workspacePath, { recursive: true });
    const existingFiles = await readdir(project.workspacePath);
    if (existingFiles.length > 0) {
      throw new BadRequestException('Workspace is not empty.');
    }

    await this.cloneRepository(dto.gitUrl, project.workspacePath, dto.branch);
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

  async readProjectFile(ownerId: string, projectId: string, relativePath: string): Promise<{
    path: string;
    content: string;
    size: number;
  }> {
    const project = await this.findOwned(ownerId, projectId);
    const absolutePath = this.paths.resolveProjectPath(project.workspacePath, relativePath);
    const info = await stat(absolutePath);
    if (!info.isFile()) {
      throw new BadRequestException('Path is not a file.');
    }
    if (info.size > 512 * 1024) {
      throw new BadRequestException('File is too large to read through the API.');
    }
    return {
      path: this.toRelative(project.workspacePath, absolutePath),
      content: await readFile(absolutePath, 'utf8'),
      size: info.size,
    };
  }

  async buildTree(ownerId: string, projectId: string, relativePath = '.', depth = 3): Promise<TreeNode[]> {
    const project = await this.findOwned(ownerId, projectId);
    const root = this.paths.resolveProjectPath(project.workspacePath, relativePath);
    return this.readTree(project.workspacePath, root, depth);
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
}

