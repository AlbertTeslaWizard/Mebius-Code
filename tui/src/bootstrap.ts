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
  activity: string;
  error: string;
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
  let session = sessionList.items.find((item) => item.id === config.recentSessionId) ?? sessionList.items[0];
  if (!session) {
    session = await api.createSession(project.id, { title: `TUI session for ${project.name}` });
  }
  const nextConfig = {
    ...config,
    apiBaseUrl: input.persistApiBaseUrl === false ? config.apiBaseUrl : apiBaseUrl,
    accessToken: token,
    recentProjectId: project.id,
    recentSessionId: session.id,
  };
  await saveConfig(nextConfig);

  const [messages, gitStatus, approvals, plan, commandRuns, modelChoices] = await Promise.all([
    api.listMessages(session.id),
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
    sessions: sessionList.items,
    modelChoices,
    messages,
    gitStatus,
    approvals,
    plan,
    commandRuns,
    currentFile: null,
    events: [],
    activity: 'Ready',
    error: '',
  };
}

export function attachEventStream(input: {
  state: () => WorkspaceState;
  setState: (updater: (state: WorkspaceState) => WorkspaceState) => void;
  token: string;
  abortSignal: AbortSignal;
}): void {
  const api = input.state().api;
  const sessionId = input.state().session.id;
  void streamEvents(api.eventUrl(sessionId, input.token), (event) => {
    input.setState((state) => reduceEvent(state, event));
  }, input.abortSignal).catch((error) => {
    if (input.abortSignal.aborted) return;
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

function reduceEvent(state: WorkspaceState, event: SseEvent): WorkspaceState {
  const events = [{ ...event, time: new Date().toLocaleTimeString() }, ...state.events].slice(0, 100);
  if (event.type === 'token') {
    const content = typeof event.data.content === 'string' ? event.data.content : undefined;
    const delta = typeof event.data.delta === 'string' ? event.data.delta : '';
    if (content === undefined && !delta) {
      return { ...state, events };
    }
    const messages = [...state.messages];
    const streaming = messages.find((message) => message.streaming);
    if (streaming) {
      streaming.content = content ?? `${streaming.content}${delta}`;
    } else {
      messages.push({
        id: `streaming-${Date.now()}`,
        role: 'assistant',
        content: content ?? delta,
        createdAt: new Date().toISOString(),
        streaming: true,
      });
    }
    return { ...state, events, messages, activity: 'Assistant responding' };
  }

  if (event.type === 'message_created') {
    const role = typeof event.data.role === 'string' ? event.data.role : '';
    const id = typeof event.data.id === 'string' ? event.data.id : '';
    const content = typeof event.data.content === 'string' ? event.data.content : '';
    if (!id || !isMessageRole(role)) {
      return { ...state, events, activity: 'Ready' };
    }

    const messages = state.messages.filter((message) => {
      if (role === 'assistant' && message.streaming) return false;
      if (role === 'user' && message.id.startsWith('local-user-') && message.content === content) return false;
      return true;
    });
    messages.push({ id, role, content, createdAt: new Date().toISOString() });
    return { ...state, events, messages, activity: 'Ready' };
  }

  if (event.type === 'agent_status') {
    const status = typeof event.data.status === 'string' ? event.data.status : 'working';
    if (status === 'context_cleared' || status === 'context_compacted') {
      return {
        ...state,
        events,
        messages: [],
        activity: status === 'context_cleared' ? 'Context cleared' : 'Context compacted',
      };
    }
    const toolName = typeof event.data.toolName === 'string' ? ` · ${event.data.toolName}` : '';
    const command = typeof event.data.command === 'string' ? ` · ${event.data.command}` : '';
    return { ...state, events, activity: `${status}${toolName}${command}` };
  }

  return { ...state, events };
}

function isMessageRole(role: string): role is Message['role'] {
  return role === 'assistant' || role === 'user' || role === 'tool' || role === 'system';
}

function chooseRecentProject(projects: Project[], recentProjectId: string | undefined): Project | undefined {
  return projects.find((project) => project.id === recentProjectId) ?? projects[0];
}

function upsertProject(projects: Project[], project: Project): Project[] {
  const existing = projects.some((item) => item.id === project.id);
  return existing ? projects.map((item) => (item.id === project.id ? project : item)) : [project, ...projects];
}
