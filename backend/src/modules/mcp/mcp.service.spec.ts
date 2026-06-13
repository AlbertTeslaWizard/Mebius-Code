import { Repository } from 'typeorm';
import { EncryptionService } from '../../common/security/encryption.service';
import { User } from '../users/user.entity';
import { McpServerConfig, McpTransport } from './mcp-server-config.entity';
import { McpService } from './mcp.service';

describe('McpService', () => {
  const owner = { id: 'owner-1' } as User;
  const createdAt = new Date('2026-06-12T00:00:00.000Z');
  const configs = {
    create: jest.fn((value) => value),
    save: jest.fn(
      async (value) =>
        ({
          id: (value as McpServerConfig).id ?? 'mcp-1',
          createdAt,
          updatedAt: createdAt,
          ...value,
        }) as McpServerConfig,
    ),
    find: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(async (value) => value),
  } as unknown as jest.Mocked<Repository<McpServerConfig>>;
  const encryption = {
    encrypt: jest.fn((value: string) => `encrypted:${value}`),
    decrypt: jest.fn((value: string) => value.replace(/^encrypted:/, '')),
  } as unknown as jest.Mocked<EncryptionService>;

  let service: McpService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new McpService(configs, encryption);
    configs.find.mockResolvedValue([]);
    configs.findOne.mockResolvedValue(null);
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('creates the Context7 preset without leaking header values', async () => {
    const result = await service.handleCommand(owner, ['context7'], { apiKey: 'ctx7-secret' });

    expect(configs.findOne).toHaveBeenCalledWith({
      where: { owner: { id: owner.id }, slug: 'context7' },
    });
    expect(encryption.encrypt).toHaveBeenCalledWith(
      JSON.stringify({ CONTEXT7_API_KEY: 'ctx7-secret' }),
    );
    expect(configs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        owner,
        slug: 'context7',
        name: 'Context7',
        url: 'https://mcp.context7.com/mcp',
        enabled: true,
        isPreset: true,
        encryptedHeaders: expect.stringContaining('ctx7-secret'),
      }),
    );
    expect(result).toEqual({
      type: 'mcp.connected',
      server: expect.objectContaining({
        slug: 'context7',
        headerNames: ['CONTEXT7_API_KEY'],
        diagnostic: expect.objectContaining({ status: 'unknown' }),
      }),
    });
    expect(JSON.stringify(result)).not.toContain('ctx7-secret');
  });

  it('lists configured MCP servers without probing providers by default', async () => {
    configs.find.mockResolvedValueOnce([
      serverFixture({
        slug: 'context7',
        url: 'https://mcp.context7.com/mcp?api_key=ctx7-secret',
        encryptedHeaders: 'encrypted:{"Authorization":"Bearer ctx7-secret"}',
      }),
    ]);

    const result = await service.handleCommand(owner, []);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      type: 'mcp.list',
      refreshed: false,
      servers: [
        expect.objectContaining({
          slug: 'context7',
          url: 'https://mcp.context7.com/mcp?api_key=*****',
          displayUrl: 'https://mcp.context7.com/mcp?api_key=*****',
          headerNames: ['Authorization'],
          diagnostic: {
            status: 'unknown',
            toolCount: 0,
            cached: false,
          },
        }),
      ],
    });
    expect(JSON.stringify(result)).not.toContain('ctx7-secret');
  });

  it('refreshes MCP diagnostics and caches successful tool counts', async () => {
    configs.find.mockResolvedValue([serverFixture({ slug: 'context7' })]);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 'init', result: {} }))
      .mockResolvedValueOnce(textResponse(''))
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: 'tools',
          result: {
            tools: [
              { name: 'resolve-library-id' },
              { name: 'query-docs', annotations: { readOnlyHint: true } },
            ],
          },
        }),
      );

    const refreshed = await service.handleCommand(owner, ['refresh']);
    const cached = await service.handleCommand(owner, []);

    expect(refreshed).toEqual({
      type: 'mcp.list',
      refreshed: true,
      verbose: false,
      servers: [
        expect.objectContaining({
          slug: 'context7',
          diagnostic: expect.objectContaining({
            status: 'connected',
            toolCount: 2,
            cached: false,
            checkedAt: expect.any(String),
          }),
        }),
      ],
    });
    expect(cached).toEqual({
      type: 'mcp.list',
      refreshed: false,
      servers: [
        expect.objectContaining({
          diagnostic: expect.objectContaining({
            status: 'connected',
            toolCount: 2,
            cached: true,
          }),
        }),
      ],
    });
  });

  it('returns failed diagnostics for provider errors instead of failing the MCP tools command', async () => {
    const server = serverFixture({ slug: 'context7' });
    configs.findOne.mockResolvedValue(server);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 'init', result: {} }))
      .mockResolvedValueOnce(textResponse(''))
      .mockResolvedValueOnce(textResponse('Authorization: Bearer ctx7-secret', 401));

    const result = await service.handleCommand(owner, ['tools', 'context7']);

    expect(result).toEqual({
      type: 'mcp.tools',
      server: expect.objectContaining({
        slug: 'context7',
        diagnostic: expect.objectContaining({
          status: 'failed',
          toolCount: 0,
          cached: false,
          checkedAt: expect.any(String),
          error: expect.stringContaining('*****'),
        }),
      }),
      diagnostic: expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('*****'),
      }),
      tools: [],
    });
    expect(JSON.stringify(result)).not.toContain('ctx7-secret');
  });

  it('discovers enabled MCP tools from an SSE JSON-RPC response', async () => {
    configs.find.mockResolvedValueOnce([serverFixture({ slug: 'context7' })]);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', id: 'init', result: {} }, 200, {
          'mcp-session-id': 'ctx-session-1',
        }),
      )
      .mockResolvedValueOnce(textResponse(''))
      .mockResolvedValueOnce(
        textResponse(
          [
            'event: message',
            `data: ${JSON.stringify({
              jsonrpc: '2.0',
              id: 'tools',
              result: {
                tools: [
                  {
                    name: 'query-docs',
                    description: 'Retrieve documentation for a library.',
                    inputSchema: {
                      type: 'object',
                      properties: {
                        libraryId: { type: 'string' },
                        query: { type: 'string' },
                      },
                      required: ['libraryId', 'query'],
                    },
                  },
                ],
              },
            })}`,
            '',
          ].join('\n'),
        ),
      );

    const specs = await service.enabledToolSpecs(owner);
    const initHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const initializedHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    const toolsHeaders = fetchMock.mock.calls[2]?.[1]?.headers as Record<string, string>;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(initHeaders).not.toHaveProperty('Mcp-Session-Id');
    expect(initializedHeaders).toMatchObject({ 'Mcp-Session-Id': 'ctx-session-1' });
    expect(toolsHeaders).toMatchObject({ 'Mcp-Session-Id': 'ctx-session-1' });
    expect(specs).toEqual([
      expect.objectContaining({
        type: 'function',
        function: expect.objectContaining({
          name: 'mcp__context7__query-docs',
          description: '[MCP:context7] Retrieve documentation for a library.',
          parameters: expect.objectContaining({
            required: ['libraryId', 'query'],
          }),
        }),
      }),
    ]);
  });

  it('maps exposed tool names back to provider tool names when calling MCP', async () => {
    const server = serverFixture({ slug: 'context7' });
    configs.findOne.mockResolvedValue(server);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 'init', result: {} }))
      .mockResolvedValueOnce(textResponse(''))
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: 'tools',
          result: {
            tools: [
              {
                name: 'query-docs',
                annotations: { readOnlyHint: true },
                inputSchema: { type: 'object', properties: {} },
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: 'call',
          result: {
            content: [{ type: 'text', text: 'Current docs content' }],
          },
        }),
      );

    const result = await service.callExposedTool(owner, 'mcp__context7__query-docs', {
      libraryId: '/nestjs/docs',
      query: 'guards',
    });

    expect(result).toBe('Current docs content');
    const callBody = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body)) as {
      method: string;
      params: { name: string; arguments: Record<string, unknown> };
    };
    expect(callBody).toMatchObject({
      method: 'tools/call',
      params: {
        name: 'query-docs',
        arguments: { libraryId: '/nestjs/docs', query: 'guards' },
      },
    });
  });

  it('returns null for unavailable exposed MCP tools', async () => {
    configs.findOne.mockResolvedValueOnce(null);

    await expect(service.resolveExposedTool(owner, 'mcp__missing__query-docs')).resolves.toBeNull();
  });

  it('wraps invalid MCP responses as a gateway error', async () => {
    const server = serverFixture({ slug: 'context7' });
    configs.findOne.mockResolvedValue(server);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 'init', result: {} }))
      .mockResolvedValueOnce(textResponse(''))
      .mockResolvedValueOnce(textResponse('not json'));

    await expect(service.callExposedTool(owner, 'mcp__context7__query-docs', {})).rejects.toThrow(
      'MCP server returned an invalid JSON-RPC response.',
    );
  });
});

function serverFixture(input: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: input.id ?? 'mcp-1',
    owner: input.owner ?? ({ id: 'owner-1' } as User),
    name: input.name ?? 'Context7',
    slug: input.slug ?? 'context7',
    url: input.url ?? 'https://mcp.context7.com/mcp',
    transport: input.transport ?? McpTransport.StreamableHttp,
    enabled: input.enabled ?? true,
    encryptedHeaders: input.encryptedHeaders ?? null,
    isPreset: input.isPreset ?? true,
    createdAt: input.createdAt ?? new Date('2026-06-12T00:00:00.000Z'),
    updatedAt: input.updatedAt ?? new Date('2026-06-12T00:00:00.000Z'),
  } as McpServerConfig;
}

function jsonResponse(
  payload: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return response(JSON.stringify(payload), status, headers);
}

function textResponse(text: string, status = 200, headers: Record<string, string> = {}): Response {
  return response(text, status, headers);
}

function response(text: string, status = 200, headers: Record<string, string> = {}): Response {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: jest.fn((name: string) => normalizedHeaders[name.toLowerCase()] ?? null),
    },
    text: jest.fn().mockResolvedValue(text),
  } as unknown as Response;
}
