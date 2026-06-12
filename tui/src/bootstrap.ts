import { basename } from 'path';
import { ApiClient } from './api/client';
import { streamEvents } from './api/events';
import { loadConfig, saveConfig } from './config';
import { isLocalApiBase, normalizeTargetPath } from './runtime';
import type {
  Approval,
  CommandRunView,
  GitStatus,
  Message,
  ModelChoice,
  PlanBundle,
  Project,
  ProjectFile,
  Session,
  SseEvent,
  StreamStatus,
  SystemCapabilities,
  TuiConfig,
} from './types';

export interface WorkspaceState {
  config: TuiConfig;
  api: ApiClient;
  capabilities: SystemCapabilities;
  mode: 'local' | 'remote';
  targetPath: string;
  project: Project;
  projects: Project[];
  session: Session;
  sessions: Session[];
  modelChoices: ModelChoice[];
  messages: Message[];
  gitStatus: GitStatus | null;
  approvals: Approval[];
  plan: PlanBundle | null;
  commandRuns: CommandRunView[];
  currentFile: ProjectFile | null;
  events: Array<SseEvent & { time: string }>;
  streamStatus: StreamStatus;
  activity: string;
  turnActive: boolean;
  error: string;
}

const STREAM_TOKEN_FLUSH_MS = 50;

interface StartupSessionResult {
  session: Session;
  sessions: Session[];
  messages: Message[];
}

export async function bootstrapWorkspace(input: {
  apiBaseUrl: string;
  targetPath?: string;
  token?: string;
  persistApiBaseUrl?: boolean;
}): Promise<WorkspaceState> {
  const config = await loadConfig();
  const apiBaseUrl = input.apiBaseUrl;
  const token = input.token ?? config.accessToken;
  const api = new ApiClient(apiBaseUrl, token);
  const capabilities = await api.capabilities();
  if (!token) {
    throw new Error(`Not logged in. Run: mebius login --api ${apiBaseUrl}`);
  }
  await api.me();

  const localApi = isLocalApiBase(apiBaseUrl);
  const mode = localApi ? 'local' : 'remote';
  const targetPath = mode === 'local' ? await normalizeTargetPath(input.targetPath) : (input.targetPath ?? process.cwd());
  let projects = await api.listProjects();
  let project: Project | undefined;

  if (mode === 'local' && capabilities.localWorkspacesEnabled) {
    project = await api.createOrGetLocalProject(targetPath, basename(targetPath));
    projects = upsertProject(projects, project);
  } else if (mode === 'local') {
    project = chooseRecentProject(projects, config.recentProjectId);
    if (!project) {
      throw new Error('This backend does not support local workspaces and has no existing project to open.');
    }
  } else {
    project = chooseRecentProject(projects, config.recentProjectId);
    if (!project) {
      throw new Error(
        'Remote API mode cannot register this machine path. Create or select a project on the remote backend first.',
      );
    }
  }

  const sessionList = await api.listSessions(project.id);
  const startupSession = await resolveStartupSession({
    api,
    project,
    sessions: sessionList.items,
    recentSessionId: config.recentSessionId,
  });
  const { session, sessions, messages } = startupSession;
  const nextConfig = {
    ...config,
    apiBaseUrl: input.persistApiBaseUrl === false ? config.apiBaseUrl : apiBaseUrl,
    accessToken: token,
    recentProjectId: project.id,
    recentSessionId: session.id,
  };
  await saveConfig(nextConfig);

  const [gitStatus, approvals, plan, commandRuns, modelChoices] = await Promise.all([
    api.gitStatus(project.id).catch(() => null),
    api.pendingApprovals().catch(() => []),
    api.latestPlan(session.id).catch(() => null),
    api.commandRuns(session.id).catch(() => []),
    api.listModels(session.id).catch(() => []),
  ]);

  return {
    config: nextConfig,
    api,
    capabilities,
    mode,
    targetPath,
    project,
    projects,
    session,
    sessions,
    modelChoices,
    messages,
    gitStatus,
    approvals,
    plan,
    commandRuns,
    currentFile: null,
    events: [],
    streamStatus: { mode: 'idle' },
    activity: 'Ready',
    turnActive: false,
    error: '',
  };
}

