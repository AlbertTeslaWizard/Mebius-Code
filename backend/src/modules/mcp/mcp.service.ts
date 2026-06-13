import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EncryptionService } from '../../common/security/encryption.service';
import { CodingToolSpec } from '../tools/tool-specs';
import { User } from '../users/user.entity';
import { McpServerConfig, McpTransport } from './mcp-server-config.entity';

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  };
}

interface ResolvedMcpTool {
  config: McpServerConfig;
  tool: McpTool;
  exposedName: string;
  readOnly: boolean;
}

type McpDiagnosticStatus = 'unknown' | 'disabled' | 'connected' | 'failed';

interface McpServerDiagnostic {
  status: McpDiagnosticStatus;
  toolCount: number;
  cached: boolean;
  checkedAt?: string;
  error?: string;
}

interface McpToolView {
  name: string;
  exposedName: string;
  description: string;
  readOnly: boolean;
}

interface McpServerView {
  id: string;
  name: string;
  slug: string;
  url: string;
  displayUrl: string;
  transport: McpTransport;
  enabled: boolean;
  isPreset: boolean;
  headerNames: string[];
  diagnostic: McpServerDiagnostic;
  createdAt: Date;
  updatedAt: Date;
}

const CONTEXT7_SLUG = 'context7';
const CONTEXT7_URL = 'https://mcp.context7.com/mcp';
const REQUEST_TIMEOUT_MS = 15_000;
const TOOL_RESULT_LIMIT = 24_000;
const MCP_TOOL_PREFIX = 'mcp__';
const JSON_RPC_VERSION = '2.0';
const READ_ONLY_CONTEXT7_TOOLS = new Set(['resolve-library-id', 'query-docs', 'get-library-docs']);

@Injectable()
export class McpService {
  private readonly toolCache = new Map<string, { expiresAt: number; tools: McpTool[] }>();
  private readonly diagnosticCache = new Map<string, McpServerDiagnostic>();
  private readonly sessionIds = new Map<string, string>();

  constructor(
    @InjectRepository(McpServerConfig)
    private readonly configs: Repository<McpServerConfig>,
    private readonly encryption: EncryptionService,
  ) {}

  async handleCommand(
    owner: User,
    parts: string[],
    args?: Record<string, unknown>,
  ): Promise<unknown> {
    const [action, ...rest] = parts;
    if (!action) {
      const servers = await this.list(owner.id);
      return {
        type: 'mcp.list',
        refreshed: false,
        servers: servers.map((server) => this.toView(server)),
      };
    }

    if (action === 'verbose' || action === 'refresh') {
      const servers = await this.list(owner.id);
      const diagnostics = await Promise.all(
        servers.map((server) => this.inspectTools(server, true).then((result) => result.diagnostic)),
      );
      return {
        type: 'mcp.list',
        refreshed: true,
        verbose: action === 'verbose',
        servers: servers.map((server, index) => this.toView(server, diagnostics[index])),
      };
    }

    if (action === CONTEXT7_SLUG) {
      const apiKey = typeof args?.apiKey === 'string' ? args.apiKey : rest[0];
      const server = await this.ensureContext7(owner, apiKey);
      return { type: 'mcp.connected', server: this.toView(server) };
    }

    if (action === 'add') {
      const [slug, url] = rest;
      if (!slug || !url) throw new BadRequestException('Usage: /mcp add <slug> <url>');
      const headers = this.headersFromArgs(args);
      const server = await this.add(owner, {
        slug,
        name: typeof args?.name === 'string' ? args.name : slug,
        url,
        headers,
      });
      return { type: 'mcp.connected', server: this.toView(server) };
    }

    if (action === 'remove') {
      const slug = this.normalizeSlug(rest[0] ?? '');
      if (!slug) throw new BadRequestException('Usage: /mcp remove <slug>');
      await this.remove(owner.id, slug);
      return { type: 'mcp.removed', slug };
    }

    if (action === 'enable' || action === 'disable') {
      const slug = this.normalizeSlug(rest[0] ?? '');
      if (!slug) throw new BadRequestException(`Usage: /mcp ${action} <slug>`);
      const server = await this.setEnabled(owner.id, slug, action === 'enable');
      return {
        type: action === 'enable' ? 'mcp.enabled' : 'mcp.disabled',
        server: this.toView(server),
      };
    }

    if (action === 'tools') {
      const slug = this.normalizeSlug(rest[0] ?? '');
      if (!slug) throw new BadRequestException('Usage: /mcp tools <slug>');
      const server = await this.findOwned(owner.id, slug);
      const result = await this.inspectTools(server, true);
      return {
        type: 'mcp.tools',
        server: this.toView(server, result.diagnostic),
        diagnostic: result.diagnostic,
        tools: result.tools.map((tool) => this.toToolView(server, tool)),
      };
    }

    throw new BadRequestException(`Unsupported MCP command: ${action}`);
  }

