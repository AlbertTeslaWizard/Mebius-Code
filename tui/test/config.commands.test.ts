import { describe, expect, it } from 'bun:test';
import {
  configCommand,
  configWithApiBaseUrl,
  describeApiMode,
  formatConfigShow,
  startupFailureHints,
} from '../src/cli-config';
import { DEFAULT_API_BASE_URL } from '../src/config';
import type { TuiConfig } from '../src/types';

describe('TUI config command helpers', () => {
  it('clears backend-bound state when setting an API URL', () => {
    const next = configWithApiBaseUrl(configFixture(), ' http://localhost:3000/api/ ');

    expect(next).toEqual({
      apiBaseUrl: 'http://localhost:3000/api',
      preferences: { theme: 'onedark' },
    });
  });

  it('config set api saves the normalized API and clears login state', async () => {
    const saved: TuiConfig[] = [];
    const lines: string[] = [];

    await configCommand(['set', 'api', 'http://localhost:3000/api/'], {
      load: async () => configFixture(),
      save: async (config) => {
        saved.push(config);
      },
      write: (line) => lines.push(line),
    });

    expect(saved).toEqual([
      {
        apiBaseUrl: 'http://localhost:3000/api',
        preferences: { theme: 'onedark' },
      },
    ]);
    expect(lines).toContain('API saved: http://localhost:3000/api');
    expect(lines.at(-1)).toContain('mebius login');
  });

  it('config reset api restores the public default and clears login state', async () => {
    const saved: TuiConfig[] = [];

    await configCommand(['reset', 'api'], {
      load: async () => configFixture({ apiBaseUrl: 'http://localhost:3000/api' }),
      save: async (config) => {
        saved.push(config);
      },
      write: () => undefined,
    });

    expect(saved).toEqual([
      {
        apiBaseUrl: DEFAULT_API_BASE_URL,
        preferences: { theme: 'onedark' },
      },
    ]);
  });

  it('config show reports API, mode, and login state', () => {
    const lines = formatConfigShow(configFixture());

    expect(lines).toContain('API: http://182.92.150.169/api');
    expect(lines.some((line) => line.startsWith('Mode: public or remote backend'))).toBe(true);
    expect(lines).toContain('Logged in: yes');
  });

  it('distinguishes local and public API diagnostics', () => {
    expect(describeApiMode('http://localhost:3000/api')).toContain('local backend');
    expect(describeApiMode('http://182.92.150.169/api')).toContain('public or remote backend');
    expect(startupFailureHints('http://localhost:3000/api')).toContain(
      'Start the backend or reset to the public API: mebius config reset api',
    );
  });
});

function configFixture(overrides: Partial<TuiConfig> = {}): TuiConfig {
  return {
    apiBaseUrl: 'http://182.92.150.169/api',
    accessToken: 'token',
    recentProjectId: 'project-1',
    recentSessionId: 'session-1',
    preferences: { theme: 'onedark' },
    ...overrides,
  };
}
