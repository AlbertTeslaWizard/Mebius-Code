import { describe, expect, it } from 'bun:test';
import type { SkillInfo } from '../src/skills/discovery';
import { filterSkills, insertSkillCommand, parseSkillCommandInput, selectExplicitSkills } from '../src/skills/selection';
import { closeOrReturnSkillsPaletteOnEscape, parseSkillsCommand } from '../src/skills/ui';

const skills: SkillInfo[] = [
  skill('frontend-design', 'Create distinctive production frontend interfaces'),
  skill('openai-docs', 'Answer current OpenAI API documentation questions'),
  skill('spreadsheets', 'Create and edit xlsx workbooks'),
];

describe('skill selection helpers', () => {
  it('filters skills by name, description, and source', () => {
    expect(filterSkills(skills, 'front').map((item) => item.name)).toEqual(['frontend-design']);
    expect(filterSkills(skills, 'xlsx').map((item) => item.name)).toEqual(['spreadsheets']);
    expect(filterSkills([skill('local', 'desc', 'mebius')], 'mebius').map((item) => item.name)).toEqual(['local']);
  });

  it('selects explicit command skills before active toggles and caps the result', () => {
    const selected = selectExplicitSkills({
      skills,
      activeSkillIds: ['spreadsheets'],
      commandSkills: [skills[0]!, skills[1]!],
      maxSkills: 2,
    });

    expect(selected.map((item) => [item.skill.name, item.reason])).toEqual([
      ['frontend-design', 'command'],
      ['openai-docs', 'command'],
    ]);
  });

  it('parses leading skill slash commands and strips them from the prompt', () => {
    const parsed = parseSkillCommandInput({
      value: '/frontend-design /openai-docs Build a current docs UI',
      skills,
      activeSkillIds: ['spreadsheets'],
      maxSkills: 3,
    });

    expect(parsed.prompt).toBe('Build a current docs UI');
    expect(parsed.commandText).toBe('/frontend-design /openai-docs');
    expect(parsed.selected.map((item) => [item.skill.name, item.reason])).toEqual([
      ['frontend-design', 'command'],
      ['openai-docs', 'command'],
      ['spreadsheets', 'active'],
    ]);
  });

  it('detects skill-only commands without sending an empty prompt', () => {
    const parsed = parseSkillCommandInput({ value: '/frontend-design', skills });

    expect(parsed.prompt).toBe('');
    expect(parsed.hasSkillCommands).toBe(true);
    expect(parsed.missingPromptSkill?.name).toBe('frontend-design');
  });

  it('inserts skill commands into the composer value', () => {
    expect(insertSkillCommand('', skills[0]!)).toBe('/frontend-design ');
    expect(insertSkillCommand('/skills front', skills[0]!)).toBe('/frontend-design ');
    expect(insertSkillCommand('请解释一下傅里叶变换', skills[0]!)).toBe('/frontend-design 请解释一下傅里叶变换');
    expect(insertSkillCommand('/frontend-design 请解释一下傅里叶变换', skills[0]!)).toBe(
      '/frontend-design 请解释一下傅里叶变换',
    );
  });

  it('parses /skills locally with an optional query', () => {
    expect(parseSkillsCommand('/skills')).toBe('');
    expect(parseSkillsCommand('/skills frontend')).toBe('frontend');
    expect(parseSkillsCommand('/skill')).toBeNull();
  });

  it('returns from detail on Esc and closes from list on Esc', () => {
    expect(closeOrReturnSkillsPaletteOnEscape({ selectedIndex: 0, query: '', view: 'detail', detailSkillId: 'a' })).toEqual({
      selectedIndex: 0,
      query: '',
      view: 'list',
      detailSkillId: undefined,
      detail: undefined,
      detailLoading: false,
      detailError: undefined,
    });
    expect(closeOrReturnSkillsPaletteOnEscape({ selectedIndex: 0, query: '', view: 'list' })).toBeNull();
  });
});

function skill(name: string, description: string, source: SkillInfo['source'] = 'claude'): SkillInfo {
  return {
    id: name,
    name,
    description,
    source,
    rootDir: `/tmp/${name}`,
    skillFile: `/tmp/${name}/SKILL.md`,
  };
}
