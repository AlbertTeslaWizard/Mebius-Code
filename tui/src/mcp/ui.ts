import type { McpServerView, McpToolView } from '../types';

export interface McpPaletteModel {
  servers: McpServerView[];
  selectedIndex: number;
  query: string;
  view: 'list' | 'detail';
  loading: boolean;
  error?: string;
  detailSlug?: string;
  detailTools?: McpToolView[];
  detailLoading?: boolean;
  detailError?: string;
}

export interface McpPaletteCommand {
  refresh: boolean;
}

export function filterMcpServers(servers: McpServerView[], query: string): McpServerView[] {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return servers;
  return servers.filter((server) =>
    [
      server.slug,
      server.name,
      server.transport,
      server.enabled ? 'enabled' : 'disabled',
      server.isPreset ? 'preset' : 'user',
      server.diagnostic.status,
      server.displayUrl ?? server.url ?? '',
    ].some((value) => normalizeSearch(value).includes(normalizedQuery)),
  );
}

export function closeOrReturnMcpPaletteOnEscape(palette: McpPaletteModel): McpPaletteModel | null {
  if (palette.view === 'detail') {
    return {
      ...palette,
      view: 'list',
      detailSlug: undefined,
      detailTools: undefined,
      detailLoading: false,
      detailError: undefined,
    };
  }
  return null;
}

export function moveMcpSelection(currentIndex: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (currentIndex + delta + count) % count;
}

export function clampMcpSelection(currentIndex: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(currentIndex, 0), count - 1);
}

export function parseMcpPaletteCommand(value: string): McpPaletteCommand | null {
  if (value === '/mcp') return { refresh: false };
  if (value === '/mcp refresh' || value === '/mcp verbose') return { refresh: true };
  return null;
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}
