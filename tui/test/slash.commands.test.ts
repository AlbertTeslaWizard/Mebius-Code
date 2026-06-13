import { describe, expect, it } from 'bun:test';
import { readFile } from 'fs/promises';

describe('slash command suggestions', () => {
  it('registers and handles /init as a built-in command', async () => {
    const source = await readFile(new URL('../src/app/App.tsx', import.meta.url), 'utf8');

    expect(source).toContain("name: '/init'");
    expect(source).toContain("label: '/init'");
    expect(source).toContain("value === '/init' || value.startsWith('/init ')");
    expect(source).toContain('runInitCommand(value)');
  });
});