export async function resolveStartupSession(input: {
  api: Pick<ApiClient, 'createSession' | 'listMessages'>;
  project: Project;
  sessions: Session[];
  recentSessionId?: string;
}): Promise<StartupSessionResult> {
  const selectedSession = chooseRecentSession(input.sessions, input.recentSessionId);
  if (!selectedSession) {
    const created = await input.api.createSession(input.project.id, { title: `TUI session for ${input.project.name}` });
    return { session: created, sessions: upsertSession(input.sessions, created), messages: [] };
  }

  const messages = await input.api.listMessages(selectedSession.id);
  if (messages.length === 0) {
    return { session: selectedSession, sessions: input.sessions, messages };
  }

  const reusable = await findEmptySession(input.api, input.sessions, selectedSession.id);
  if (reusable) {
    return { session: reusable.session, sessions: input.sessions, messages: reusable.messages };
  }

  const modelConfigId = selectedSession.activeModelConfig?.id;
  const created = await input.api.createSession(input.project.id, {
    title: `TUI session for ${input.project.name}`,
    ...(modelConfigId ? { modelConfigId } : {}),
  });
  return { session: created, sessions: upsertSession(input.sessions, created), messages: [] };
}

export function attachEventStream(input: {
  state: () => WorkspaceState;
  setState: (updater: (state: WorkspaceState) => WorkspaceState) => void;
  token: string;
  abortSignal: AbortSignal;
}): void {
  const api = input.state().api;
  const sessionId = input.state().session.id;
  let pendingTokenEvent: SseEvent | null = null;
  let pendingTokenDelta = '';
  let pendingTokenContent: string | undefined;
  let tokenFlushTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTokenFlushTimer = () => {
    if (!tokenFlushTimer) return;
    clearTimeout(tokenFlushTimer);
    tokenFlushTimer = null;
  };

  const flushPendingToken = () => {
    if (input.abortSignal.aborted || !pendingTokenEvent) return;
    clearTokenFlushTimer();
    const event: SseEvent = {
      ...pendingTokenEvent,
      data: {
        ...pendingTokenEvent.data,
        delta: pendingTokenDelta,
        ...(pendingTokenContent === undefined ? {} : { content: pendingTokenContent }),
      },
    };
    pendingTokenEvent = null;
    pendingTokenDelta = '';
    pendingTokenContent = undefined;
    input.setState((state) => reduceEvent(state, event));
  };

  const queueTokenEvent = (event: SseEvent) => {
    const content = typeof event.data.content === 'string' ? event.data.content : undefined;
    const delta = typeof event.data.delta === 'string' ? event.data.delta : '';
    if (content === undefined && !delta) {
      input.setState((state) => reduceEvent(state, event));
      return;
    }

    pendingTokenEvent = event;
    pendingTokenDelta += delta;
    if (content !== undefined) {
      pendingTokenContent = content;
    } else if (pendingTokenContent !== undefined) {
      pendingTokenContent += delta;
    }

    tokenFlushTimer ??= setTimeout(flushPendingToken, STREAM_TOKEN_FLUSH_MS);
  };

  input.abortSignal.addEventListener(
    'abort',
    () => {
      clearTokenFlushTimer();
      pendingTokenEvent = null;
      pendingTokenDelta = '';
      pendingTokenContent = undefined;
    },
    { once: true },
  );

  void streamEvents(api.eventUrl(sessionId, input.token), (event) => {
    if (event.type === 'token') {
      queueTokenEvent(event);
      return;
    }

    flushPendingToken();
    input.setState((state) => reduceEvent(state, event));
    if (shouldRefreshReviewData(event.type)) {
      void refreshReviewData(input.state()).then((updates) => {
        if (input.abortSignal.aborted) return;
        input.setState((state) => ({ ...state, ...updates }));
      });
    }
  }, input.abortSignal).then(() => {
    flushPendingToken();
    input.setState((state) => ({
      ...state,
      turnActive: false,
      streamStatus: { mode: 'idle' },
      activity: state.activity === 'Ready' ? state.activity : 'Ready',
    }));
  }).catch((error) => {
    if (input.abortSignal.aborted) return;
    flushPendingToken();
    input.setState((state) => ({
      ...state,
      error: error instanceof Error ? error.message : 'Event stream failed.',
    }));
  });
}