  async enabledToolSpecs(owner: User): Promise<CodingToolSpec[]> {
    const servers = await this.configs.find({
      where: { owner: { id: owner.id }, enabled: true },
      order: { createdAt: 'ASC' },
    });
    const specs: CodingToolSpec[] = [];
    const seen = new Set<string>();
    for (const server of servers) {
      const tools = await this.listTools(server).catch(() => []);
      for (const tool of tools) {
        const name = this.exposedToolName(server.slug, tool.name);
        if (seen.has(name)) continue;
        seen.add(name);
        specs.push({
          type: 'function',
          function: {
            name,
            description: `[MCP:${server.slug}] ${tool.description ?? tool.name}`,
            parameters: this.inputSchema(tool),
          },
        });
      }
    }
    return specs;
  }

  isMcpToolName(name: string): boolean {
    return name.startsWith(MCP_TOOL_PREFIX);
  }

  async resolveExposedTool(owner: User, exposedName: string): Promise<ResolvedMcpTool | null> {
    const parsed = this.parseExposedToolName(exposedName);
    if (!parsed) return null;
    const config = await this.configs.findOne({
      where: { owner: { id: owner.id }, slug: parsed.slug },
    });
    if (!config) return null;
    if (!config.enabled) return null;
    const tools = await this.listTools(config);
    const tool = tools.find((item) => this.exposedToolName(config.slug, item.name) === exposedName);
    if (!tool) return null;
    return {
      config,
      tool,
      exposedName,
      readOnly: this.isReadOnlyTool(config, tool),
    };
  }

  async callExposedTool(
    owner: User,
    exposedName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const resolved = await this.resolveExposedTool(owner, exposedName);
    if (!resolved) {
      return `Error: MCP tool "${exposedName}" is not available.`;
    }
    const result = await this.rpc(resolved.config, 'tools/call', {
      name: resolved.tool.name,
      arguments: args,
    });
    return this.truncate(this.stringifyToolResult(result), TOOL_RESULT_LIMIT);
  }

  private async list(ownerId: string): Promise<McpServerConfig[]> {
    return this.configs.find({
      where: { owner: { id: ownerId } },
      order: { createdAt: 'ASC' },
    });
  }

  private async add(
    owner: User,
    input: {
      slug: string;
      name: string;
      url: string;
      headers?: Record<string, string>;
      isPreset?: boolean;
    },
  ): Promise<McpServerConfig> {
    const slug = this.normalizeSlug(input.slug);
    if (!slug)
      throw new BadRequestException(
        'MCP slug must contain letters, numbers, underscores, or hyphens.',
      );
    const url = this.normalizeUrl(input.url);
    const existing = await this.configs.findOne({ where: { owner: { id: owner.id }, slug } });
    const values: Partial<McpServerConfig> = {
      owner,
      slug,
      name: input.name.trim() || slug,
      url,
      transport: McpTransport.StreamableHttp,
      enabled: true,
      isPreset: input.isPreset ?? false,
      encryptedHeaders:
        input.headers && Object.keys(input.headers).length > 0
          ? this.encryption.encrypt(JSON.stringify(input.headers))
          : null,
    };
    const saved = await this.configs.save(
      this.configs.create(existing ? { ...existing, ...values } : values),
    );
    if (existing?.id) this.clearRuntimeState(existing.id);
    return saved;
  }

