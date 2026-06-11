import { lstat, readdir, readFile, realpath, stat } from 'fs/promises';
import { homedir } from 'os';
import { basename, join, relative, resolve } from 'path';

export type SkillSource = 'workspace' | 'user' | 'opencode' | 'claude' | 'mebius' | 'custom';

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  rootDir: string;
  skillFile: string;
  enabled?: boolean;
  lastModified?: number;
}

export interface SkillDetail extends SkillInfo {
  content: string;
}

export interface SkillDiscoveryResult {
  skills: SkillInfo[];
  errors: string[];
  debug: SkillDiscoveryDebug;
}

export interface SkillDiscoveryDebug {
  osHomedir: string;
  envUserProfile?: string;
  envHome?: string;
  workspacePath?: string;
  scannedSkillRoots: string[];
  foundSkillFiles: string[];
}

interface SkillDirCandidate {
  path: string;
  source: SkillSource;
  priority: number;
  maxDepth: number;
}

interface SkillDetailCacheEntry {
  lastModified?: number;
  detail: SkillDetail;
}

export class SkillDetailCache {
  private readonly entries = new Map<string, SkillDetailCacheEntry>();

  async read(skill: SkillInfo): Promise<SkillDetail> {
    const lastModified = await skillFileMtime(skill.skillFile);
    const cached = this.entries.get(skill.id);
    if (cached && cached.lastModified === lastModified) {
      return cached.detail;
    }

    await assertSafeSkillFile(skill.rootDir, skill.skillFile);
    const content = await readFile(skill.skillFile, 'utf8');
    const detail = { ...skill, lastModified, content };
    this.entries.set(skill.id, { lastModified, detail });
    return detail;
  }

  clear(): void {
    this.entries.clear();
  }
}

export async function discoverSkills(input: {
  workspaceDir?: string;
  customDirs?: string[];
  includeUserDirs?: boolean;
  homeDir?: string;
} = {}): Promise<SkillDiscoveryResult> {
  const errors: string[] = [];
  const osHome = homedir();
  const candidates = buildSkillDirCandidates(
    input.workspaceDir,
    input.customDirs,
    input.includeUserDirs ?? true,
    input.homeDir ?? osHome,
  );
  const foundSkillFiles: string[] = [];
  const byName = new Map<string, { priority: number; skill: SkillInfo }>();

  for (const candidate of candidates) {
    const discovered = await discoverSkillsInDir(candidate, errors, foundSkillFiles);
    for (const skill of discovered) {
      const key = normalizeSkillName(skill.name);
      const existing = byName.get(key);
      if (!existing || shouldReplaceSkill({ priority: candidate.priority, skill }, existing)) {
        byName.set(key, { priority: candidate.priority, skill });
      }
    }
  }

  const skills = [...byName.values()]
    .sort((left, right) => left.priority - right.priority || left.skill.name.localeCompare(right.skill.name))
    .map((entry) => entry.skill);

  return {
    skills,
    errors,
    debug: {
      osHomedir: osHome,
      envUserProfile: process.env.USERPROFILE,
      envHome: process.env.HOME,
      workspacePath: input.workspaceDir,
      scannedSkillRoots: candidates.map((candidate) => candidate.path),
      foundSkillFiles,
    },
  };
}

export function parseSkillDescription(content: string): string {
  const { frontmatter, body } = splitFrontmatter(content);
  const frontmatterDescription = pickFrontmatterValue(frontmatter, ['description', 'summary', 'name']);
  if (frontmatterDescription) return frontmatterDescription;
  return firstParagraphAfterHeading(body) || 'No description';
}

export function skillIdFromName(name: string): string {
  const normalized = normalizeSkillName(name).replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'skill';
}

function buildSkillDirCandidates(
  workspaceDir: string | undefined,
  customDirs: string[] | undefined,
  includeUserDirs: boolean,
  home: string,
): SkillDirCandidate[] {
  const maxDepth = 10;
  const candidates: SkillDirCandidate[] = [];
  if (workspaceDir) {
    candidates.push(
      { path: join(workspaceDir, '.mebius', 'skills'), source: 'mebius', priority: 0, maxDepth },
      { path: join(workspaceDir, '.opencode', 'skills'), source: 'workspace', priority: 1, maxDepth },
      { path: join(workspaceDir, '.claude', 'skills'), source: 'workspace', priority: 2, maxDepth },
    );
  }

  for (const [index, dir] of (customDirs ?? []).entries()) {
    if (!dir.trim()) continue;
    candidates.push({ path: resolveHome(dir, home), source: 'custom', priority: 10 + index, maxDepth });
  }

  if (includeUserDirs) {
    candidates.push(
      { path: join(home, '.claude', 'skills'), source: 'claude', priority: 100, maxDepth },
      { path: join(home, '.claude', 'plugins', 'cache'), source: 'claude', priority: 110, maxDepth },
      { path: join(home, '.claude', 'plugins', 'marketplaces'), source: 'claude', priority: 120, maxDepth },
      { path: join(home, '.config', 'opencode', 'skills'), source: 'opencode', priority: 130, maxDepth },
      { path: join(home, '.opencode', 'skills'), source: 'opencode', priority: 131, maxDepth },
    );
  }

  return candidates;
}

async function discoverSkillsInDir(
  candidate: SkillDirCandidate,
  errors: string[],
  foundSkillFiles: string[],
): Promise<SkillInfo[]> {
  try {
    const rootInfo = await lstat(candidate.path);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return [];
  } catch (error) {
    if (isMissingPath(error)) return [];
    errors.push(`Failed to read ${candidate.path}: ${errorMessage(error)}`);
    return [];
  }

  const skills: SkillInfo[] = [];
  await discoverSkillsRecursive(candidate.path, candidate, 0, skills, errors, foundSkillFiles);
  return skills;
}