export async function refreshReviewData(state: WorkspaceState): Promise<Partial<WorkspaceState>> {
  const [approvals, plan, commandRuns, gitStatus, session, modelChoices] = await Promise.all([
    state.api.pendingApprovals().catch(() => state.approvals),
    state.api.latestPlan(state.session.id).catch(() => state.plan),
    state.api.commandRuns(state.session.id).catch(() => state.commandRuns),
    state.api.gitStatus(state.project.id).catch(() => state.gitStatus),
    state.api.getSession(state.session.id).catch(() => state.session),
    state.api.listModels(state.session.id).catch(() => state.modelChoices),
  ]);
  return { approvals, plan, commandRuns, gitStatus, session, modelChoices };
}

function shouldRefreshReviewData(eventType: string): boolean {
  return (
    eventType === 'tool_call_requested' ||
    eventType === 'tool_call_result' ||
    eventType === 'command_output' ||
    eventType === 'plan_updated'
  );
}

function reduceEvent(state: WorkspaceState, event: SseEvent): WorkspaceState {
  const events = [{ ...event, time: new Date().toLocaleTimeString() }, ...state.events].slice(0, 100);
  if (event.type === 'token') {
    const content = typeof event.data.content === 'string' ? event.data.content : undefined;
    const delta = typeof event.data.delta === 'string' ? event.data.delta : '';
    if (content === undefined && !delta) {
      return { ...state, events };
    }

    const updatedAt = new Date().toISOString();
    const hasStreamingMessage = state.messages.some((message) => message.streaming);
    const messages = hasStreamingMessage
      ? state.messages.map((message) => {
          if (!message.streaming) return message;
          return {
            ...message,
            content: content ?? `${message.content}${delta}`,
            streaming: true,
            updatedAt,
          };
        })
      : [
          ...state.messages,
          {
            id: `streaming-${Date.now()}`,
            role: 'assistant' as const,
            content: content ?? delta,
            createdAt: updatedAt,
            updatedAt,
            streaming: true,
          },
        ];

    return {
      ...state,
      events,
      messages,
      streamStatus: state.streamStatus.mode === 'fallback' ? state.streamStatus : { mode: 'streaming' },
      activity: 'Assistant responding',
      turnActive: true,
    };
  }

  if (event.type === 'stream_fallback') {
    const streamStatus = streamStatusFromEvent(event, 'fallback');
    return {
      ...state,
      events,
      streamStatus,
      activity: `streaming fallback${streamStatus.reason ? `: ${streamStatus.reason}` : ''}`,
      turnActive: true,
    };
  }

  if (event.type === 'stream_interrupted' || event.type === 'stream_error') {
    const mode = event.type === 'stream_interrupted' ? 'interrupted' : 'error';
    const streamStatus = streamStatusFromEvent(event, mode);
    const updatedAt = new Date().toISOString();
    const messages = state.messages.map((message) =>
      message.streaming
        ? {
            ...message,
            streaming: false,
            updatedAt,
          }
        : message,
    );
    return {
      ...state,
      events,
      messages,
      streamStatus,
      activity: `stream ${mode}${streamStatus.reason ? `: ${streamStatus.reason}` : ''}`,
      turnActive: false,
      error: streamStatus.message ?? state.error,
    };
  }

  if (event.type === 'message_created') {
    const role = typeof event.data.role === 'string' ? event.data.role : '';
    const id = typeof event.data.id === 'string' ? event.data.id : '';
    const content = typeof event.data.content === 'string' ? event.data.content : '';
    if (!id || !isMessageRole(role)) {
      return { ...state, events, activity: 'Ready' };
    }

    const now = new Date().toISOString();
    const messages = state.messages.filter((message) => {
      if (role === 'assistant' && message.streaming) return false;
      if (role === 'user' && message.id.startsWith('local-user-') && message.content === content) return false;
      return true;
    });
    messages.push({ id, role, content, createdAt: now, updatedAt: now });
    return {
      ...state,
      events,
      messages,
      streamStatus: state.streamStatus.mode === 'streaming' ? { mode: 'idle' } : state.streamStatus,
      activity: 'Ready',
    };
  }

  if (event.type === 'done') {
    const updatedAt = new Date().toISOString();
    const messages = state.messages.map((message) =>
      message.streaming
        ? {
            ...message,
            streaming: false,
            updatedAt,
          }
        : message,
    );
    return {
      ...state,
      events,
      messages,
      streamStatus: { mode: 'idle' },
      activity: 'Ready',
      turnActive: false,
    };
  }

  if (event.type === 'agent_status') {
    const status = typeof event.data.status === 'string' ? event.data.status : 'working';
    if (status === 'context_cleared' || status === 'context_compacted') {
      return {
        ...state,
        events,
        messages: [],
        streamStatus: { mode: 'idle' },
        activity: status === 'context_cleared' ? 'Context cleared' : 'Context compacted',
        turnActive: false,
      };
    }
    if (status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'session_deleted') {
      const updatedAt = new Date().toISOString();
      const messages = state.messages.map((message) =>
        message.streaming
          ? {
              ...message,
              streaming: false,
              updatedAt,
            }
          : message,
      );
      return {
        ...state,
        events,
        messages,
        streamStatus: { mode: 'idle' },
        activity: status === 'completed' ? 'Ready' : status,
        turnActive: false,
      };
    }
    const toolName = typeof event.data.toolName === 'string' ? ` - ${event.data.toolName}` : '';
    const command = typeof event.data.command === 'string' ? ` - ${event.data.command}` : '';
    return { ...state, events, activity: `${status}${toolName}${command}`, turnActive: true };
  }

  return { ...state, events };
}