  private async ensureContext7(owner: User, apiKey?: string): Promise<McpServerConfig> {
    const headers = apiKey?.trim() ? { CONTEXT7_API_KEY: apiKey.trim() } : undefined;
    return this.add(owner, {
      slug: CONTEXT7_SLUG,
      name: 'Context7',
      url: CONTEXT7_URL,
      headers,
      isPreset: true,
    });
  }

  private async remove(ownerId: string, slug: string): Promise<void> {
    const server = await this.findOwned(ownerId, slug);
    await this.configs.remove(server);
    this.clearRuntimeState(server.id);
  }

  private async setEnabled(
    ownerId: string,
    slug: string,
    enabled: boolean,
  ): Promise<McpServerConfig> {
    const server = await this.findOwned(ownerId, slug);
    server.enabled = enabled;
    const saved = await this.configs.save(server);
    this.clearRuntimeState(server.id);
    return saved;
  }

  private async findOwned(ownerId: string, slug: string): Promise<McpServerConfig> {
    const server = await this.configs.findOne({ where: { owner: { id: ownerId }, slug } });
    if (!server) throw new NotFoundException('MCP server not found.');
    return server;
  }

  private async listTools(server: McpServerConfig, refresh = false): Promise<McpTool[]> {
    const cached = this.toolCache.get(server.id);
    if (!refresh && cached && cached.expiresAt > Date.now()) {
      return cached.tools;
    }
    await this.initialize(server).catch(() => undefined);
    const result = await this.rpc(server, 'tools/list', {});
    const tools = this.normalizeTools(result);
    this.toolCache.set(server.id, { tools, expiresAt: Date.now() + 5 * 60_000 });
    return tools;
  }

