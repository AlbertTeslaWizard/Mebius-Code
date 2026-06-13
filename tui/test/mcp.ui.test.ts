import { describe, expect, it } from 'bun:test';
import type { McpServerView } from '../src/types';
import {
  closeOrReturnMcpPaletteOnEscape,
  filterMcpServers,
  moveMcpSelection,
  parseMcpPaletteCommand,
} from '../src/mcp/ui';

const servers: McpServerView[] = [
  server('context7', 'Context7', 'connected', 2),
  server('docs', 'Docs Search', 'failed', 0),
  server('linear', 'Linear', 'disabled', 0, false),
];

describe('MCP palette helpers', () => {
  it('filters MCP servers by name, slug, status, and source', () => {
    expect(filterMcpServers(servers, 'ctx')).toEqual([]);
    expect(filterMcpServers(servers, 'context').map((item) => item.slug)).toEqual(['context7']);
    expect(filterMcpServers(servers, 'failed').map((item) => item.slug)).toEqual(['docs']);
    expect(filterMcpServers(servers, 'user').map((item) => item.slug)).toEqual(['docs', 'linear']);
  });

  it('parses only palette-owned MCP commands', () => {
    expect(parseMcpPaletteCommand('/mcp')).toEqual({ refresh: false });
    expect(parseMcpPaletteCommand('/mcp refresh')).toEqual({ refresh: true });
    expect(parseMcpPaletteCommand('/mcp verbose')).toEqual({ refresh: true });
    expect(parseMcpPaletteCommand('/mcp tools context7')).toBeNull();
    expect(parseMcpPaletteCommand('/mcp add docs https://example.com/mcp')).toBeNull();
  });

  it('wraps MCP selection and handles empty lists', () => {
    expect(moveMcpSelection(0, -1, servers.length)).toBe(2);
    expect(moveMcpSelection(2, 1, servers.length)).toBe(0);
    expect(moveMcpSelection(2, 1, 0)).toBe(0);
  });

  it('returns from detail on Esc and closes from list on Esc', () => {
    expect(
      closeOrReturnMcpPaletteOnEscape({
        servers,
        selectedIndex: 0,
        query: '',
        view: 'detail',
        loading: false,
        detailSlug: 'context7',
        detailTools: [],
        detailLoading: true,
        detailError: 'failed',
      }),
    ).toEqual({
      servers,
      selectedIndex: 0,
      query: '',
      view: 'list',
      loading: false,
      detailSlug: undefined,
      detailTools: undefined,
      detailLoading: false,
      detailError: undefined,
    });
    expect(closeOrReturnMcpPaletteOnEscape({ servers, selectedIndex: 0, query: '', view: 'list', loading: false })).toBeNull();
  });
});

function server(
  slug: string,
  name: string,
  status: McpServerView['diagnostic']['status'],
  toolCount: number,
  isPreset = slug === 'context7',
): McpServerView {
  return {
    id: slug,
    slug,
    name,
    url: `https://example.com/${slug}`,
    displayUrl: `https://example.com/${slug}`,
    transport: 'streamable_http',
    enabled: status !== 'disabled',
    isPreset,
    headerNames: [],
    diagnostic: {
      status,
      toolCount,
      cached: false,
    },
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z',
  };
}
