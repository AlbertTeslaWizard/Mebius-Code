import { BadGatewayException, BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type WebSearchProviderId = 'exa' | 'tavily';
type WebSearchTopic = 'general' | 'news' | 'finance';
type TavilySearchDepth = 'basic' | 'advanced' | 'fast' | 'ultra-fast';
type TavilyTimeRange = 'day' | 'week' | 'month' | 'year';
type ExaSearchType = 'auto' | 'fast' | 'deep';
type ExaLivecrawlMode = 'fallback' | 'preferred';

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  score?: number;
  source?: string;
}

export interface WebSearchResult {
  query: string;
  provider: WebSearchProviderId;
  answer?: string;
  content?: string;
  quotaLimited?: boolean;
  message?: string;
  results: WebSearchResultItem[];
  responseTime?: string;
}

interface WebSearchInput {
  query: string;
  maxResults: number;
  recencyDays?: number;
  domains: string[];
  excludeDomains: string[];
  topic: WebSearchTopic;
}

interface TavilySearchResponse {
  query?: unknown;
  answer?: unknown;
  results?: unknown;
  response_time?: unknown;
}

const DEFAULT_MAX_RESULTS = 5;
const ABSOLUTE_MAX_RESULTS = 20;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CONTEXT_MAX_CHARACTERS = 10_000;
const MAX_QUERY_LENGTH = 512;
const EXA_MCP_URL = 'https://mcp.exa.ai/mcp';
const SECRET_VALUE_PATTERNS = [
  /sk-[A-Za-z0-9_-]{10,}/,
  /gh[pousr]_[A-Za-z0-9_]{10,}/,
  /Bearer\s+[A-Za-z0-9._-]{20,}/i,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
];

