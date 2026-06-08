import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, realpath, stat } from 'fs/promises';
import { dirname, isAbsolute, normalize, parse, resolve, sep } from 'path';

const BLOCKED_SEGMENTS = new Set(['.git', '.env', 'node_modules', 'dist', 'coverage']);
export const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  'datasets',
  'models',
  'outputs',
  'checkpoints',
]);

const POSIX_DANGEROUS_ROOTS = new Set([
  '/',
  '/bin',
  '/boot',
  '/dev',
  '/etc',
  '/lib',
  '/lib64',
  '/proc',
  '/sbin',
  '/sys',
  '/tmp',
  '/usr',
  '/var',
]);
const WINDOWS_DANGEROUS_NAMES = new Set(['windows', 'program files', 'program files (x86)', 'programdata']);

@Injectable()
export class PathSandboxService {
  constructor(private readonly config: ConfigService) {}

  getWorkspaceRoot(): string {
    return resolve(this.config.get<string>('MEBIUS_CODE_WORKSPACE_ROOT') ?? './workspaces');
  }

  getProjectRoot(projectId: string): string {
    return resolve(this.getWorkspaceRoot(), projectId);
  }

  async ensureProjectRoot(projectId: string): Promise<string> {
    const projectRoot = this.getProjectRoot(projectId);
    await mkdir(projectRoot, { recursive: true });
    return projectRoot;
  }

  assertExactProjectRoot(projectId: string, workspacePath: string): string {
    const expectedRoot = this.getProjectRoot(projectId);
    const actualRoot = resolve(workspacePath);

    if (actualRoot !== expectedRoot) {
      throw new BadRequestException('Project workspace path does not match the sandbox root.');
    }

    return expectedRoot;
  }

  resolveProjectPath(projectRoot: string, relativePath = '.'): string {
    const safeRelativePath = this.normalizeRelativePath(relativePath);
    const root = resolve(projectRoot);
    const target = resolve(root, safeRelativePath);

    if (target !== root && !target.startsWith(root + sep)) {
      throw new BadRequestException('Path escapes the project workspace.');
    }

    return target;
  }

  async normalizeLocalWorkspaceRoot(inputPath: string): Promise<string> {
    if (!isAbsolute(inputPath)) {
      throw new BadRequestException('Local workspace path must be absolute.');
    }

    const resolved = await realpath(inputPath).catch(() => {
      throw new BadRequestException('Local workspace path does not exist.');
    });
    const info = await stat(resolved);
    if (!info.isDirectory()) {
      throw new BadRequestException('Local workspace path must be a directory.');
    }
    this.assertNotDangerousWorkspaceRoot(resolved);
    return this.normalizeWorkspaceRootForStorage(resolved);
  }

  async resolveExistingProjectPath(projectRoot: string, relativePath = '.'): Promise<string> {
    const target = this.resolveProjectPath(projectRoot, relativePath);
    const rootReal = await this.realProjectRoot(projectRoot);
    const targetReal = await realpath(target).catch(() => {
      throw new BadRequestException('Path does not exist.');
    });
    this.assertRealPathInsideRoot(rootReal, targetReal);
    return targetReal;
  }

  async resolveNewProjectPath(projectRoot: string, relativePath = '.'): Promise<string> {
    const target = this.resolveProjectPath(projectRoot, relativePath);
    const existingReal = await realpath(target).catch(() => null);
    if (existingReal) {
      const rootReal = await this.realProjectRoot(projectRoot);
      this.assertRealPathInsideRoot(rootReal, existingReal);
      return existingReal;
    }

    const parentReal = await this.realNearestExistingParent(target);
    const rootReal = await this.realProjectRoot(projectRoot);
    this.assertRealPathInsideRoot(rootReal, parentReal);
    return target;
  }

  async resolveExistingDirectory(projectRoot: string, relativePath = '.'): Promise<string> {
    const target = await this.resolveExistingProjectPath(projectRoot, relativePath);
    const info = await stat(target);
    if (!info.isDirectory()) {
      throw new BadRequestException('Path is not a directory.');
    }
    return target;
  }

  async assertExistingAbsolutePathInsideRoot(projectRoot: string, absolutePath: string): Promise<string> {
    if (!isAbsolute(absolutePath)) {
      throw new BadRequestException('Path must be absolute.');
    }
    const rootReal = await this.realProjectRoot(projectRoot);
    const targetReal = await realpath(absolutePath).catch(() => {
      throw new BadRequestException('Path does not exist.');
    });
    this.assertRealPathInsideRoot(rootReal, targetReal);
    return targetReal;
  }

  shouldIgnoreDirectory(name: string): boolean {
    return DEFAULT_IGNORED_DIRECTORIES.has(name);
  }

  normalizeRelativePath(relativePath = '.'): string {
    if (isAbsolute(relativePath)) {
      throw new BadRequestException('Absolute paths are not allowed.');
    }

    const normalized = normalize(relativePath).replaceAll('\\', '/');
    const segments = normalized.split('/').filter(Boolean);

    if (segments.includes('..')) {
      throw new BadRequestException('Parent directory traversal is not allowed.');
    }

    const blocked = segments.find((segment) => BLOCKED_SEGMENTS.has(segment));
    if (blocked) {
      throw new BadRequestException(`Access to ${blocked} is blocked.`);
    }

    return normalized === '' ? '.' : normalized;
  }

  normalizeWorkspaceRootForStorage(workspaceRoot: string): string {
    const resolved = resolve(workspaceRoot);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  private async realProjectRoot(projectRoot: string): Promise<string> {
    const rootReal = await realpath(projectRoot).catch(() => {
      throw new BadRequestException('Project workspace root does not exist.');
    });
    return this.normalizeWorkspaceRootForStorage(rootReal);
  }

  private assertRealPathInsideRoot(rootReal: string, targetReal: string): void {
    const normalizedTarget = this.normalizeWorkspaceRootForStorage(targetReal);
    if (normalizedTarget !== rootReal && !normalizedTarget.startsWith(rootReal + sep)) {
      throw new BadRequestException('Path escapes the project workspace.');
    }
  }

  private assertNotDangerousWorkspaceRoot(workspaceRoot: string): void {
    const normalized = this.normalizeWorkspaceRootForStorage(workspaceRoot);
    const root = this.normalizeWorkspaceRootForStorage(parse(normalized).root);
    if (normalized === root) {
      throw new BadRequestException('Local workspace cannot be a filesystem root.');
    }

    if (process.platform === 'win32') {
      const segments = normalized
        .slice(root.length)
        .split(/[\\/]+/)
        .filter(Boolean);
      const firstSegment = segments[0]?.toLowerCase();
      if (segments.length <= 1 && firstSegment && WINDOWS_DANGEROUS_NAMES.has(firstSegment)) {
        throw new BadRequestException('Local workspace path is a protected system directory.');
      }
      return;
    }

    if (POSIX_DANGEROUS_ROOTS.has(normalized)) {
      throw new BadRequestException('Local workspace path is a protected system directory.');
    }
  }

  private async realNearestExistingParent(target: string): Promise<string> {
    let current = dirname(target);
    while (current !== dirname(current)) {
      const currentReal = await realpath(current).catch(() => null);
      if (currentReal) {
        const info = await stat(currentReal);
        if (!info.isDirectory()) {
          throw new BadRequestException('Parent path is not a directory.');
        }
        return currentReal;
      }
      current = dirname(current);
    }

    throw new BadRequestException('Parent directory does not exist.');
  }
}
