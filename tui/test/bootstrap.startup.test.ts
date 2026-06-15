import { describe, expect, it } from 'bun:test';
import { resolveStartupSession, shouldReloadMessagesAfterEvent } from '../src/bootstrap';
import type { Message, ModelConfig, Project, Session } from '../src/types';

type StartupApi = Parameters<typeof resolveStartupSession>[0]['api'];

const now = '2026-06-12T00:00:00.000Z';

describe('startup session selection', () => {
  it('creates an empty session when the project has no sessions', async () => {
    const project = projectFixture();
    const created = sessionFixture('created', { title: 'TUI session for Demo' });
    const api = createStartupApi({}, created);

    const result = await resolveStartupSession({
      api: api.client,
      project,
      sessions: [],
      recentSessionId: 'missing',
    });

    expect(result.session.id).toBe('created');
    expect(result.messages).toEqual([]);
    expect(result.sessions.map((session) => session.id)).toEqual(['created']);
    expect(api.listMessageCalls).toEqual([]);
    expect(api.createCalls).toEqual([
      { projectId: 'project-1', input: { title: 'TUI session for Demo' } },
    ]);
  });

  it('reuses the recent session when it has no messages', async () => {
    const recent = sessionFixture('recent');
    const older = sessionFixture('older');
    const api = createStartupApi({ recent: [] });

    const result = await resolveStartupSession({
      api: api.client,
      project: projectFixture(),
      sessions: [recent, older],
      recentSessionId: 'recent',
    });

    expect(result.session).toBe(recent);
    expect(result.messages).toEqual([]);
    expect(result.sessions).toEqual([recent, older]);
    expect(api.listMessageCalls).toEqual(['recent']);
    expect(api.createCalls).toEqual([]);
  });

  it('uses the latest session when the stored recent session is unavailable', async () => {
    const latest = sessionFixture('latest');
    const api = createStartupApi({ latest: [] });

    const result = await resolveStartupSession({
      api: api.client,
      project: projectFixture(),
      sessions: [latest],
      recentSessionId: 'missing',
    });

    expect(result.session).toBe(latest);
    expect(api.listMessageCalls).toEqual(['latest']);
    expect(api.createCalls).toEqual([]);
  });

  it('reuses an existing empty session before creating a new one', async () => {
    const previous = sessionFixture('previous', { activeModelConfig: modelConfigFixture('model-1') });
    const empty = sessionFixture('empty');
    const older = sessionFixture('older');
    const api = createStartupApi({ previous: [messageFixture('message-1')], empty: [] });

    const result = await resolveStartupSession({
      api: api.client,
      project: projectFixture(),
      sessions: [previous, empty, older],
      recentSessionId: 'previous',
    });

    expect(result.session).toBe(empty);
    expect(result.messages).toEqual([]);
    expect(result.sessions).toEqual([previous, empty, older]);
    expect(api.listMessageCalls).toEqual(['previous', 'empty']);
    expect(api.createCalls).toEqual([]);
  });

  it('creates a new session when all listed sessions have messages and inherits the active model', async () => {
    const previous = sessionFixture('previous', { activeModelConfig: modelConfigFixture('model-1') });
    const older = sessionFixture('older');
    const created = sessionFixture('created', { activeModelConfig: modelConfigFixture('model-1') });
    const api = createStartupApi(
      { previous: [messageFixture('message-1')], older: [messageFixture('message-2')] },
      created,
    );

    const result = await resolveStartupSession({
      api: api.client,
      project: projectFixture(),
      sessions: [previous, older],
      recentSessionId: 'previous',
    });

    expect(result.session.id).toBe('created');
    expect(result.messages).toEqual([]);
    expect(result.sessions.map((session) => session.id)).toEqual(['created', 'previous', 'older']);
    expect(api.listMessageCalls).toEqual(['previous', 'older']);
    expect(api.createCalls).toEqual([
      {
        projectId: 'project-1',
        input: { title: 'TUI session for Demo', modelConfigId: 'model-1' },
      },
    ]);
  });
});

describe('event transcript reloads', () => {
  it('reloads persisted messages after turn completion and turn history changes', () => {
    expect(shouldReloadMessagesAfterEvent('done')).toBe(true);
    expect(shouldReloadMessagesAfterEvent('turn_undone')).toBe(true);
    expect(shouldReloadMessagesAfterEvent('turn_redone')).toBe(true);
    expect(shouldReloadMessagesAfterEvent('tool_call_result')).toBe(false);
    expect(shouldReloadMessagesAfterEvent('message_created')).toBe(false);
  });
});

function createStartupApi(messagesBySession: Record<string, Message[]>, createdSession?: Session): {
  client: StartupApi;
  createCalls: Array<{ projectId: string; input: { title?: string; modelConfigId?: string } }>;
  listMessageCalls: string[];
} {
  const createCalls: Array<{ projectId: string; input: { title?: string; modelConfigId?: string } }> = [];
  const listMessageCalls: string[] = [];
  return {
    createCalls,
    listMessageCalls,
    client: {
      async createSession(projectId, input = {}) {
        createCalls.push({ projectId, input });
        return (
          createdSession ??
          sessionFixture('created', {
            title: input.title ?? 'Created session',
            activeModelConfig: input.modelConfigId ? modelConfigFixture(input.modelConfigId) : null,
          })
        );
      },
      async listMessages(sessionId) {
        listMessageCalls.push(sessionId);
        return messagesBySession[sessionId] ?? [];
      },
    },
  };
}

function projectFixture(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Demo',
    sourceType: 'local',
    workspacePath: 'D:/demo',
    ...overrides,
  };
}

function sessionFixture(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    projectId: 'project-1',
    title: `Session ${id}`,
    status: 'active',
    permissionMode: 'ask_first',
    activeModelConfig: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function modelConfigFixture(id: string): ModelConfig {
  return {
    id,
    providerId: 'deepseek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.example.com',
    modelName: 'deepseek-v4-flash',
    supportsTools: true,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  };
}

function messageFixture(id: string): Message {
  return {
    id,
    role: 'user',
    content: 'Continue the previous task',
    createdAt: now,
  };
}