  private async initialize(server: McpServerConfig): Promise<void> {
    await this.rpc(server, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'Mebius Code', version: '0.1.0' },
    });
    await this.rpc(server, 'notifications/initialized', undefined, true).catch(() => undefined);
  }

  private async rpc(
    server: McpServerConfig,
    method: string,
    params?: Record<string, unknown>,
    notification = false,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const body = JSON.stringify({
        jsonrpc: JSON_RPC_VERSION,
        ...(notification ? {} : { id: `${Date.now()}-${Math.random().toString(16).slice(2)}` }),
        method,
        ...(params === undefined ? {} : { params }),
      });
      const response = await fetch(server.url, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          ...this.decryptHeaders(server),
          ...this.sessionHeaders(server, method),
        },
        body,
        signal: controller.signal,
      }).catch((error) => {
        throw new BadGatewayException(
          error instanceof Error ? error.message : 'MCP request failed.',
        );
      });
      const text = await response.text().catch(() => '');
      if (!response.ok) {
        throw new BadGatewayException(this.providerErrorMessage(response.status, text));
      }
      this.rememberSessionId(server, response);
      if (notification) return null;
      const payload = this.parseMcpResponse(text);
      if (payload.error) throw new BadGatewayException(payload.error);
      return payload.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  private clearRuntimeState(serverId: string): void {
    this.toolCache.delete(serverId);
    this.diagnosticCache.delete(serverId);
    this.sessionIds.delete(serverId);
  }

  private sessionHeaders(server: McpServerConfig, method: string): Record<string, string> {
    if (method === 'initialize') return {};
    const sessionId = this.sessionIds.get(server.id);
    return sessionId ? { 'Mcp-Session-Id': sessionId } : {};
  }

  private rememberSessionId(server: McpServerConfig, response: Response): void {
    const headers = response.headers as Headers | undefined;
    const sessionId = headers?.get?.('mcp-session-id')?.trim();
    if (sessionId) this.sessionIds.set(server.id, sessionId);
  }

  private parseMcpResponse(body: string): { result?: unknown; error?: string } {
    const trimmed = body.trim();
    if (!trimmed) return { result: null };
    const dataLines = trimmed
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .filter((line) => line && line !== '[DONE]');
    const candidates = dataLines.length > 0 ? dataLines : [trimmed];
    let lastResult: unknown;
    for (const candidate of candidates) {
      let parsed: { result?: unknown; error?: unknown };
      try {
        parsed = JSON.parse(candidate) as { result?: unknown; error?: unknown };
      } catch {
        return { error: 'MCP server returned an invalid JSON-RPC response.' };
      }
      if (parsed.error) {
        return { error: this.errorText(parsed.error) };
      }
      if ('result' in parsed) {
        lastResult = parsed.result;
      }
    }
    return { result: lastResult ?? null };
  }

  private normalizeTools(result: unknown): McpTool[] {
    if (!result || typeof result !== 'object') return [];
    const tools = (result as { tools?: unknown }).tools;
    if (!Array.isArray(tools)) return [];
    const normalized: McpTool[] = [];
    tools.forEach((tool) => {
      if (!tool || typeof tool !== 'object') return;
      const value = tool as Record<string, unknown>;
      if (typeof value.name !== 'string' || !value.name.trim()) return;
      const annotations =
        value.annotations && typeof value.annotations === 'object'
          ? (value.annotations as McpTool['annotations'])
          : undefined;
      normalized.push({
        name: value.name.trim(),
        ...(typeof value.description === 'string' ? { description: value.description } : {}),
        ...(value.inputSchema && typeof value.inputSchema === 'object'
          ? { inputSchema: value.inputSchema as Record<string, unknown> }
          : {}),
        ...(annotations ? { annotations } : {}),
      });
    });
    return normalized;
  }

  private isReadOnlyTool(server: McpServerConfig, tool: McpTool): boolean {
    if (server.slug === CONTEXT7_SLUG && READ_ONLY_CONTEXT7_TOOLS.has(tool.name)) return true;
    return tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint !== true;
  }

  private exposedToolName(serverSlug: string, toolName: string): string {
    return `${MCP_TOOL_PREFIX}${serverSlug}__${this.safeToolName(toolName)}`.slice(0, 64);
  }

  private parseExposedToolName(name: string): { slug: string } | null {
    if (!name.startsWith(MCP_TOOL_PREFIX)) return null;
    const rest = name.slice(MCP_TOOL_PREFIX.length);
    const separator = rest.indexOf('__');
    if (separator <= 0) return null;
    return { slug: rest.slice(0, separator) };
  }

  private safeToolName(name: string): string {
    return name
      .trim()
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, 44);
  }

  private inputSchema(tool: McpTool): Record<string, unknown> {
    const schema = tool.inputSchema;
    if (!schema || typeof schema.type !== 'string') {
      return { type: 'object', properties: {} };
    }
    return schema;
  }

  private normalizeSlug(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private normalizeUrl(value: string): string {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException('MCP server URL must be a valid URL.');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new BadRequestException('MCP server URL must use http or https.');
    }
    return url.toString();
  }

  private headersFromArgs(args?: Record<string, unknown>): Record<string, string> | undefined {
    if (!args?.headers || typeof args.headers !== 'object' || Array.isArray(args.headers))
      return undefined;
    const headers: Record<string, string> = {};
    Object.entries(args.headers as Record<string, unknown>).forEach(([key, value]) => {
      if (typeof value === 'string' && key.trim()) {
        headers[key.trim()] = value;
      }
    });
    return Object.keys(headers).length > 0 ? headers : undefined;
  }

  private decryptHeaders(server: McpServerConfig): Record<string, string> {
    if (!server.encryptedHeaders) return {};
    try {
      const parsed = JSON.parse(this.encryption.decrypt(server.encryptedHeaders)) as Record<
        string,
        unknown
      >;
      const headers: Record<string, string> = {};
      Object.entries(parsed).forEach(([key, value]) => {
        if (typeof value === 'string') headers[key] = value;
      });
      return headers;
    } catch {
      return {};
    }
  }

  private toToolView(server: McpServerConfig, tool: McpTool): McpToolView {
    return {
      name: tool.name,
      exposedName: this.exposedToolName(server.slug, tool.name),
      description: tool.description ?? '',
      readOnly: this.isReadOnlyTool(server, tool),
    };
  }

  private async inspectTools(
    server: McpServerConfig,
    refresh: boolean,
  ): Promise<{ tools: McpTool[]; diagnostic: McpServerDiagnostic }> {
    if (!server.enabled) {
      const diagnostic: McpServerDiagnostic = {
        status: 'disabled',
        toolCount: 0,
        cached: false,
      };
      this.diagnosticCache.set(server.id, diagnostic);
      return { tools: [], diagnostic };
    }

    try {
      const tools = await this.listTools(server, refresh);
      const diagnostic: McpServerDiagnostic = {
        status: 'connected',
        toolCount: tools.length,
        checkedAt: new Date().toISOString(),
        cached: false,
      };
      this.diagnosticCache.set(server.id, diagnostic);
      return { tools, diagnostic };
    } catch (error) {
      const diagnostic: McpServerDiagnostic = {
        status: 'failed',
        toolCount: 0,
        checkedAt: new Date().toISOString(),
        cached: false,
        error: this.sanitizeDiagnosticError(error),
      };
      this.diagnosticCache.set(server.id, diagnostic);
      return { tools: [], diagnostic };
    }
  }

  private cachedDiagnostic(server: McpServerConfig): McpServerDiagnostic {
    if (!server.enabled) {
      return {
        status: 'disabled',
        toolCount: 0,
        cached: false,
      };
    }
    const cached = this.diagnosticCache.get(server.id);
    if (cached) return { ...cached, cached: true };
    return {
      status: 'unknown',
      toolCount: 0,
      cached: false,
    };
  }

  private toView(server: McpServerConfig, diagnostic = this.cachedDiagnostic(server)): McpServerView {
    const displayUrl = this.redactedDisplayUrl(server.url);
    return {
      id: server.id,
      name: server.name,
      slug: server.slug,
      url: displayUrl,
      displayUrl,
      transport: server.transport,
      enabled: server.enabled,
      isPreset: server.isPreset,
      headerNames: Object.keys(this.decryptHeaders(server)),
      diagnostic,
      createdAt: server.createdAt,
      updatedAt: server.updatedAt,
    };
  }

  private stringifyToolResult(result: unknown): string {
    if (!result || typeof result !== 'object') return String(result ?? '');
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const text = content
        .map((item) => {
          if (!item || typeof item !== 'object') return '';
          const value = item as Record<string, unknown>;
          if (value.type === 'text' && typeof value.text === 'string') return value.text;
          return JSON.stringify(value);
        })
        .filter(Boolean)
        .join('\n');
      if (text) return text;
    }
    return JSON.stringify(result, null, 2);
  }

  private errorText(error: unknown): string {
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object') {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string') return message;
    }
    return 'MCP server returned an error.';
  }

  private providerErrorMessage(status: number, body: string): string {
    const trimmed = body.trim();
    return trimmed
      ? `MCP server returned ${status}: ${this.truncate(trimmed, 600)}`
      : `MCP server returned ${status}.`;
  }

  private sanitizeDiagnosticError(error: unknown): string {
    const message = error instanceof Error ? error.message : 'MCP request failed.';
    return this.redactSensitiveText(this.truncate(message, 600));
  }

  private redactedDisplayUrl(value: string): string {
    try {
      const url = new URL(value);
      for (const key of [...url.searchParams.keys()]) {
        if (this.isSensitiveName(key)) {
          url.searchParams.set(key, '*****');
        }
      }
      return url.toString();
    } catch {
      return this.redactSensitiveText(value);
    }
  }

  private redactSensitiveText(value: string): string {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer *****')
      .replace(/((?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1*****');
  }

  private isSensitiveName(value: string): boolean {
    return /api[_-]?key|token|secret|password|authorization|credential/i.test(value);
  }

  private truncate(value: string, max: number): string {
    return value.length <= max ? value : `${value.slice(0, max)}\n[truncated]`;
  }
}
