import { BadGatewayException, Injectable } from '@nestjs/common';
import { RuntimeModelConfig } from '../model-configs/model-configs.service';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  reasoning_content?: string | null;
  tool_call_id?: string;
  tool_calls?: LlmToolCall[];
}

export interface LlmToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface LlmAssistantMessage {
  content?: string;
  reasoning_content?: string;
  tool_calls?: LlmToolCall[];
}

export interface LlmTokenEvent {
  delta: string;
  content: string;
}

interface ChatInput {
  config: RuntimeModelConfig;
  messages: LlmMessage[];
  tools?: unknown[];
  temperature?: number;
}

export type ModelStreamFallbackReason = 'stream_rejected' | 'missing_body' | 'interrupted' | 'timeout';

export interface ModelStreamFallbackEvent {
  reason: ModelStreamFallbackReason;
}

export interface ModelStreamInterruptedEvent {
  reason: Extract<ModelStreamFallbackReason, 'interrupted' | 'timeout'>;
  message: string;
}

export interface StreamChatOptions {
  idleTimeoutMs?: number;
  onStreamFallback?: (event: ModelStreamFallbackEvent) => void;
  onStreamInterrupted?: (event: ModelStreamInterruptedEvent) => void;
}

interface StreamToolCallDelta {
  index?: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

const MODEL_STREAM_IDLE_TIMEOUT_MS = 60_000;

class ModelStreamTimeoutError extends Error {
  constructor() {
    super('Model stream timed out. Please retry.');
    this.name = 'ModelStreamTimeoutError';
  }
}

@Injectable()
export class OpenAiCompatibleService {
  async chat(input: ChatInput): Promise<LlmAssistantMessage> {
    const response = await fetch(`${input.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.config.apiKey}`,
      },
      body: JSON.stringify(this.createRequestBody(input, false)),
    }).catch((error) => {
      throw new BadGatewayException(error instanceof Error ? error.message : 'Model request failed.');
    });

    if (!response.ok) {
      throw new BadGatewayException(await this.readErrorResponse(response));
    }

