import type { SkillInfo } from './discovery';

export interface SelectedSkill {
  skill: SkillInfo;
  reason: 'active' | 'command';
}

export const MAX_RUN_SKILLS = 3;

export interface SkillCommandParseResult {
  selected: SelectedSkill[];
  prompt: string;
  commandText: string;
  hasSkillCommands: boolean;
  missingPromptSkill?: SkillInfo;
}

export function filterSkills(skills: SkillInfo[], query: string): SkillInfo[] {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return skills;
  return skills.filter((skill) =>
    [skill.name, skill.description, skill.source].some((value) => normalizeSearch(value).includes(normalizedQuery)),
  );
}

export function selectExplicitSkills(input: {
  skills: SkillInfo[];
  activeSkillIds: string[];
  commandSkills?: SkillInfo[];
  maxSkills?: number;
}): SelectedSkill[] {
  const maxSkills = Math.max(1, input.maxSkills ?? MAX_RUN_SKILLS);
  const selected = new Map<string, SelectedSkill>();

  for (const skill of input.commandSkills ?? []) {
    selected.set(skill.id, { skill, reason: 'command' });
    if (selected.size >= maxSkills) return [...selected.values()];
  }

  for (const id of input.activeSkillIds) {
    const skill = input.skills.find((item) => item.id === id);
    if (!skill) continue;
    selected.set(skill.id, { skill, reason: 'active' });
    if (selected.size >= maxSkills) return [...selected.values()];
  }

  return [...selected.values()];
}

export function parseSkillCommandInput(input: {
  value: string;
  skills: SkillInfo[];
  activeSkillIds?: string[];
  maxSkills?: number;
}): SkillCommandParseResult {
  const maxSkills = Math.max(1, input.maxSkills ?? MAX_RUN_SKILLS);
  const skillByCommand = buildSkillCommandMap(input.skills);
  let rest = input.value.trimStart();
  const commandSkills: SkillInfo[] = [];
  const commandTokens: string[] = [];

  while (rest.startsWith('/')) {
    const match = rest.match(/^\/([A-Za-z0-9._-]+)(?=\s|$)/);
    if (!match?.[1]) break;
    const skill = skillByCommand.get(normalizeSearch(match[1]));
    if (!skill) break;
    commandTokens.push(skillCommandToken(skill));
    commandSkills.push(skill);
    rest = rest.slice(match[0].length).trimStart();
  }

  const selected = selectExplicitSkills({
    skills: input.skills,
    activeSkillIds: input.activeSkillIds ?? [],
    commandSkills,
    maxSkills,
  });
  const prompt = rest.trim();
  return {
    selected,
    prompt,
    commandText: commandTokens.join(' '),
    hasSkillCommands: commandTokens.length > 0,
    ...(commandTokens.length > 0 && !prompt ? { missingPromptSkill: commandSkills[commandSkills.length - 1] } : {}),
  };
}

export function insertSkillCommand(value: string, skill: SkillInfo): string {
  const command = skillCommandToken(skill);
  const trimmed = value.trim();
  if (!trimmed) return `${command} `;
  if (isSkillsPaletteCommand(trimmed)) return `${command} `;
  if (hasCommandToken(trimmed, command)) return trimmed === command ? `${command} ` : trimmed;
  return `${command} ${trimmed}`;
}

export function skillCommandToken(skill: SkillInfo): string {
  return `/${skill.id}`;
}

export function isSkillCommandValue(value: string, skills: SkillInfo[]): boolean {
  return parseSkillCommandInput({ value, skills }).hasSkillCommands;
}

function buildSkillCommandMap(skills: SkillInfo[]): Map<string, SkillInfo> {
  const byCommand = new Map<string, SkillInfo>();
  for (const skill of skills) {
    for (const key of [skill.id, skill.name]) {
      const normalized = normalizeSearch(key);
      if (!normalized || byCommand.has(normalized)) continue;
      byCommand.set(normalized, skill);
    }
  }
  return byCommand;
}

function isSkillsPaletteCommand(value: string): boolean {
  return value === '/skills' || value.startsWith('/skills ');
}

function hasCommandToken(value: string, command: string): boolean {
  const escaped = escapeRegExp(command);
  return new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'i').test(value);
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
