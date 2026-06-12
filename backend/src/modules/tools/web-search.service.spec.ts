import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebSearchService } from './web-search.service';

describe('WebSearchService', () => {
  const configValues = new Map<string, string>();
  const config = {
    get: jest.fn((key: string) => configValues.get(key)),
  } as unknown as jest.Mocked<ConfigService>;
  const service = new WebSearchService(config);
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    configValues.clear();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [
            {
              type: 'text',
              text: 'NestJS release notes are available at https://github.com/nestjs/nest/releases with changelog details.',
            },
          ],
        },
      })),
    } as unknown as Response);
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('reports enabled by default and supports an explicit disable flag', () => {
    expect(service.isEnabled()).toBe(true);
    configValues.set('WEB_SEARCH_ENABLED', 'false');
    expect(service.isEnabled()).toBe(false);
  });

  it('calls Exa hosted MCP by default and normalizes search results', async () => {
    configValues.set('EXA_API_KEY', 'exa-test');

    const result = JSON.parse(
      await service.search({
        query: 'latest nestjs release',
        maxResults: 3,
        domains: ['https://docs.nestjs.com/releases'],
        excludeDomains: ['example.com/path'],
      }),
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'https://mcp.exa.ai/mcp',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'exa-test',
        }),
      }),
    );
    const requestBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(requestBody).toEqual(
      expect.objectContaining({
        method: 'tools/call',
        params: expect.objectContaining({
          name: 'web_search_exa',
          arguments: expect.objectContaining({
            query: 'latest nestjs release site:docs.nestjs.com -site:example.com',
            numResults: 3,
            type: 'auto',
            livecrawl: 'fallback',
          }),
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        query: 'latest nestjs release',
        provider: 'exa',
        content: expect.stringContaining('NestJS release notes'),
        results: [
          expect.objectContaining({
            url: 'https://github.com/nestjs/nest/releases',
            source: 'github.com',
          }),
        ],
      }),
    );
  });

  it('returns guidance instead of failing when Exa free quota is exhausted', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: jest.fn().mockResolvedValue('Free MCP rate limit exceeded.'),
    } as unknown as Response);

    const result = JSON.parse(await service.search({ query: 'nestjs docs' }));

    expect(result).toEqual(
      expect.objectContaining({
        provider: 'exa',
        quotaLimited: true,
        message: expect.stringContaining('configure EXA_API_KEY'),
        results: [],
      }),
    );
  });

  it('uses Tavily only when explicitly configured with credentials', async () => {
    configValues.set('WEB_SEARCH_PROVIDER', 'tavily');
    configValues.set('TAVILY_API_KEY', 'tvly-test');
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        query: 'latest nestjs release',
        results: [
          {
            title: 'NestJS Releases',
            url: 'https://github.com/nestjs/nest/releases',
            content: 'Latest release notes',
            score: 0.9,
          },
        ],
        response_time: '0.42',
      }),
    } as unknown as Response);

    const result = JSON.parse(await service.search({ query: 'latest nestjs release', maxResults: 3 }));

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.tavily.com/search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer tvly-test',
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        query: 'latest nestjs release',
        provider: 'tavily',
      }),
    );
  });

  it('rejects searches when disabled or query contains a token', async () => {
    configValues.set('WEB_SEARCH_ENABLED', 'false');
    await expect(service.search({ query: 'nestjs docs' })).rejects.toBeInstanceOf(ServiceUnavailableException);

    configValues.set('WEB_SEARCH_ENABLED', 'true');
    await expect(service.search({ query: 'debug sk-1234567890abcdef token' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
