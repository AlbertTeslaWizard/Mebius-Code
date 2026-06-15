export const TOOL_DETAILS_MAX_LENGTH = 6000;

export type ToolsCommandAction = 'expand' | 'collapse';

export interface ToolMessageInput {
  content: string;
  metadata?: Record<string, unknown>;
}

export function toolMessageSummary(message: ToolMessageInput): string {
  const parsedContent = parseObjectContent(message.content);
  const metadata = message.metadata;
  const name = stringValue(metadata?.toolName) || inferredToolName(parsedContent) || 'Tool result';
  const metadataTargetPaths = listValue(metadata?.targetPaths).join(', ');
  const contentTargetPaths = listValue(parsedContent?.targetPaths).join(', ');
  const detail =
    stringValue(metadata?.query) ||
    stringValue(metadata?.command) ||
    metadataTargetPaths ||
    stringValue(parsedContent?.query) ||
    stringValue(parsedContent?.command) ||
    contentTargetPaths ||
    stringValue(parsedContent?.provider) ||
    compactPreview(message.content);
  const status = stringValue(metadata?.status);

  return [name, detail, status].filter(Boolean).join(' - ');
}

export function formatToolMessageDetails(content: string): string {
  const parsed = parseJsonContent(content);
  const formatted = parsed === undefined ? content : JSON.stringify(parsed, null, 2);
  if (formatted.length <= TOOL_DETAILS_MAX_LENGTH) return formatted;

  const hiddenCharacters = formatted.length - TOOL_DETAILS_MAX_LENGTH;
  return `${formatted.slice(0, TOOL_DETAILS_MAX_LENGTH)}\n... details truncated (${hiddenCharacters} chars hidden)`;
}

export function parseToolsCommand(value: string): ToolsCommandAction | null {
  const normalized = value.trim().replace(/\s+/g, ' ').toLowerCase();
  if (normalized === '/tools expand') return 'expand';
  if (normalized === '/tools collapse') return 'collapse';
  return null;
}

function parseObjectContent(content: string): Record<string, unknown> | null {
  const parsed = parseJsonContent(content);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
}

function parseJsonContent(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
}

function inferredToolName(parsedContent: Record<string, unknown> | null): string {
  if (parsedContent?.query || parsedContent?.provider) return 'web_search';
  return '';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function listValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function compactPreview(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.length > 96 ? `${compact.slice(0, 96)}...` : compact;
}
