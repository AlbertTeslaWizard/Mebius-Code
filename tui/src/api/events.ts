import type { SseEvent } from '../types';

export async function streamEvents(
  url: string,
  onEvent: (event: SseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) {
    throw new Error(`Event stream failed with HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = 'message';
  let eventData = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line) {
        if (eventData) {
          onEvent({
            type: eventName,
            data: safeJson(eventData),
          });
        }
        eventName = 'message';
        eventData = '';
        continue;
      }
      if (line.startsWith('event:')) {
        eventName = line.slice('event:'.length).trim();
      }
      if (line.startsWith('data:')) {
        eventData += line.slice('data:'.length).trim();
      }
    }
  }
}

function safeJson(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return { value };
  }
}