@Injectable()
export class WebSearchService {
  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return !this.configDisabled('WEB_SEARCH_ENABLED');
  }

  async search(args: Record<string, unknown>): Promise<string> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException(
        'web_search is disabled. Remove WEB_SEARCH_ENABLED=false or set WEB_SEARCH_ENABLED=true.',
      );
    }

    const input = this.normalizeInput(args);
    const result = this.providerId() === 'tavily' ? await this.searchTavily(input) : await this.searchExa(input);
    return JSON.stringify(result, null, 2);
  }

  private normalizeInput(args: Record<string, unknown>): WebSearchInput {
    if (typeof args.query !== 'string' || !args.query.trim()) {
      throw new BadRequestException('web_search requires query.');
    }

    const query = args.query.trim().replace(/\s+/g, ' ');
    if (query.length > MAX_QUERY_LENGTH) {
      throw new BadRequestException(`web_search query must be ${MAX_QUERY_LENGTH} characters or less.`);
    }
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(query))) {
      throw new BadRequestException('web_search query appears to contain a secret or token.');
    }

    const configuredMax = this.clampedInteger(
      this.config.get<string>('WEB_SEARCH_MAX_RESULTS'),
      DEFAULT_MAX_RESULTS,
      1,
      ABSOLUTE_MAX_RESULTS,
    );
    const requestedMax = typeof args.maxResults === 'number' ? args.maxResults : configuredMax;
    const maxResults = this.clampedInteger(requestedMax, configuredMax, 1, configuredMax);
    const recencyDays = typeof args.recencyDays === 'number' && Number.isFinite(args.recencyDays)
      ? Math.max(1, Math.floor(args.recencyDays))
      : undefined;
    const topic = this.normalizeTopic(args.topic);

    return {
      query,
      maxResults,
      recencyDays,
      topic,
      domains: this.normalizeDomains(args.domains, this.config.get<string>('WEB_SEARCH_ALLOWED_DOMAINS')),
      excludeDomains: this.normalizeDomains(
        args.excludeDomains,
        this.config.get<string>('WEB_SEARCH_BLOCKED_DOMAINS'),
      ),
    };
  }

  private async searchExa(input: WebSearchInput): Promise<WebSearchResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      const apiKey = this.exaApiKey();
      const headers: Record<string, string> = {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers['x-api-key'] = apiKey;
      }

      const response = await fetch(EXA_MCP_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(this.toExaMcpRequest(input)),
        signal: controller.signal,
      }).catch((error) => {
        throw new BadGatewayException(error instanceof Error ? error.message : 'Web search request failed.');
      });
      const body = await response.text().catch(() => '');

      if (!response.ok) {
        if (this.isQuotaLimited(response.status, body)) {
          return this.quotaLimitedResult(input.query, body);
        }
        throw new BadGatewayException(this.providerErrorMessage(response.status, body));
      }

      const parsed = this.parseExaMcpResponse(body);
      if (parsed.error) {
        if (this.isQuotaLimited(response.status, parsed.error)) {
          return this.quotaLimitedResult(input.query, parsed.error);
        }
        throw new BadGatewayException(parsed.error);
      }
      if (!parsed.text) {
        throw new BadGatewayException('Web search provider returned an empty MCP response.');
      }

      return this.normalizeExaResponse(input.query, parsed.text, input.maxResults);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async searchTavily(input: WebSearchInput): Promise<WebSearchResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.tavilyApiKey()}`,
        },
        body: JSON.stringify(this.toTavilyRequest(input)),
        signal: controller.signal,
      }).catch((error) => {
        throw new BadGatewayException(error instanceof Error ? error.message : 'Web search request failed.');
      });

      if (!response.ok) {
        throw new BadGatewayException(await this.readErrorResponse(response));
      }

      const payload = (await response.json().catch(() => null)) as TavilySearchResponse | null;
      if (!payload) {
        throw new BadGatewayException('Web search provider returned invalid JSON.');
      }

      return this.normalizeTavilyResponse(input.query, payload);
    } finally {
      clearTimeout(timeout);
    }
  }

  private toTavilyRequest(input: WebSearchInput): Record<string, unknown> {
    return {
      query: input.query,
      search_depth: this.searchDepth(),
      max_results: input.maxResults,
      topic: input.topic,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      include_favicon: false,
      ...(input.recencyDays ? { time_range: this.recencyToTimeRange(input.recencyDays) } : {}),
      ...(input.domains.length > 0 ? { include_domains: input.domains } : {}),
      ...(input.excludeDomains.length > 0 ? { exclude_domains: input.excludeDomains } : {}),
    };
  }

  private toExaMcpRequest(input: WebSearchInput): Record<string, unknown> {
    return {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'web_search_exa',
        arguments: {
          query: this.queryWithDomainHints(input),
          type: this.exaSearchType(),
          numResults: input.maxResults,
          livecrawl: this.exaLivecrawlMode(),
          contextMaxCharacters: this.contextMaxCharacters(),
        },
      },
    };
  }

  private normalizeTavilyResponse(query: string, payload: TavilySearchResponse): WebSearchResult {
    const results = Array.isArray(payload.results) ? payload.results : [];
    return {
      query: typeof payload.query === 'string' ? payload.query : query,
      provider: 'tavily',
      answer: typeof payload.answer === 'string' && payload.answer.trim() ? payload.answer.trim() : undefined,
      responseTime:
        typeof payload.response_time === 'string' || typeof payload.response_time === 'number'
          ? String(payload.response_time)
          : undefined,
      results: results
        .map((item) => this.normalizeTavilyResult(item))
        .filter((item): item is WebSearchResultItem => item !== null),
    };
  }

  private normalizeExaResponse(query: string, content: string, maxResults: number): WebSearchResult {
    const trimmed = this.truncate(content.trim(), this.contextMaxCharacters());
    return {
      query,
      provider: 'exa',
      content: trimmed,
      results: this.extractResultItems(trimmed, maxResults),
    };
  }

  private normalizeTavilyResult(value: unknown): WebSearchResultItem | null {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const result = value as Record<string, unknown>;
    const title = this.stringValue(result.title);
    const url = this.stringValue(result.url);
    if (!title || !url || !this.isHttpUrl(url)) {
      return null;
    }

    return {
      title,
      url,
      snippet: this.truncate(this.stringValue(result.content) ?? '', 1_500),
      publishedAt:
        this.stringValue(result.published_date) ??
        this.stringValue(result.publishedDate) ??
        this.stringValue(result.date),
      score: typeof result.score === 'number' ? result.score : undefined,
      source: this.hostname(url),
    };
  }

  private parseExaMcpResponse(body: string): { text?: string; error?: string } {
    const payloads = [body.trim()];
    body.split(/\r?\n/).forEach((line) => {
      if (line.startsWith('data: ')) {
        payloads.push(line.slice(6).trim());
      }
    });

    for (const payload of payloads.filter((item) => item && item !== '[DONE]')) {
      const parsed = this.parseJsonObject(payload);
      if (!parsed) {
        continue;
      }
      const error = parsed.error;
      if (error && typeof error === 'object') {
        const message = (error as Record<string, unknown>).message;
        return { error: typeof message === 'string' ? message : 'Web search provider returned an MCP error.' };
      }
      const result = parsed.result;
      if (!result || typeof result !== 'object') {
        continue;
      }
      const content = (result as Record<string, unknown>).content;
      if (!Array.isArray(content)) {
        continue;
      }
      const textItem = content.find(
        (item) =>
          item &&
          typeof item === 'object' &&
          typeof (item as Record<string, unknown>).text === 'string' &&
          ((item as Record<string, unknown>).text as string).trim(),
      );
      if (textItem && typeof textItem === 'object') {
        return { text: ((textItem as Record<string, unknown>).text as string).trim() };
      }
    }

    return {};
  }

  private parseJsonObject(value: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  private quotaLimitedResult(query: string, providerMessage: string): WebSearchResult {
    return {
      query,
      provider: 'exa',
      quotaLimited: true,
      message:
        'Free web search quota has been reached. Try again later, or configure EXA_API_KEY to continue with your own Exa account.',
      content: this.truncate(providerMessage, 500),
      results: [],
    };
  }

  private extractResultItems(content: string, maxResults: number): WebSearchResultItem[] {
    const urls = [...content.matchAll(/https?:\/\/[^\s)\]>"']+/g)]
      .map((match) => match[0].replace(/[.,;:]+$/, ''))
      .filter((url) => this.isHttpUrl(url));
    return [...new Set(urls)].slice(0, maxResults).map((url) => ({
      title: this.hostname(url) ?? url,
      url,
      snippet: this.snippetAroundUrl(content, url),
      source: this.hostname(url),
    }));
  }

  private snippetAroundUrl(content: string, url: string): string {
    const index = content.indexOf(url);
    if (index < 0) {
      return '';
    }
    const start = Math.max(0, index - 220);
    const end = Math.min(content.length, index + url.length + 280);
    return this.truncate(content.slice(start, end).replace(/\s+/g, ' ').trim(), 500);
  }

  private queryWithDomainHints(input: WebSearchInput): string {
    const includeHints = input.domains.map((domain) => `site:${domain}`);
    const excludeHints = input.excludeDomains.map((domain) => `-site:${domain}`);
    return [input.query, ...includeHints, ...excludeHints].join(' ');
  }

  private providerId(): WebSearchProviderId {
    const configured = (this.config.get<string>('WEB_SEARCH_PROVIDER') ?? 'exa').trim().toLowerCase();
    if (configured === 'tavily' && this.tavilyApiKey().length > 0) {
      return 'tavily';
    }
    return 'exa';
  }

  private tavilyApiKey(): string {
    return (this.config.get<string>('TAVILY_API_KEY') ?? this.config.get<string>('WEB_SEARCH_API_KEY') ?? '').trim();
  }

  private exaApiKey(): string {
    return (this.config.get<string>('EXA_API_KEY') ?? '').trim();
  }

  private searchDepth(): TavilySearchDepth {
    const value = (this.config.get<string>('TAVILY_SEARCH_DEPTH') ?? 'basic').trim().toLowerCase();
    return ['basic', 'advanced', 'fast', 'ultra-fast'].includes(value) ? (value as TavilySearchDepth) : 'basic';
  }

  private exaSearchType(): ExaSearchType {
    const value = (this.config.get<string>('EXA_SEARCH_TYPE') ?? 'auto').trim().toLowerCase();
    return ['auto', 'fast', 'deep'].includes(value) ? (value as ExaSearchType) : 'auto';
  }

  private exaLivecrawlMode(): ExaLivecrawlMode {
    const value = (this.config.get<string>('EXA_LIVECRAWL') ?? 'fallback').trim().toLowerCase();
    return value === 'preferred' ? 'preferred' : 'fallback';
  }

  private timeoutMs(): number {
    return this.clampedInteger(this.config.get<string>('WEB_SEARCH_TIMEOUT_MS'), DEFAULT_TIMEOUT_MS, 1_000, 30_000);
  }

  private contextMaxCharacters(): number {
    return this.clampedInteger(
      this.config.get<string>('WEB_SEARCH_CONTEXT_MAX_CHARACTERS'),
      DEFAULT_CONTEXT_MAX_CHARACTERS,
      1_000,
      50_000,
    );
  }

  private recencyToTimeRange(days: number): TavilyTimeRange {
    if (days <= 1) return 'day';
    if (days <= 7) return 'week';
    if (days <= 31) return 'month';
    return 'year';
  }

  private normalizeTopic(value: unknown): WebSearchTopic {
    return value === 'news' || value === 'finance' || value === 'general' ? value : 'general';
  }

  private normalizeDomains(value: unknown, configured?: string): string[] {
    const requested = Array.isArray(value)
      ? value
      : typeof configured === 'string' && configured.trim()
        ? configured.split(',')
        : [];
    const domains = requested
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().toLowerCase())
      .map((item) => item.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
      .filter((item) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(item));
    return [...new Set(domains)].slice(0, 10);
  }

  private configDisabled(key: string): boolean {
    return ['0', 'false', 'no', 'off'].includes((this.config.get<string>(key) ?? '').trim().toLowerCase());
  }

  private clampedInteger(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.floor(parsed)));
  }

  private stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private isHttpUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private hostname(value: string): string | undefined {
    try {
      return new URL(value).hostname;
    } catch {
      return undefined;
    }
  }

  private truncate(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
  }

  private isQuotaLimited(status: number, message: string): boolean {
    return status === 429 || /free mcp rate limit|rate limit|quota|credits exhausted/i.test(message);
  }

  private providerErrorMessage(status: number, text: string): string {
    const fallback = `Web search provider returned HTTP ${status}.`;
    return text ? `${fallback} ${text.slice(0, 500)}` : fallback;
  }

  private async readErrorResponse(response: Response): Promise<string> {
    const text = await response.text().catch(() => '');
    return this.providerErrorMessage(response.status, text);
  }
}
