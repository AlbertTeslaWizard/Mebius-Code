import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { spawn } from 'child_process';
import { Dirent } from 'fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import { basename, delimiter, dirname, join, relative, resolve } from 'path';
import { Repository } from 'typeorm';
import { inflateRawSync } from 'zlib';
import { PathSandboxService } from '../../common/security/path-sandbox.service';
import { AuditService } from '../audit/audit.service';
import { User } from '../users/user.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { ImportGitDto } from './dto/import-git.dto';
import { Project, ProjectSourceType } from './project.entity';

export const PROJECT_ARCHIVE_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const PROJECT_ARCHIVE_MAX_EXTRACTED_BYTES = 100 * 1024 * 1024;
const PROJECT_ARCHIVE_MAX_FILES = 5000;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_MAX_EOCD_SEARCH_BYTES = 65_557;
const ZIP_COMPRESSION_STORE = 0;
const ZIP_COMPRESSION_DEFLATE = 8;
const ARCHIVE_BLOCKED_SEGMENTS = new Set(['.git', '.env', 'node_modules', 'dist', 'coverage']);

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
  pushableCommits: number;
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

export interface ProjectFileView {
  path: string;
  content: string;
  size: number;
}

export interface ArchiveUploadFile {
  originalname?: string;
  mimetype?: string;
  size?: number;
  buffer?: Buffer;
}

interface ZipEntry {
  path: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

interface ExtractedArchiveFile {
  path: string;
  content: Buffer;
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

  async importArchive(owner: User, projectId: string, file: ArchiveUploadFile): Promise<Project> {
    const project = await this.findOwned(owner.id, projectId);
    const workspacePath = await this.ensureCurrentWorkspacePath(project);
    const existingFiles = await readdir(workspacePath);
    if (existingFiles.length > 0) {
      throw new BadRequestException('Workspace is not empty.');
    }

    this.assertSupportedArchiveFile(file);
    const extractedFiles = this.extractZipArchive(file.buffer as Buffer);
    if (extractedFiles.length === 0) {
      throw new BadRequestException('Archive contains no importable files.');
    }

    for (const entry of extractedFiles) {
      const absolutePath = this.paths.resolveProjectPath(workspacePath, entry.path);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, entry.content);
    }