function streamStatusFromEvent(
  event: SseEvent,
  mode: Extract<StreamStatus['mode'], 'fallback' | 'interrupted' | 'error'>,
): StreamStatus {
  return {
    mode,
    reason: stringField(event, 'reason'),
    provider: stringField(event, 'provider'),
    model: stringField(event, 'model'),
    message: stringField(event, 'message'),
  };
}

function stringField(event: SseEvent, key: string): string | undefined {
  const value = event.data[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isMessageRole(role: string): role is Message['role'] {
  return role === 'assistant' || role === 'user' || role === 'tool' || role === 'system';
}

function chooseRecentProject(projects: Project[], recentProjectId: string | undefined): Project | undefined {
  return projects.find((project) => project.id === recentProjectId) ?? projects[0];
}

function chooseRecentSession(sessions: Session[], recentSessionId: string | undefined): Session | undefined {
  return sessions.find((session) => session.id === recentSessionId) ?? sessions[0];
}

async function findEmptySession(
  api: Pick<ApiClient, 'listMessages'>,
  sessions: Session[],
  skippedSessionId: string,
): Promise<{ session: Session; messages: Message[] } | null> {
  for (const session of sessions) {
    if (session.id === skippedSessionId) continue;
    const messages = await api.listMessages(session.id);
    if (messages.length === 0) {
      return { session, messages };
    }
  }
  return null;
}

function upsertProject(projects: Project[], project: Project): Project[] {
  const existing = projects.some((item) => item.id === project.id);
  return existing ? projects.map((item) => (item.id === project.id ? project : item)) : [project, ...projects];
}

function upsertSession(sessions: Session[], session: Session): Session[] {
  const existing = sessions.some((item) => item.id === session.id);
  return existing ? sessions.map((item) => (item.id === session.id ? session : item)) : [session, ...sessions];
}
