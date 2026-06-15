import { describe, expect, it } from 'bun:test';
import {
  TOOL_DETAILS_MAX_LENGTH,
  formatToolMessageDetails,
  parseToolsCommand,
  toolMessageSummary,
} from '../src/app/toolMessages';

describe('TUI tool message helpers', () => {
  it('summarizes web search tool JSON by query', () => {
    const summary = toolMessageSummary({
      content: JSON.stringify({ query: 'Masaki Kashiwara mathematician intro', provider: 'exa', content: 'long result' }),
    });

    expect(summary).toBe('web_search - Masaki Kashiwara mathematician intro');
  });

  it('prefers metadata over JSON content', () => {
    const summary = toolMessageSummary({
      content: JSON.stringify({ query: 'ignored query', command: 'ignored command' }),
      metadata: { toolName: 'run_command', command: 'npm test', status: 'completed' },
    });

    expect(summary).toBe('run_command - npm test - completed');
  });

  it('uses target paths before provider', () => {
    const summary = toolMessageSummary({
      content: JSON.stringify({ provider: 'exa', targetPaths: ['src/a.ts', 'src/b.ts'] }),
    });

    expect(summary).toBe('web_search - src/a.ts, src/b.ts');
  });

  it('falls back to a compact preview for plain text content', () => {
    const summary = toolMessageSummary({
      content: 'first line\n\nsecond line',
    });

    expect(summary).toBe('Tool result - first line second line');
  });

  it('pretty-prints JSON details', () => {
    expect(formatToolMessageDetails('{"query":"test","count":2}')).toBe('{\n  "query": "test",\n  "count": 2\n}');
  });

  it('truncates very long details', () => {
    const details = formatToolMessageDetails('x'.repeat(TOOL_DETAILS_MAX_LENGTH + 12));

    expect(details.startsWith('x'.repeat(TOOL_DETAILS_MAX_LENGTH))).toBe(true);
    expect(details.endsWith('... details truncated (12 chars hidden)')).toBe(true);
  });

  it('parses local tools commands', () => {
    expect(parseToolsCommand('/tools expand')).toBe('expand');
    expect(parseToolsCommand('/tools   collapse')).toBe('collapse');
    expect(parseToolsCommand('/tools')).toBeNull();
    expect(parseToolsCommand('/tools show')).toBeNull();
  });
});