    project.sourceType = ProjectSourceType.Archive;
    project.gitUrl = null;
    const saved = await this.projects.save(project);
    await this.audit.record({
      actor: owner,
      action: 'project.archive_imported',
      resourceType: 'project',
      resourceId: project.id,
      metadata: {
        filename: file.originalname,
        size: file.size,
        files: extractedFiles.length,
      },
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

  async readProjectFile(ownerId: string, projectId: string, relativePath: string): Promise<ProjectFileView> {
    const project = await this.findOwned(ownerId, projectId);
    const projectRoot = await this.ensureCurrentWorkspacePath(project);
    const absolutePath = this.paths.resolveProjectPath(projectRoot, relativePath);
    const info = await this.assertReadableTextFile(absolutePath);
    return {
      path: this.toRelative(projectRoot, absolutePath),
      content: await readFile(absolutePath, 'utf8'),
      size: info.size,
    };
  }

  async saveProjectFile(
    owner: User,
    projectId: string,
    relativePath: string,
    content: string,
  ): Promise<ProjectFileView> {
    const project = await this.findOwned(owner.id, projectId);
    const projectRoot = await this.ensureCurrentWorkspacePath(project);
    const absolutePath = this.paths.resolveProjectPath(projectRoot, relativePath);
    await this.assertReadableTextFile(absolutePath);

    const byteLength = Buffer.byteLength(content, 'utf8');
    if (byteLength > 512 * 1024) {
      throw new BadRequestException('File content is too large to save through the API.');
    }

    await writeFile(absolutePath, content, 'utf8');
    const savedInfo = await stat(absolutePath);
    const safePath = this.toRelative(projectRoot, absolutePath);
    await this.audit.record({
      actor: owner,
      action: 'project.file_saved',
      resourceType: 'project',
      resourceId: project.id,
      metadata: { path: safePath, size: savedInfo.size },
    });

    return {
      path: safePath,
      content: await readFile(absolutePath, 'utf8'),
      size: savedInfo.size,
    };
  }

  async createProjectFile(
    owner: User,
    projectId: string,
    relativePath: string,
    content: string,
  ): Promise<ProjectFileView> {
    const project = await this.findOwned(owner.id, projectId);
    const projectRoot = await this.ensureCurrentWorkspacePath(project);
    const absolutePath = this.paths.resolveProjectPath(projectRoot, relativePath);
    if (absolutePath === projectRoot) {
      throw new BadRequestException('Path is not a file.');
    }

    const byteLength = Buffer.byteLength(content, 'utf8');
    if (byteLength > 512 * 1024) {
      throw new BadRequestException('File content is too large to save through the API.');
    }

    const existing = await stat(absolutePath).catch(() => null);
    if (existing) {
      throw new BadRequestException('File already exists.');
    }

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, 'utf8');
    const savedInfo = await stat(absolutePath);
    const safePath = this.toRelative(projectRoot, absolutePath);
    await this.audit.record({
      actor: owner,
      action: 'project.file_created',
      resourceType: 'project',
      resourceId: project.id,
      metadata: { path: safePath, size: savedInfo.size },
    });

    return {
      path: safePath,
      content: await readFile(absolutePath, 'utf8'),
      size: savedInfo.size,
    };
  }

  async deleteProjectFile(
    owner: User,
    projectId: string,
    relativePath: string,
  ): Promise<{ deleted: true; path: string }> {
    const project = await this.findOwned(owner.id, projectId);
    const projectRoot = await this.ensureCurrentWorkspacePath(project);
    const absolutePath = this.paths.resolveProjectPath(projectRoot, relativePath);
    await this.assertReadableTextFile(absolutePath);
    const safePath = this.toRelative(projectRoot, absolutePath);

    await rm(absolutePath);
    await this.audit.record({
      actor: owner,
      action: 'project.file_deleted',
      resourceType: 'project',
      resourceId: project.id,
      metadata: { path: safePath },
    });

    return { deleted: true, path: safePath };
  }

  async renameProjectFile(
    owner: User,
    projectId: string,
    relativePath: string,
    newRelativePath: string,
  ): Promise<ProjectFileView> {
    const project = await this.findOwned(owner.id, projectId);
    const projectRoot = await this.ensureCurrentWorkspacePath(project);
    const sourcePath = this.paths.resolveProjectPath(projectRoot, relativePath);
    await this.assertReadableTextFile(sourcePath);

    const targetPath = this.paths.resolveProjectPath(projectRoot, newRelativePath);
    if (targetPath === projectRoot) {
      throw new BadRequestException('Path is not a file.');
    }
    const existingTarget = await stat(targetPath).catch(() => null);
    if (existingTarget) {
      throw new BadRequestException('Target file already exists.');
    }

    await mkdir(dirname(targetPath), { recursive: true });
    await rename(sourcePath, targetPath);
    const savedInfo = await stat(targetPath);
    const safeSourcePath = this.toRelative(projectRoot, sourcePath);
    const safeTargetPath = this.toRelative(projectRoot, targetPath);
    await this.audit.record({
      actor: owner,
      action: 'project.file_renamed',
      resourceType: 'project',
      resourceId: project.id,
      metadata: { path: safeSourcePath, newPath: safeTargetPath, size: savedInfo.size },
    });

    return {
      path: safeTargetPath,
      content: await readFile(targetPath, 'utf8'),
      size: savedInfo.size,
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
        pushableCommits: 0,
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
    const status = this.parseGitStatus(statusResult.stdout, remotes);
    return {
      ...status,
      pushableCommits: await this.resolvePushableCommits(projectRoot, status),
    };
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
    if (status.pushableCommits <= 0) {
      throw new BadRequestException('There are no local commits to push.');
    }

    const remote = status.remotes[0]?.name ?? null;
    const pushArgs = status.tracking || !remote ? ['push'] : ['push', '-u', remote, 'HEAD'];
    const pushResult = await this.runGit(projectRoot, pushArgs);
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

  private async assertReadableTextFile(absolutePath: string) {
    const info = await stat(absolutePath);
    if (!info.isFile()) {
      throw new BadRequestException('Path is not a file.');
    }
    if (info.size > 512 * 1024) {
      throw new BadRequestException('File is too large to read through the API.');
    }
    return info;
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

  private assertSupportedArchiveFile(file: ArchiveUploadFile): asserts file is ArchiveUploadFile & { buffer: Buffer } {
    if (!file?.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Archive file is required.');
    }

    const size = file.size ?? file.buffer.length;
    if (size > PROJECT_ARCHIVE_MAX_UPLOAD_BYTES || file.buffer.length > PROJECT_ARCHIVE_MAX_UPLOAD_BYTES) {
      throw new BadRequestException('Archive file is too large.');
    }

    const filename = file.originalname?.toLowerCase() ?? '';
    const mimetype = file.mimetype?.toLowerCase() ?? '';
    const hasZipName = filename.endsWith('.zip');
    const hasZipType =
      mimetype === 'application/zip' ||
      mimetype === 'application/x-zip-compressed' ||
      mimetype === 'application/octet-stream';

    if (!hasZipName && !hasZipType) {
      throw new BadRequestException('Only .zip archives are supported.');
    }
  }

  private extractZipArchive(buffer: Buffer): ExtractedArchiveFile[] {
    const entries = this.readZipEntries(buffer);
    const stripRoot = this.findSingleArchiveRoot(entries.map((entry) => entry.path));
    const extractedFiles: ExtractedArchiveFile[] = [];
    const seenPaths = new Set<string>();
    let totalExtractedBytes = 0;

    for (const entry of entries) {
      const archivePath = stripRoot ? entry.path.slice(stripRoot.length + 1) : entry.path;
      if (!archivePath || this.hasBlockedArchiveSegment(archivePath)) {
        continue;
      }

      const pathKey = archivePath.toLowerCase();
      if (seenPaths.has(pathKey)) {
        throw new BadRequestException(`Archive contains duplicate file path: ${archivePath}`);
      }
      seenPaths.add(pathKey);

      totalExtractedBytes += entry.uncompressedSize;
      if (totalExtractedBytes > PROJECT_ARCHIVE_MAX_EXTRACTED_BYTES) {
        throw new BadRequestException('Archive expands to too much data.');
      }

      extractedFiles.push({
        path: archivePath,
        content: this.readZipEntryContent(buffer, entry),
      });
    }

    return extractedFiles;
  }

  private readZipEntries(buffer: Buffer): ZipEntry[] {
    const endOfCentralDirectoryOffset = this.findEndOfCentralDirectory(buffer);
    const totalEntries = buffer.readUInt16LE(endOfCentralDirectoryOffset + 10);
    const centralDirectorySize = buffer.readUInt32LE(endOfCentralDirectoryOffset + 12);
    const centralDirectoryOffset = buffer.readUInt32LE(endOfCentralDirectoryOffset + 16);

    if (
      totalEntries === 0xffff ||
      centralDirectorySize === 0xffffffff ||
      centralDirectoryOffset === 0xffffffff
    ) {
      throw new BadRequestException('Zip64 archives are not supported.');
    }
    if (totalEntries > PROJECT_ARCHIVE_MAX_FILES) {
      throw new BadRequestException('Archive contains too many files.');
    }
    if (centralDirectoryOffset + centralDirectorySize > buffer.length) {
      throw new BadRequestException('Archive central directory is invalid.');
    }

    const entries: ZipEntry[] = [];
    let offset = centralDirectoryOffset;
    for (let index = 0; index < totalEntries; index += 1) {
      if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
        throw new BadRequestException('Archive central directory is invalid.');
      }

      const flags = buffer.readUInt16LE(offset + 8);
      const compressionMethod = buffer.readUInt16LE(offset + 10);
      const compressedSize = buffer.readUInt32LE(offset + 20);
      const uncompressedSize = buffer.readUInt32LE(offset + 24);
      const filenameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const localHeaderOffset = buffer.readUInt32LE(offset + 42);
      const filenameStart = offset + 46;
      const filenameEnd = filenameStart + filenameLength;

      if (filenameEnd > buffer.length) {
        throw new BadRequestException('Archive central directory is invalid.');
      }
      if ((flags & 0x01) === 0x01) {
        throw new BadRequestException('Encrypted zip archives are not supported.');
      }
      if (compressionMethod !== ZIP_COMPRESSION_STORE && compressionMethod !== ZIP_COMPRESSION_DEFLATE) {
        throw new BadRequestException('Archive contains unsupported compression method.');
      }
      if (
        compressedSize === 0xffffffff ||
        uncompressedSize === 0xffffffff ||
        localHeaderOffset === 0xffffffff
      ) {
        throw new BadRequestException('Zip64 archives are not supported.');
      }

      const rawPath = buffer.subarray(filenameStart, filenameEnd).toString('utf8');
      const normalizedPath = this.normalizeArchivePath(rawPath);
      if (normalizedPath && !rawPath.replaceAll('\\', '/').endsWith('/')) {
        entries.push({
          path: normalizedPath,
          compressionMethod,
          compressedSize,
          uncompressedSize,
          localHeaderOffset,
        });
      }

      offset = filenameEnd + extraLength + commentLength;
    }

    return entries;
  }

  private findEndOfCentralDirectory(buffer: Buffer): number {
    const start = Math.max(0, buffer.length - ZIP_MAX_EOCD_SEARCH_BYTES);
    for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
      if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
        return offset;
      }
    }
    throw new BadRequestException('Invalid zip archive.');
  }

  private normalizeArchivePath(rawPath: string): string | null {
    const value = rawPath.replaceAll('\\', '/').trim();
    if (!value || value.includes('\0')) {
      return null;
    }
    if (value.startsWith('/') || /^[A-Za-z]:\//.test(value)) {
      throw new BadRequestException('Archive contains an unsafe absolute path.');
    }

    const segments = value.split('/').filter(Boolean);
    if (segments.length === 0) {
      return null;
    }
    if (segments.includes('..')) {
      throw new BadRequestException('Archive contains parent directory traversal.');
    }

    return segments.join('/');
  }

  private findSingleArchiveRoot(paths: string[]): string | null {
    if (paths.length === 0) {
      return null;
    }

    const firstSegments = paths.map((path) => path.split('/')[0]);
    const root = firstSegments[0];
    const allShareRoot = firstSegments.every((segment) => segment === root);
    const allNestedUnderRoot = paths.every((path) => path.includes('/'));
    return allShareRoot && allNestedUnderRoot ? root : null;
  }

  private hasBlockedArchiveSegment(path: string): boolean {
    return path.split('/').some((segment) => ARCHIVE_BLOCKED_SEGMENTS.has(segment));
  }

  private readZipEntryContent(buffer: Buffer, entry: ZipEntry): Buffer {
    const offset = entry.localHeaderOffset;
    if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== ZIP_LOCAL_FILE_SIGNATURE) {
      throw new BadRequestException('Archive local file header is invalid.');
    }

    const filenameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + filenameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataStart > buffer.length || dataEnd > buffer.length) {
      throw new BadRequestException('Archive file data is invalid.');
    }