async function discoverSkillsRecursive(
  currentDir: string,
  candidate: SkillDirCandidate,
  depth: number,
  skills: SkillInfo[],
  errors: string[],
  foundSkillFiles: string[],
): Promise<void> {
  await maybeAddSkill(currentDir, candidate, skills, errors, foundSkillFiles);
  if (depth >= candidate.maxDepth) return;

  let entries: Array<{ name: string; isDirectory(): boolean; isSymbolicLink(): boolean }>;
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch (error) {
    if (!isMissingPath(error)) {
      errors.push(`Failed to read ${currentDir}: ${errorMessage(error)}`);
    }
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || shouldSkipDir(entry.name)) continue;
    await discoverSkillsRecursive(join(currentDir, entry.name), candidate, depth + 1, skills, errors, foundSkillFiles);
  }
}

async function maybeAddSkill(
  rootDir: string,
  candidate: SkillDirCandidate,
  skills: SkillInfo[],
  errors: string[],
  foundSkillFiles: string[],
): Promise<void> {
  const skillFile = join(rootDir, 'SKILL.md');
  try {
    const fileInfo = await lstat(skillFile);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) return;

    await assertSafeSkillFile(rootDir, skillFile);
    const content = await readFile(skillFile, 'utf8');
    const name = basename(rootDir);
    foundSkillFiles.push(skillFile);
    skills.push({
      id: skillIdFromName(name),
      name,
      description: parseSkillDescription(content),
      source: candidate.source,
      rootDir,
      skillFile,
      lastModified: fileInfo.mtimeMs,
    });
  } catch (error) {
    if (isMissingPath(error)) return;
    errors.push(`Failed to read skill ${rootDir}: ${errorMessage(error)}`);
  }
}

function shouldReplaceSkill(
  candidate: { priority: number; skill: SkillInfo },
  existing: { priority: number; skill: SkillInfo },
): boolean {
  if (candidate.priority !== existing.priority) return candidate.priority < existing.priority;

  const candidateUnknown = hasUnknownPathSegment(candidate.skill.skillFile);
  const existingUnknown = hasUnknownPathSegment(existing.skill.skillFile);
  if (candidateUnknown !== existingUnknown) return !candidateUnknown;

  const candidateModified = candidate.skill.lastModified ?? 0;
  const existingModified = existing.skill.lastModified ?? 0;
  if (candidateModified !== existingModified) return candidateModified > existingModified;

  return normalizeForComparison(candidate.skill.skillFile).localeCompare(normalizeForComparison(existing.skill.skillFile)) < 0;
}

function hasUnknownPathSegment(value: string): boolean {
  return value
    .split(/[\\/]+/)
    .some((part) => part.trim().toLowerCase() === 'unknown');
}

const SKIPPED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.turbo',
  'target',
  '.venv',
  'venv',
]);

function shouldSkipDir(name: string): boolean {
  return SKIPPED_DIRS.has(name.toLowerCase());
}

async function assertSafeSkillFile(rootDir: string, skillFile: string): Promise<void> {
  const [rootReal, fileReal] = await Promise.all([realpath(rootDir), realpath(skillFile)]);
  if (!isPathInside(rootReal, fileReal)) {
    throw new Error('SKILL.md escapes the skill directory.');
  }
}

async function skillFileMtime(skillFile: string): Promise<number | undefined> {
  try {
    return (await stat(skillFile)).mtimeMs;
  } catch {
    return undefined;
  }
}

function isPathInside(rootDir: string, targetPath: string): boolean {
  const root = normalizeForComparison(rootDir);
  const target = normalizeForComparison(targetPath);
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/') && !rel.match(/^[A-Za-z]:/));
}

function normalizeForComparison(value: string): string {
  const resolved = resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter: '', body: content };
  return { frontmatter: match[1] ?? '', body: content.slice(match[0].length) };
}

function pickFrontmatterValue(frontmatter: string, keys: string[]): string | null {
  if (!frontmatter) return null;
  for (const key of keys) {
    const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:\\s*(.+?)\\s*$`, 'im');
    const match = frontmatter.match(pattern);
    const value = match?.[1] ? cleanYamlScalar(match[1]) : '';
    if (value) return value;
  }
  return null;
}

function firstParagraphAfterHeading(content: string): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const headingIndex = lines.findIndex((line) => /^#{1,6}\s+\S/.test(line.trim()));
  let index = headingIndex >= 0 ? headingIndex + 1 : 0;
  while (index < lines.length && !lines[index]?.trim()) index += 1;
  if (index >= lines.length || /^#{1,6}\s+\S/.test(lines[index]?.trim() ?? '')) return '';

  const paragraph: string[] = [];
  while (index < lines.length) {
    const line = lines[index]?.trim() ?? '';
    if (!line) break;
    if (/^#{1,6}\s+\S/.test(line)) break;
    paragraph.push(line);
    index += 1;
  }

  return paragraph.join(' ').replace(/\s+/g, ' ').trim();
}

function cleanYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '|' || trimmed === '>') return '';
  const unquoted = trimmed.replace(/^['"]|['"]$/g, '');
  return unquoted.replace(/\s+/g, ' ').trim();
}

function resolveHome(path: string, home = homedir()): string {
  if (path === '~') return home;
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(home, path.slice(2));
  return resolve(path);
}

function normalizeSkillName(value: string): string {
  return value.trim().toLowerCase();
}

function isMissingPath(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