    const payload = await this.readJsonResponse<{
      choices?: Array<{ message?: LlmAssistantMessage }>;
    }>(response);
    const message = payload.choices?.[0]?.message;
    if (!message) {
      throw new BadGatewayException('Model provider returned an empty response.');
    }
    return message;
  }

  async streamChat(
    input: ChatInput,
    onToken: (event: LlmTokenEvent) => void,
    options: StreamChatOptions = {},
  ): Promise<LlmAssistantMessage> {
    const response = await fetch(`${input.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.config.apiKey}`,
      },
      body: JSON.stringify(this.createRequestBody(input, true)),
    }).catch((error) => {
      throw new BadGatewayException(error instanceof Error ? error.message : 'Model request failed.');
    });

    if (!response.ok) {
      if ([400, 404, 422].includes(response.status)) {
        return this.chatWithTokenFallback(input, onToken, options, 'stream_rejected');
      }
      throw new BadGatewayException(await this.readErrorResponse(response));
    }

    if (!response.body) {
      return this.chatWithTokenFallback(input, onToken, options, 'missing_body');
    }

    let sawAnyContentDelta = false;
    const trackedOnToken = (event: LlmTokenEvent) => {
      if (event.delta) {
        sawAnyContentDelta = true;
      }
      onToken(event);
    };

    try {
      return await this.parseStream(
        response.body,
        trackedOnToken,
        options.idleTimeoutMs ?? MODEL_STREAM_IDLE_TIMEOUT_MS,
      );
    } catch (error) {
      const interrupted = this.modelStreamInterrupted(error);
      const reason = interrupted.message.includes('timed out') ? 'timeout' : 'interrupted';
      if (!sawAnyContentDelta) {
        return this.chatWithTokenFallback(input, onToken, options, reason);
      }
      options.onStreamInterrupted?.({ reason, message: interrupted.message });
      throw interrupted;
    }
  }

  private async chatWithTokenFallback(
    input: ChatInput,
    onToken: (event: LlmTokenEvent) => void,
    options: StreamChatOptions = {},
    reason: ModelStreamFallbackReason,
  ): Promise<LlmAssistantMessage> {
    options.onStreamFallback?.({ reason });
    const message = await this.chat(input);
    if (message.content) {
      onToken({ delta: message.content, content: message.content });
    }
    return message;
  }

  private createRequestBody(input: ChatInput, stream: boolean): Record<string, unknown> {
    return {
      model: input.config.modelName,
      messages: input.messages,
      tools: input.config.supportsTools ? input.tools : undefined,
      temperature: input.temperature ?? 0.2,
      stream,
    };
  }

  private async parseStream(
    body: ReadableStream<Uint8Array>,
    onToken: (event: LlmTokenEvent) => void,
    idleTimeoutMs: number,
  ): Promise<LlmAssistantMessage> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const toolCalls = new Map<number, LlmToolCall>();
    let buffer = '';
    let content = '';
    let reasoningContent = '';

    try {
      while (true) {
        const { done, value } = await this.readStreamChunk(reader, idleTimeoutMs);
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const doneReading = this.consumeStreamLine(
            line,
            toolCalls,
            (delta) => {
              content += delta;
              onToken({ delta, content });
            },
            (delta) => {
              reasoningContent += delta;
            },
          );
          if (doneReading) {
            return this.streamResult(content, reasoningContent, toolCalls);
          }
        }
      }

      buffer += decoder.decode();
      for (const line of buffer.split(/\r?\n/)) {
        const doneReading = this.consumeStreamLine(
          line,
          toolCalls,
          (delta) => {
            content += delta;
            onToken({ delta, content });
          },
          (delta) => {
            reasoningContent += delta;
          },
        );
        if (doneReading) break;
      }
    } catch (error) {
      void reader.cancel().catch(() => undefined);
      throw this.modelStreamInterrupted(error);
    }

    return this.streamResult(content, reasoningContent, toolCalls);
  }

  private async readStreamChunk(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    idleTimeoutMs: number,
  ): Promise<ReadableStreamReadResult<Uint8Array>> {
    if (idleTimeoutMs <= 0) {
      return reader.read();
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new ModelStreamTimeoutError()), idleTimeoutMs);
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private modelStreamInterrupted(error: unknown): BadGatewayException {
    if (error instanceof BadGatewayException) {
      return error;
    }
    if (error instanceof ModelStreamTimeoutError) {
      return new BadGatewayException(error.message);
    }
    return new BadGatewayException('Model stream was interrupted. Please retry.');
  }

  private consumeStreamLine(
    line: string,
    toolCalls: Map<number, LlmToolCall>,
    onContentDelta: (delta: string) => void,
    onReasoningDelta: (delta: string) => void,
  ): boolean {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return false;

    const data = trimmed.slice(5).trim();
    if (!data) return false;
    if (data === '[DONE]') return true;

    const payload = this.safeJson(data);
    const choice = payload?.choices?.[0];
    const delta = this.asRecord(choice?.delta ?? choice?.message);
    const contentDelta = typeof delta?.content === 'string' ? delta.content : '';
    const reasoningDelta =
      typeof delta?.reasoning_content === 'string' ? delta.reasoning_content : '';
    if (contentDelta) {
      onContentDelta(contentDelta);
    }
    if (reasoningDelta) {
      onReasoningDelta(reasoningDelta);
    }

    if (Array.isArray(delta?.tool_calls)) {
      delta.tool_calls.forEach((toolCall: unknown, fallbackIndex: number) => {
        this.mergeToolCallDelta(toolCalls, toolCall, fallbackIndex);
      });
    }

    return false;
  }

  private mergeToolCallDelta(
    toolCalls: Map<number, LlmToolCall>,
    value: unknown,
    fallbackIndex: number,
  ): void {
    const delta = this.toToolCallDelta(value);
    if (!delta) return;

    const index = delta.index ?? fallbackIndex;
    const existing =
      toolCalls.get(index) ??
      ({
        id: delta.id ?? `tool-call-${index}`,
        type: 'function',
        function: {
          name: '',
          arguments: '',
        },
      } satisfies LlmToolCall);

    if (delta.id) {
      existing.id = delta.id;
    }
    if (delta.type) {
      existing.type = delta.type;
    }
    if (delta.function?.name) {
      existing.function.name += delta.function.name;
    }
    if (delta.function?.arguments) {
      existing.function.arguments += delta.function.arguments;
    }

    toolCalls.set(index, existing);
  }

  private streamResult(
    content: string,
    reasoningContent: string,
    toolCalls: Map<number, LlmToolCall>,
  ): LlmAssistantMessage {
    const toolCallList = [...toolCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, toolCall]) => toolCall)
      .filter((toolCall) => toolCall.function.name);

    return {
      content,
      reasoning_content: reasoningContent || undefined,
      tool_calls: toolCallList.length > 0 ? toolCallList : undefined,
    };
  }

  private safeJson(value: string): { choices?: Array<{ delta?: unknown; message?: unknown }> } | null {
    try {
      return JSON.parse(value) as { choices?: Array<{ delta?: unknown; message?: unknown }> };
    } catch {
      return null;
    }
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private toToolCallDelta(value: unknown): StreamToolCallDelta | null {
    const source = this.asRecord(value);
    if (!source) return null;
    const fn = this.asRecord(source.function);

    return {
      index: typeof source.index === 'number' ? source.index : undefined,
      id: typeof source.id === 'string' ? source.id : undefined,
      type: source.type === 'function' ? 'function' : undefined,
      function: fn
        ? {
            name: typeof fn.name === 'string' ? fn.name : undefined,
            arguments: typeof fn.arguments === 'string' ? fn.arguments : undefined,
          }
        : undefined,
    };
  }

  private async readErrorResponse(response: Response): Promise<string> {
    const fallback = `Model provider returned HTTP ${response.status}.`;
    const text = await response.text().catch(() => '');
    if (!text) {
      return fallback;
    }

    try {
      const payload = JSON.parse(text) as {
        error?: { message?: unknown; type?: unknown; code?: unknown };
        message?: unknown;
      };
      const message =
        this.toNonEmptyString(payload.error?.message) ?? this.toNonEmptyString(payload.message);
      const type = this.toNonEmptyString(payload.error?.type);
      const code =
        this.toNonEmptyString(payload.error?.code) ??
        (typeof payload.error?.code === 'number' ? String(payload.error.code) : undefined);

      if (!message && !type && !code) {
        return `${fallback} ${text}`.trim();
      }

      return [fallback, message, type ? `type=${type}` : undefined, code ? `code=${code}` : undefined]
        .filter((value): value is string => Boolean(value))
        .join(' ');
    } catch {
      return `${fallback} ${text}`.trim();
    }
  }

  private async readJsonResponse<T>(response: Response): Promise<T> {
    const text = await response.text().catch(() => '');
    if (!text) {
      throw new BadGatewayException('Model provider returned an empty response.');
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      const preview = text.slice(0, 200).trim();
      throw new BadGatewayException(
        preview
          ? `Model provider returned invalid JSON. ${preview}`
          : 'Model provider returned invalid JSON.',
      );
    }
  }

  private toNonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  }
}