    const compressedContent = buffer.subarray(dataStart, dataEnd);
    const content =
      entry.compressionMethod === ZIP_COMPRESSION_STORE
        ? Buffer.from(compressedContent)
        : this.inflateZipEntry(compressedContent);

    if (content.length !== entry.uncompressedSize) {
      throw new BadRequestException('Archive file size metadata is invalid.');
    }

    return content;
  }

  private inflateZipEntry(content: Buffer): Buffer {
    try {
      return inflateRawSync(content);
    } catch {
      throw new BadRequestException('Archive file data is invalid.');
    }
  }

  private async assertGitRepository(projectRoot: string): Promise<void> {
    if (!(await this.isGitRepository(projectRoot))) {
      throw new BadRequestException('This project is not a Git repository.');
    }
  }

  private async isGitRepository(projectRoot: string): Promise<boolean> {
    try {
      const resolvedProjectRoot = this.normalizeAbsoluteGitPath(projectRoot);
      const result = await this.runGit(projectRoot, ['rev-parse', '--show-toplevel'], true);
      const gitTopLevel = result.stdout.trim();
      return (
        result.exitCode === 0 &&
        Boolean(gitTopLevel) &&
        this.normalizeAbsoluteGitPath(gitTopLevel) === resolvedProjectRoot
      );
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
      pushableCommits: ahead,
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

  private async resolvePushableCommits(projectRoot: string, status: GitStatusView): Promise<number> {
    if (!status.hasRemote) {
      return 0;
    }
    if (status.tracking) {
      return status.ahead;
    }

    const result = await this.runGit(projectRoot, ['rev-list', '--count', 'HEAD', '--not', '--remotes'], true);
    if (result.exitCode !== 0) {
      return 0;
    }

    const count = Number(result.stdout.trim());
    return Number.isFinite(count) && count > 0 ? count : 0;
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

  private normalizeAbsoluteGitPath(path: string): string {
    const normalized = resolve(path);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }

  private buildProjectGitEnv(cwd: string): NodeJS.ProcessEnv {
    const projectCeiling = dirname(resolve(cwd));
    const existingCeilings = process.env.GIT_CEILING_DIRECTORIES;
    return {
      ...process.env,
      GIT_CEILING_DIRECTORIES: existingCeilings
        ? `${existingCeilings}${delimiter}${projectCeiling}`
        : projectCeiling,
    };
  }

  private runGit(
    cwd: string,
    args: string[],
    allowFailure = false,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn('git', args, { cwd, env: this.buildProjectGitEnv(cwd), shell: false });
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
