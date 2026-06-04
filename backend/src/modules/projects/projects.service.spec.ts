import { ConfigService } from '@nestjs/config';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
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

  it('saves an owned existing text file and records audit metadata', async () => {
    const project = projectFixture(paths.getProjectRoot('project-1'));
    projects.findOne.mockResolvedValue(project);
    await mkdir(project.workspacePath, { recursive: true });
    await writeFile(join(project.workspacePath, 'notes.txt'), 'old content');

    const result = await service.saveProjectFile(owner, project.id, 'notes.txt', 'new content');

    await expect(readFile(join(project.workspacePath, 'notes.txt'), 'utf8')).resolves.toBe(
      'new content',
    );
    expect(audit.record).toHaveBeenCalledWith({
      actor: owner,
      action: 'project.file_saved',
      resourceType: 'project',
      resourceId: project.id,
      metadata: { path: 'notes.txt', size: 11 },
    });
    expect(result).toEqual({
      path: 'notes.txt',
      content: 'new content',
      size: 11,
    });
  });

  it('creates a new nested text file and records audit metadata', async () => {
    const project = projectFixture(paths.getProjectRoot('project-1'));
    projects.findOne.mockResolvedValue(project);
    await mkdir(project.workspacePath, { recursive: true });

    const result = await service.createProjectFile(owner, project.id, 'src/demo.ts', '');

    await expect(readFile(join(project.workspacePath, 'src', 'demo.ts'), 'utf8')).resolves.toBe('');
    expect(audit.record).toHaveBeenCalledWith({
      actor: owner,
      action: 'project.file_created',
      resourceType: 'project',
      resourceId: project.id,
      metadata: { path: 'src/demo.ts', size: 0 },
    });
    expect(result).toEqual({
      path: 'src/demo.ts',
      content: '',
      size: 0,
    });
  });

  it('rejects creating blocked or existing files', async () => {
    const project = projectFixture(paths.getProjectRoot('project-1'));
    projects.findOne.mockResolvedValue(project);
    await mkdir(project.workspacePath, { recursive: true });
    await writeFile(join(project.workspacePath, 'notes.txt'), 'content');

    await expect(service.createProjectFile(owner, project.id, '.git/config', '')).rejects.toThrow();
    await expect(service.createProjectFile(owner, project.id, 'notes.txt', '')).rejects.toThrow(
      'File already exists.',
    );
  });

  it('rejects saving blocked workspace paths', async () => {
    const project = projectFixture(paths.getProjectRoot('project-1'));
    projects.findOne.mockResolvedValue(project);
    await mkdir(project.workspacePath, { recursive: true });

    await expect(service.saveProjectFile(owner, project.id, '.env', 'secret')).rejects.toThrow();
    expect(audit.record).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'project.file_saved' }));
  });

  it('rejects saving directories and oversized content', async () => {
    const project = projectFixture(paths.getProjectRoot('project-1'));
    projects.findOne.mockResolvedValue(project);
    await mkdir(join(project.workspacePath, 'src'), { recursive: true });
    await writeFile(join(project.workspacePath, 'src', 'app.ts'), 'old content');

    await expect(service.saveProjectFile(owner, project.id, 'src', 'content')).rejects.toThrow(
      'Path is not a file.',
    );
    await expect(
      service.saveProjectFile(owner, project.id, 'src/app.ts', 'x'.repeat(512 * 1024 + 1)),
    ).rejects.toThrow('File content is too large to save through the API.');
  });

  it('deletes an owned text file and records audit metadata', async () => {
    const project = projectFixture(paths.getProjectRoot('project-1'));
    projects.findOne.mockResolvedValue(project);
    await mkdir(project.workspacePath, { recursive: true });
    await writeFile(join(project.workspacePath, 'notes.txt'), 'content');

    const result = await service.deleteProjectFile(owner, project.id, 'notes.txt');

    await expect(access(join(project.workspacePath, 'notes.txt'))).rejects.toThrow();
    expect(audit.record).toHaveBeenCalledWith({
      actor: owner,
      action: 'project.file_deleted',
      resourceType: 'project',
      resourceId: project.id,
      metadata: { path: 'notes.txt' },
    });
    expect(result).toEqual({ deleted: true, path: 'notes.txt' });
  });

  it('rejects deleting directories and blocked paths', async () => {
    const project = projectFixture(paths.getProjectRoot('project-1'));
    projects.findOne.mockResolvedValue(project);
    await mkdir(join(project.workspacePath, 'src'), { recursive: true });

    await expect(service.deleteProjectFile(owner, project.id, 'src')).rejects.toThrow(
      'Path is not a file.',
    );
    await expect(service.deleteProjectFile(owner, project.id, '.git/config')).rejects.toThrow();
    expect(audit.record).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'project.file_deleted' }));
  });

  it('renames an owned file into a nested path and records audit metadata', async () => {
    const project = projectFixture(paths.getProjectRoot('project-1'));
    projects.findOne.mockResolvedValue(project);
    await mkdir(project.workspacePath, { recursive: true });
    await writeFile(join(project.workspacePath, 'notes.txt'), 'content');

    const result = await service.renameProjectFile(owner, project.id, 'notes.txt', 'docs/renamed.txt');

    await expect(access(join(project.workspacePath, 'notes.txt'))).rejects.toThrow();
    await expect(readFile(join(project.workspacePath, 'docs', 'renamed.txt'), 'utf8')).resolves.toBe(
      'content',
    );
    expect(audit.record).toHaveBeenCalledWith({
      actor: owner,
      action: 'project.file_renamed',
      resourceType: 'project',
      resourceId: project.id,
      metadata: { path: 'notes.txt', newPath: 'docs/renamed.txt', size: 7 },
    });
    expect(result).toEqual({
      path: 'docs/renamed.txt',
      content: 'content',
      size: 7,
    });
  });

  it('rejects renaming directories, blocked paths, and existing targets', async () => {
    const project = projectFixture(paths.getProjectRoot('project-1'));
    projects.findOne.mockResolvedValue(project);
    await mkdir(join(project.workspacePath, 'src'), { recursive: true });
    await writeFile(join(project.workspacePath, 'notes.txt'), 'content');
    await writeFile(join(project.workspacePath, 'existing.txt'), 'target');

    await expect(service.renameProjectFile(owner, project.id, 'src', 'moved')).rejects.toThrow(
      'Path is not a file.',
    );
    await expect(service.renameProjectFile(owner, project.id, 'notes.txt', '.env')).rejects.toThrow();
    await expect(
      service.renameProjectFile(owner, project.id, 'notes.txt', 'existing.txt'),
    ).rejects.toThrow('Target file already exists.');
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

  it('returns a structured git status for a tracked repository', async () => {
    const project = projectFixture(paths.getProjectRoot('project-1'));
    projects.findOne.mockResolvedValue(project);
    const runGit = jest.spyOn(service as any, 'runGit') as jest.Mock;
    runGit
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'true', stderr: '' })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: '## main...origin/main [ahead 1]\n?? demo_sarsa.py\n M README.md',
        stderr: '',
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout:
          'origin https://github.com/example/repo.git (fetch)\norigin https://github.com/example/repo.git (push)',
        stderr: '',
      });

    const result = await service.gitStatus(owner.id, project.id);

    expect(result).toEqual({
      isGitRepo: true,
      branch: 'main',
      tracking: 'origin/main',
      ahead: 1,
      behind: 0,
      pushableCommits: 1,
      hasRemote: true,
      remotes: [
        {
          name: 'origin',
          fetchUrl: 'https://github.com/example/repo.git',
          pushUrl: 'https://github.com/example/repo.git',
        },
      ],
      files: [
        {
          path: 'demo_sarsa.py',
          indexStatus: '?',
          workTreeStatus: '?',
          state: 'untracked',
        },
        {
          path: 'README.md',
          indexStatus: ' ',
          workTreeStatus: 'M',
          state: 'modified',
        },
      ],
      counts: {
        staged: 0,
        unstaged: 1,
        untracked: 1,
      },
    });
  });

  it('counts pushable commits for a branch without upstream tracking', async () => {
    const project = projectFixture(paths.getProjectRoot('project-1'));
    projects.findOne.mockResolvedValue(project);
    const runGit = jest.spyOn(service as any, 'runGit') as jest.Mock;
    runGit
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'true', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '## feature', stderr: '' })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout:
          'origin https://github.com/example/repo.git (fetch)\norigin https://github.com/example/repo.git (push)',
        stderr: '',
      })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '2', stderr: '' });

    const result = await service.gitStatus(owner.id, project.id);

    expect(result).toEqual(
      expect.objectContaining({
        branch: 'feature',
        tracking: null,
        ahead: 0,
        pushableCommits: 2,
        hasRemote: true,
      }),
    );
    expect(runGit).toHaveBeenNthCalledWith(
      4,
      project.workspacePath,
      ['rev-list', '--count', 'HEAD', '--not', '--remotes'],
      true,
    );
  });

  it('reports zero pushable commits when an untracked branch has no readable HEAD', async () => {
    const project = projectFixture(paths.getProjectRoot('project-1'));
    projects.findOne.mockResolvedValue(project);
    const runGit = jest.spyOn(service as any, 'runGit') as jest.Mock;
    runGit
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'true', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '## main', stderr: '' })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout:
          'origin https://github.com/example/repo.git (fetch)\norigin https://github.com/example/repo.git (push)',
        stderr: '',
      })
      .mockResolvedValueOnce({ exitCode: 128, stdout: '', stderr: 'fatal: ambiguous argument HEAD' });

    const result = await service.gitStatus(owner.id, project.id);

    expect(result).toEqual(
      expect.objectContaining({
        branch: 'main',
        tracking: null,
        pushableCommits: 0,
        hasRemote: true,
      }),
    );
  });

  it('reports non-git projects without throwing on status', async () => {
    const project = projectFixture(paths.getProjectRoot('project-1'));
    projects.findOne.mockResolvedValue(project);
    const runGit = jest.spyOn(service as any, 'runGit') as jest.Mock;
    runGit.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'not a git repository' });

    await expect(service.gitStatus(owner.id, project.id)).resolves.toEqual({
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
    });
  });

  it('stages a single file', async () => {
    const project = projectFixture(paths.getProjectRoot('project-1'));
    projects.findOne.mockResolvedValue(project);
    const runGit = jest.spyOn(service as any, 'runGit') as jest.Mock;
    runGit
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'true', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });

    const result = await service.stageGitPath(owner, project.id, 'demo_sarsa.py');

    expect(result).toEqual({ summary: 'Staged demo_sarsa.py.' });
    expect(runGit).toHaveBeenNthCalledWith(1, project.workspacePath, ['rev-parse', '--is-inside-work-tree'], true);
    expect(runGit).toHaveBeenNthCalledWith(2, project.workspacePath, ['add', '--', 'demo_sarsa.py']);
    expect(audit.record).toHaveBeenCalledWith({
      actor: owner,
      action: 'project.git_staged',
      resourceType: 'project',
      resourceId: project.id,
      metadata: { path: 'demo_sarsa.py' },
    });
  });

  it('unstages a single file', async () => {
    const project = projectFixture(paths.getProjectRoot('project-1'));
    projects.findOne.mockResolvedValue(project);
    const runGit = jest.spyOn(service as any, 'runGit') as jest.Mock;
    runGit
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'true', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });

    const result = await service.unstageGitPath(owner, project.id, 'demo_sarsa.py');

    expect(result).toEqual({ summary: 'Unstaged demo_sarsa.py.' });
    expect(runGit).toHaveBeenNthCalledWith(1, project.workspacePath, ['rev-parse', '--is-inside-work-tree'], true);
    expect(runGit).toHaveBeenNthCalledWith(
      2,
      project.workspacePath,
      ['restore', '--staged', '--', 'demo_sarsa.py'],
    );
    expect(audit.record).toHaveBeenCalledWith({
      actor: owner,
      action: 'project.git_unstaged',
      resourceType: 'project',
      resourceId: project.id,
      metadata: { path: 'demo_sarsa.py' },
    });
  });

  it('stages all workspace changes', async () => {
    const project = projectFixture(paths.getProjectRoot('project-1'));
    projects.findOne.mockResolvedValue(project);
    const runGit = jest.spyOn(service as any, 'runGit') as jest.Mock;
    runGit
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'true', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });

    const result = await service.stageAllGit(owner, project.id);

    expect(result).toEqual({ summary: 'Staged all changes.' });
    expect(runGit).toHaveBeenNthCalledWith(1, project.workspacePath, ['rev-parse', '--is-inside-work-tree'], true);
    expect(runGit).toHaveBeenNthCalledWith(2, project.workspacePath, ['add', '-A']);
    expect(audit.record).toHaveBeenCalledWith({
      actor: owner,
      action: 'project.git_staged_all',
      resourceType: 'project',
      resourceId: project.id,
    });
  });

  it('unstages all workspace changes', async () => {
    const project = projectFixture(paths.getProjectRoot('project-1'));
    projects.findOne.mockResolvedValue(project);
    const runGit = jest.spyOn(service as any, 'runGit') as jest.Mock;
    runGit
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'true', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });

    const result = await service.unstageAllGit(owner, project.id);

    expect(result).toEqual({ summary: 'Unstaged all changes.' });
    expect(runGit).toHaveBeenNthCalledWith(1, project.workspacePath, ['rev-parse', '--is-inside-work-tree'], true);
    expect(runGit).toHaveBeenNthCalledWith(2, project.workspacePath, ['restore', '--staged', '.']);
    expect(audit.record).toHaveBeenCalledWith({
      actor: owner,
      action: 'project.git_unstaged_all',
      resourceType: 'project',
      resourceId: project.id,
    });
  });

  it('commits staged changes with a message', async () => {
    const project = projectFixture(paths.getProjectRoot('project-1'));
    projects.findOne.mockResolvedValue(project);
    jest.spyOn(service, 'gitStatus').mockResolvedValue({
      isGitRepo: true,
      branch: 'main',
      tracking: 'origin/main',
      ahead: 0,
      behind: 0,
      pushableCommits: 0,
      hasRemote: true,
      remotes: [{ name: 'origin', fetchUrl: 'https://github.com/example/repo.git' }],
      files: [{ path: 'demo_sarsa.py', indexStatus: 'A', workTreeStatus: ' ', state: 'staged' }],
      counts: { staged: 1, unstaged: 0, untracked: 0 },
    });
    const runGit = jest.spyOn(service as any, 'runGit') as jest.Mock;
    runGit
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'true', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '[main abc1234] add demo', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'abc1234', stderr: '' });

    const result = await service.commitGit(owner, project.id, { message: 'add demo' });

    expect(result).toEqual({
      summary: '[main abc1234] add demo',
      commitSha: 'abc1234',
    });
    expect(audit.record).toHaveBeenCalledWith({
      actor: owner,
      action: 'project.git_committed',
      resourceType: 'project',
      resourceId: project.id,
      metadata: { message: 'add demo', commitSha: 'abc1234' },
    });
  });

  it('rejects commit when there are no staged changes', async () => {
    const project = projectFixture(paths.getProjectRoot('project-1'));
    projects.findOne.mockResolvedValue(project);
    jest.spyOn(service, 'gitStatus').mockResolvedValue({
      isGitRepo: true,
      branch: 'main',
      tracking: 'origin/main',
      ahead: 0,
      behind: 0,
      pushableCommits: 0,
      hasRemote: true,
      remotes: [{ name: 'origin', fetchUrl: 'https://github.com/example/repo.git' }],
      files: [{ path: 'demo_sarsa.py', indexStatus: ' ', workTreeStatus: 'M', state: 'modified' }],
      counts: { staged: 0, unstaged: 1, untracked: 0 },
    });
    const runGit = jest.spyOn(service as any, 'runGit') as jest.Mock;
    runGit.mockResolvedValueOnce({ exitCode: 0, stdout: 'true', stderr: '' });

    await expect(service.commitGit(owner, project.id, { message: 'add demo' })).rejects.toThrow(
      'There are no staged changes to commit.',
    );
  });

  it('rejects empty commit messages', async () => {
    await expect(service.commitGit(owner, 'project-1', { message: '   ' })).rejects.toThrow(
      'Commit message cannot be empty.',
    );
  });

  it('rejects push when no remote is configured', async () => {
    const project = projectFixture(paths.getProjectRoot('project-1'));
    projects.findOne.mockResolvedValue(project);
    jest.spyOn(service, 'gitStatus').mockResolvedValue({
      isGitRepo: true,
      branch: 'main',
      tracking: null,
      ahead: 0,
      behind: 0,
      pushableCommits: 0,
      hasRemote: false,
      remotes: [],
      files: [],
      counts: { staged: 0, unstaged: 0, untracked: 0 },
    });
    const runGit = jest.spyOn(service as any, 'runGit') as jest.Mock;
    runGit.mockResolvedValueOnce({ exitCode: 0, stdout: 'true', stderr: '' });

    await expect(service.pushGit(owner, project.id)).rejects.toThrow('This repository has no remote configured.');
  });

  it('rejects push when there are no local commits to push', async () => {
    const project = projectFixture(paths.getProjectRoot('project-1'));
    projects.findOne.mockResolvedValue(project);
    jest.spyOn(service, 'gitStatus').mockResolvedValue({
      isGitRepo: true,
      branch: 'main',
      tracking: 'origin/main',
      ahead: 0,
      behind: 0,
      pushableCommits: 0,
      hasRemote: true,
      remotes: [{ name: 'origin', fetchUrl: 'https://github.com/example/repo.git' }],
      files: [],
      counts: { staged: 0, unstaged: 0, untracked: 0 },
    });
    const runGit = jest.spyOn(service as any, 'runGit') as jest.Mock;
    runGit.mockResolvedValueOnce({ exitCode: 0, stdout: 'true', stderr: '' });

    await expect(service.pushGit(owner, project.id)).rejects.toThrow('There are no local commits to push.');
    expect(runGit).toHaveBeenCalledTimes(1);
  });

  it('pushes a branch without upstream by setting the remote tracking branch', async () => {
    const project = projectFixture(paths.getProjectRoot('project-1'));
    projects.findOne.mockResolvedValue(project);
    jest.spyOn(service, 'gitStatus').mockResolvedValue({
      isGitRepo: true,
      branch: 'feature',
      tracking: null,
      ahead: 0,
      behind: 0,
      pushableCommits: 2,
      hasRemote: true,
      remotes: [{ name: 'origin', fetchUrl: 'https://github.com/example/repo.git' }],
      files: [],
      counts: { staged: 0, unstaged: 0, untracked: 0 },
    });
    const runGit = jest.spyOn(service as any, 'runGit') as jest.Mock;
    runGit
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'true', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'Branch feature set up to track origin/feature.', stderr: '' });

    const result = await service.pushGit(owner, project.id);

    expect(runGit).toHaveBeenNthCalledWith(1, project.workspacePath, ['rev-parse', '--is-inside-work-tree'], true);
    expect(runGit).toHaveBeenNthCalledWith(2, project.workspacePath, ['push', '-u', 'origin', 'HEAD']);
    expect(result).toEqual({
      summary: 'Branch feature set up to track origin/feature.',
      branch: 'feature',
      remote: 'origin',
    });
  });

  it('surfaces git push authentication failures', async () => {
    const project = projectFixture(paths.getProjectRoot('project-1'));
    projects.findOne.mockResolvedValue(project);
    jest.spyOn(service, 'gitStatus').mockResolvedValue({
      isGitRepo: true,
      branch: 'main',
      tracking: 'origin/main',
      ahead: 1,
      behind: 0,
      pushableCommits: 1,
      hasRemote: true,
      remotes: [{ name: 'origin', fetchUrl: 'https://github.com/example/repo.git' }],
      files: [],
      counts: { staged: 0, unstaged: 0, untracked: 0 },
    });
    const runGit = jest.spyOn(service as any, 'runGit') as jest.Mock;
    runGit
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'true', stderr: '' })
      .mockRejectedValueOnce(new Error('Permission denied (publickey).'));

    await expect(service.pushGit(owner, project.id)).rejects.toThrow('Permission denied (publickey).');
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
