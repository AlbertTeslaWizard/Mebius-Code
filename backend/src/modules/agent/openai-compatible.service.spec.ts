import { RuntimeModelConfig } from '../model-configs/model-configs.service';
import { OpenAiCompatibleService } from './openai-compatible.service';

describe('OpenAiCompatibleService', () => {
  const originalFetch = global.fetch;
  const service = new OpenAiCompatibleService();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('streams content deltas and returns the accumulated assistant message', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      body: streamFrom([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const tokens: Array<{ delta: string; content: string }> = [];

    const result = await service.streamChat(baseInput(), (event) => tokens.push(event));

    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({
      model: 'gpt-test',
      stream: true,
    });
    expect(tokens).toEqual([
      { delta: 'Hel', content: 'Hel' },
      { delta: 'lo', content: 'Hello' },
    ]);
    expect(result).toEqual({
      content: 'Hello',
      reasoning_content: undefined,
      tool_calls: undefined,
    });
  });

  it('merges streamed reasoning and tool call deltas by index', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      body: streamFrom([
        'data: {"choices":[{"delta":{"reasoning_content":"Need file context. ","tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"create_patch","arguments":"{\\"path\\""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"src/app.ts\\"}"}}]}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await service.streamChat(baseInput(), jest.fn());

    expect(result).toEqual({
      content: '',
      reasoning_content: 'Need file context. ',
      tool_calls: [
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'create_patch',
            arguments: '{"path":"src/app.ts"}',
          },
        },
      ],
    });
  });

  it('falls back to non-streaming chat and emits one token event when a provider rejects streaming', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              choices: [{ message: { content: 'fallback response' } }],
            }),
          ),
      });
    global.fetch = fetchMock as unknown as typeof fetch;
    const onToken = jest.fn();

    const result = await service.streamChat(baseInput(), onToken);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onToken).toHaveBeenCalledWith({
      delta: 'fallback response',
      content: 'fallback response',
    });
    expect(result).toEqual({ content: 'fallback response' });
  });

  it('falls back to non-streaming chat and emits one token event when stream body is missing', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, body: null })
      .mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              choices: [{ message: { content: 'body fallback' } }],
            }),
          ),
      });
    global.fetch = fetchMock as unknown as typeof fetch;
    const onToken = jest.fn();

    const result = await service.streamChat(baseInput(), onToken);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onToken).toHaveBeenCalledWith({
      delta: 'body fallback',
      content: 'body fallback',
    });
    expect(result).toEqual({ content: 'body fallback' });
  });

  it('includes provider error details in non-streaming failures', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            error: {
              message: 'reasoning_content is required for tool continuation',
              type: 'invalid_request_error',
              code: 'missing_reasoning_content',
            },
          }),
        ),
    }) as unknown as typeof fetch;

    await expect(service.chat(baseInput())).rejects.toThrow(
      'Model provider returned HTTP 400. reasoning_content is required for tool continuation type=invalid_request_error code=missing_reasoning_content',
    );
  });

  it('reports an empty non-streaming response without leaking a JSON syntax error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    }) as unknown as typeof fetch;

    await expect(service.chat(baseInput())).rejects.toThrow(
      'Model provider returned an empty response.',
    );
  });

  it('reports invalid non-streaming JSON without leaking a JSON syntax error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('not json'),
    }) as unknown as typeof fetch;

    await expect(service.chat(baseInput())).rejects.toThrow(
      'Model provider returned invalid JSON. not json',
    );
  });

  it('falls back to non-streaming chat when a streamed response is interrupted before content starts', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        body: interruptedStream(new TypeError('terminated')),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              choices: [{ message: { content: 'fallback after interrupt' } }],
            }),
          ),
      });
    global.fetch = fetchMock as unknown as typeof fetch;
    const onToken = jest.fn();
    const onStreamFallback = jest.fn();

    const result = await service.streamChat(baseInput(), onToken, { onStreamFallback });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onStreamFallback).toHaveBeenCalledWith({ reason: 'interrupted' });
    expect(onToken).toHaveBeenCalledWith({
      delta: 'fallback after interrupt',
      content: 'fallback after interrupt',
    });
    expect(result).toEqual({ content: 'fallback after interrupt' });
  });

  it('reports interruption without non-streaming fallback after content starts', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        body: streamFromThenError(
          ['data: {"choices":[{"delta":{"content":"I will write the file now."}}]}\n\n'],
          new TypeError('terminated'),
        ),
      });
    global.fetch = fetchMock as unknown as typeof fetch;
    const onToken = jest.fn();
    const onStreamInterrupted = jest.fn();

    await expect(
      service.streamChat(baseInput(), onToken, { onStreamInterrupted }),
    ).rejects.toThrow('Model stream was interrupted. Please retry.');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onToken).toHaveBeenNthCalledWith(1, {
      delta: 'I will write the file now.',
      content: 'I will write the file now.',
    });
    expect(onStreamInterrupted).toHaveBeenCalledWith({
      reason: 'interrupted',
      message: 'Model stream was interrupted. Please retry.',
    });
  });

  it('falls back to non-streaming chat when a stream stops producing chunks', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        body: stalledStream(),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              choices: [{ message: { content: 'fallback after timeout' } }],
            }),
          ),
      });
    global.fetch = fetchMock as unknown as typeof fetch;
    const onStreamFallback = jest.fn();

    const result = await service.streamChat(baseInput(), jest.fn(), {
      idleTimeoutMs: 1,
      onStreamFallback,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onStreamFallback).toHaveBeenCalledWith({ reason: 'timeout' });
    expect(result).toEqual({ content: 'fallback after timeout' });
  });
});

function baseInput(): Parameters<OpenAiCompatibleService['chat']>[0] {
  return {
    config: {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      modelName: 'gpt-test',
      supportsTools: true,
    } as RuntimeModelConfig,
    messages: [{ role: 'user', content: 'Hello' }],
    tools: [{ type: 'function', function: { name: 'create_patch' } }],
  };
}

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

function interruptedStream(error: Error): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    pull() {
      throw error;
    },
  });
}

function streamFromThenError(chunks: string[], error: Error): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index += 1;
        return;
      }
      throw error;
    },
  });
}

function stalledStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    pull() {
      return new Promise<void>(() => undefined);
    },
  });
}
