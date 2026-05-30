import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir } from 'fs/promises';
import { isAbsolute, normalize, resolve, sep } from 'path';

const BLOCKED_SEGMENTS = new Set(['.git', '.env', 'node_modules', 'dist', 'coverage']);

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

  resolveProjectPath(projectRoot: string, relativePath = '.'): string {
    const safeRelativePath = this.normalizeRelativePath(relativePath);
    const root = resolve(projectRoot);
    const target = resolve(root, safeRelativePath);

    if (target !== root && !target.startsWith(root + sep)) {
      throw new BadRequestException('Path escapes the project workspace.');
    }

    return target;
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
}

