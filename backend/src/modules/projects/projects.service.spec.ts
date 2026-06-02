import { ConfigService } from '@nestjs/config';
import { access, mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Repository } from 'typeorm';
import { PathSandboxService } from '../../common/security/path-sandbox.service';
import { AuditService } from '../audit/audit.service';
import { User } from '../users/user.entity';
import { Project, ProjectSourceType } from './project.entity';
import { ProjectsService } from './projects.service';

describe('ProjectsService', () => {
  let workspaceRoot: string;
  let paths: PathSandboxService;
  let service: ProjectsService;

  const projects = {
    findOne: jest.fn(),
    remove: jest.fn((project: Project) => Promise.resolve(project)),
    save: jest.fn((project: Project) => Promise.resolve(project)),
  } as unknown as jest.Mocked<Repository<Project>>;
  const audit = {
    record: jest.fn(() => Promise.resolve({})),
  } as unknown as jest.Mocked<AuditService>;
  const owner = { id: 'owner-1' } as User;

  beforeEach(async () => {
    jest.clearAllMocks();
    workspaceRoot = await mkdtemp(join(tmpdir(), 'mebius-projects-'));
    paths = new PathSandboxService({
      get: (key: string) => (key === 'MEBIUS_CODE_WORKSPACE_ROOT' ? workspaceRoot : undefined),
    } as ConfigService);
    service = new ProjectsService(projects, paths, audit);
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it('deletes an owned project record, records audit, and removes the exact workspace directory', async () => {
    const project = projectFixture(paths.getProjectRoot('project-1'));
    await mkdir(project.workspacePath, { recursive: true });
    await writeFile(join(project.workspacePath, 'notes.txt'), 'content');
    projects.findOne.mockResolvedValue(project);

    const result = await service.remove(owner, project.id);

    expect(projects.findOne).toHaveBeenCalledWith({
      where: { id: project.id, owner: { id: owner.id } },
      relations: { owner: true },
    });
    expect(audit.record).toHaveBeenCalledWith({
      actor: owner,
      action: 'project.deleted',
      resourceType: 'project',
      resourceId: project.id,
      metadata: {
        workspacePath: project.workspacePath,
        persistedWorkspacePath: project.workspacePath,
      },
    });
    expect(projects.remove).toHaveBeenCalledWith(project);
    await expect(access(project.workspacePath)).rejects.toThrow();
    expect(result).toEqual({ deleted: true });
  });

  it('repairs legacy workspace paths and returns an empty tree when the current workspace directory is missing', async () => {
    const project = projectFixture('/app/workspaces/project-1');
    projects.findOne.mockResolvedValue(project);

    const result = await service.buildTree(owner.id, project.id);

    const expectedRoot = paths.getProjectRoot(project.id);
    expect(result).toEqual([]);
    expect(project.workspacePath).toBe(expectedRoot);
    expect(projects.save).toHaveBeenCalledWith(expect.objectContaining({ workspacePath: expectedRoot }));
    await expect(access(expectedRoot)).resolves.toBeUndefined();
  });

  it('deletes only the current sandbox project root when persisted workspace path is from another environment', async () => {
    const project = projectFixture('/app/workspaces/project-1');
    const currentRoot = paths.getProjectRoot(project.id);
    const legacyRoot = join(workspaceRoot, 'legacy-workspaces', project.id);
    project.workspacePath = legacyRoot;
    projects.findOne.mockResolvedValue(project);
    await mkdir(currentRoot, { recursive: true });
    await mkdir(legacyRoot, { recursive: true });
    await writeFile(join(currentRoot, 'current.txt'), 'content');
    await writeFile(join(legacyRoot, 'legacy.txt'), 'content');

    const result = await service.remove(owner, project.id);

    expect(audit.record).toHaveBeenCalledWith({
      actor: owner,
      action: 'project.deleted',
      resourceType: 'project',
      resourceId: project.id,
      metadata: {
        workspacePath: currentRoot,
        persistedWorkspacePath: legacyRoot,
      },
    });
    expect(projects.remove).toHaveBeenCalledWith(project);
    await expect(access(currentRoot)).rejects.toThrow();
    await expect(access(legacyRoot)).resolves.toBeUndefined();
    expect(result).toEqual({ deleted: true });
  });
});

function projectFixture(workspacePath: string): Project {
  const createdAt = new Date('2026-06-01T00:00:00.000Z');
  return {
    id: 'project-1',
    owner: { id: 'owner-1' },
    name: 'Feature project',
    description: 'Project under test',
    sourceType: ProjectSourceType.Manual,
    workspacePath,
    createdAt,
    updatedAt: createdAt,
  } as Project;
}
