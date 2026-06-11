import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { discoverSkills, parseSkillDescription } from '../src/skills/discovery';

describe('skill discovery', () => {
  it('scans skill directories that contain SKILL.md', async () => {
    await withTempDir(async (root) => {
      await writeSkill(join(root, '.mebius', 'skills'), 'frontend-design', `---\ndescription: Build polished UIs\n---\n# Skill\n\nBody`);
      await mkdir(join(root, '.mebius', 'skills', 'not-a-skill'), { recursive: true });

      const result = await discoverSkills({ workspaceDir: root, includeUserDirs: false });

      expect(result.skills).toHaveLength(1);
      expect(result.skills[0]).toMatchObject({
        id: 'frontend-design',
        name: 'frontend-design',
        description: 'Build polished UIs',
        source: 'mebius',
      });
      expect(result.errors).toEqual([]);
    });
  });

  it('parses frontmatter description fields before body fallback', () => {
    expect(parseSkillDescription(`---\ndescription: "Use this first"\nsummary: Ignore me\n---\n# Skill\n\nBody`)).toBe('Use this first');
    expect(parseSkillDescription(`---\nsummary: Summary text\n---\n# Skill\n\nBody`)).toBe('Summary text');
    expect(parseSkillDescription(`---\nname: Named skill\n---\n# Skill\n\nBody`)).toBe('Named skill');
  });

  it('falls back to the first paragraph under the first heading', () => {
    expect(parseSkillDescription(`# Frontend\n\nCreate refined production interfaces.\nKeep controls dense.\n\n## Other`)).toBe(
      'Create refined production interfaces. Keep controls dense.',
    );
  });

  it('prefers workspace skills over user-global skills with the same name', async () => {
    await withTempDir(async (root) => {
      const workspace = join(root, 'workspace');
      const home = join(root, 'home');
      await writeSkill(join(home, '.claude', 'skills'), 'shared', `---\ndescription: Global version\n---\n# Skill`);
      await writeSkill(join(workspace, '.claude', 'skills'), 'shared', `---\ndescription: Workspace version\n---\n# Skill`);

      const result = await discoverSkills({ workspaceDir: workspace, homeDir: home });

      expect(result.skills.filter((skill) => skill.name === 'shared')).toHaveLength(1);
      expect(result.skills.find((skill) => skill.name === 'shared')?.description).toBe('Workspace version');
    });
  });

  it('discovers user Claude skills and Claude plugin cache skills recursively', async () => {
    await withTempDir(async (root) => {
      const workspace = join(root, 'workspace');
      const home = join(root, 'home');
      for (const name of ['boris', 'elon-musk-perspective', 'feynman-perspective']) {
        await writeSkill(join(home, '.claude', 'skills'), name, `---\ndescription: ${name}\n---\n# Skill`);
      }
      const superpowers = join(home, '.claude', 'plugins', 'cache', 'claude-plugins-official', 'superpowers', '5.1.0', 'skills');
      for (const name of [
        'using-superpowers',
        'writing-plans',
        'writing-skills',
        'requesting-code-review',
        'receiving-code-review',
        'systematic-debugging',
        'using-git-worktrees',
      ]) {
        await writeSkill(superpowers, name, `---\ndescription: ${name}\n---\n# Skill`);
      }

      const result = await discoverSkills({ workspaceDir: workspace, homeDir: home });
      const names = result.skills.map((skill) => skill.name);

      expect(names).toEqual(expect.arrayContaining([
        'boris',
        'elon-musk-perspective',
        'feynman-perspective',
        'using-superpowers',
        'writing-plans',
        'writing-skills',
        'requesting-code-review',
        'receiving-code-review',
        'systematic-debugging',
        'using-git-worktrees',
      ]));
      expect(result.debug.workspacePath).toBe(workspace);
      expect(result.debug.scannedSkillRoots).toContain(join(home, '.claude', 'plugins', 'cache'));
      expect(result.debug.foundSkillFiles).toContain(
        join(superpowers, 'using-git-worktrees', 'SKILL.md'),
      );
    });
  });

  it('discovers Claude marketplace skills recursively', async () => {
    await withTempDir(async (root) => {
      const workspace = join(root, 'workspace');
      const home = join(root, 'home');
      const marketplaceSkills = join(
        home,
        '.claude',
        'plugins',
        'marketplaces',
        'claude-plugins-official',
        'external_plugins',
        'discord',
        'skills',
      );
      await writeSkill(marketplaceSkills, 'access', `---\ndescription: Discord access\n---\n# Skill`);

      const result = await discoverSkills({ workspaceDir: workspace, homeDir: home });

      expect(result.skills.find((skill) => skill.name === 'access')).toMatchObject({
        description: 'Discord access',
        source: 'claude',
      });
      expect(result.debug.scannedSkillRoots).toContain(join(home, '.claude', 'plugins', 'marketplaces'));
    });
  });

  it('deduplicates same-name plugin cache skills by non-unknown path and latest mtime', async () => {
    await withTempDir(async (root) => {
      const workspace = join(root, 'workspace');
      const home = join(root, 'home');
      const cacheRoot = join(home, '.claude', 'plugins', 'cache', 'claude-plugins-official', 'frontend-design');
      const oldKnown = await writeSkill(
        join(cacheRoot, '1b46aa6d4a11', 'skills'),
        'frontend-design',
        `---\ndescription: Old known\n---\n# Skill`,
      );
      const newKnown = await writeSkill(
        join(cacheRoot, '1fb8ee762823', 'skills'),
        'frontend-design',
        `---\ndescription: New known\n---\n# Skill`,
      );
      const unknown = await writeSkill(
        join(cacheRoot, 'unknown', 'skills'),
        'frontend-design',
        `---\ndescription: Unknown newest\n---\n# Skill`,
      );
      await touch(oldKnown, new Date('2025-01-01T00:00:00.000Z'));
      await touch(newKnown, new Date('2025-02-01T00:00:00.000Z'));
      await touch(unknown, new Date('2026-01-01T00:00:00.000Z'));

      const result = await discoverSkills({ workspaceDir: workspace, homeDir: home });
      const matches = result.skills.filter((skill) => skill.name === 'frontend-design');

      expect(matches).toHaveLength(1);
      expect(matches[0]?.description).toBe('New known');
      expect(matches[0]?.skillFile).toContain('1fb8ee762823');
    });
  });

  it('skips missing skill directories without errors', async () => {
    await withTempDir(async (root) => {
      const result = await discoverSkills({ workspaceDir: join(root, 'missing'), includeUserDirs: false });
      expect(result.skills).toEqual([]);
      expect(result.errors).toEqual([]);
    });
  });

  it('skips symlinked skill directories', async () => {
    await withTempDir(async (root) => {
      const real = join(root, 'real-skill');
      await writeSkill(real, '', `---\ndescription: Linked\n---\n# Skill`);
      const skillsDir = join(root, '.mebius', 'skills');
      await mkdir(skillsDir, { recursive: true });
      try {
        await symlink(real, join(skillsDir, 'linked'), 'dir');
      } catch {
        return;
      }

      const result = await discoverSkills({ workspaceDir: root, includeUserDirs: false });
      expect(result.skills).toEqual([]);
    });
  });
});

async function withTempDir(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'mebius-skills-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeSkill(parent: string, name: string, content: string): Promise<string> {
  const dir = name ? join(parent, name) : parent;
  await mkdir(dir, { recursive: true });
  const skillFile = join(dir, 'SKILL.md');
  await writeFile(skillFile, content, 'utf8');
  return skillFile;
}

async function touch(path: string, date: Date): Promise<void> {
  await utimes(path, date, date);
}
