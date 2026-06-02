import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
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
});
