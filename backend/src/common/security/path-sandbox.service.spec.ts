import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, mkdtemp, symlink, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { PathSandboxService } from './path-sandbox.service';

describe('PathSandboxService', () => {
  const service = new PathSandboxService({
    get: (key: string) => (key === 'MEBIUS_CODE_WORKSPACE_ROOT' ? 'workspaces' : undefined),
  } as ConfigService);

  it('resolves safe paths inside the project root', () => {
    const projectRoot = join(process.cwd(), 'workspaces', 'project-1');

    const target = service.resolveProjectPath(projectRoot, 'src/main.ts');

    expect(target.endsWith(join('src', 'main.ts'))).toBe(true);
  });

  it('blocks traversal outside the workspace', () => {
    const projectRoot = join(process.cwd(), 'workspaces', 'project-1');

    expect(() => service.resolveProjectPath(projectRoot, '../secret.txt')).toThrow(
      BadRequestException,
    );
  });

  it('blocks sensitive folders', () => {
    const projectRoot = join(process.cwd(), 'workspaces', 'project-1');

    expect(() => service.resolveProjectPath(projectRoot, '.git/config')).toThrow(
      BadRequestException,
    );
  });

  it('requires project deletion paths to match the exact sandbox project root', () => {
    const projectRoot = service.getProjectRoot('project-1');

    expect(service.assertExactProjectRoot('project-1', projectRoot)).toBe(projectRoot);
    expect(() => service.assertExactProjectRoot('project-1', join(process.cwd(), 'workspaces'))).toThrow(
      BadRequestException,
    );
  });

  it('normalizes local workspace roots through realpath and rejects relative paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mebius-sandbox-local-'));
    try {
      await expect(service.normalizeLocalWorkspaceRoot('relative/path')).rejects.toThrow(
        'Local workspace path must be absolute.',
      );

      await expect(service.normalizeLocalWorkspaceRoot(root)).resolves.toBe(
        service.normalizeWorkspaceRootForStorage(resolve(root)),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects symlink escapes for existing paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mebius-sandbox-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'mebius-sandbox-outside-'));
    try {
      await writeFile(join(outside, 'secret.txt'), 'secret');
      if (!(await trySymlink(join(outside, 'secret.txt'), join(root, 'secret-link.txt')))) {
        return;
      }

      await expect(service.resolveExistingProjectPath(root, 'secret-link.txt')).rejects.toThrow(
        'Path escapes the project workspace.',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('rejects new file targets whose nearest existing parent is a symlink escape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mebius-sandbox-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'mebius-sandbox-outside-'));
    try {
      await mkdir(join(outside, 'nested'), { recursive: true });
      if (!(await trySymlink(join(outside, 'nested'), join(root, 'escaped-dir'), 'dir'))) {
        return;
      }

      await expect(service.resolveNewProjectPath(root, 'escaped-dir/new.txt')).rejects.toThrow(
        'Path escapes the project workspace.',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

async function trySymlink(target: string, path: string, type?: 'dir'): Promise<boolean> {
  try {
    await symlink(target, path, type);
    return true;
  } catch {
    return false;
  }
}
