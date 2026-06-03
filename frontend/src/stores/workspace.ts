import { defineStore } from 'pinia';
import { apiUrl, getAccessToken, jsonBody, request } from '../api/http';
import type {
  ConnectResult,
  FilePatch,
  GitActionResult,
  GitCommitResult,
  GitPushResult,
  GitStatus,
  ListResponse,
  Message,
  ModelConfig,
  Plan,
  PlanBundle,
  PlanStep,
  Project,
  ProjectFile,
  Session,
  SsePayload,
  TreeNode,
} from '../api/types';
import { useLocaleStore } from './locale';

type AgentActivityStatus = 'thinking' | 'using_tools' | 'waiting_for_approval' | 'failed';
type GitImportStatus = 'idle' | 'running' | 'success' | 'error';
type GitPublishStatus = 'idle' | 'running' | 'success' | 'error';

export interface AgentActivity {
  status: AgentActivityStatus;
  toolName?: string;
  message?: string;
}

interface WorkspaceState {
  projects: Project[];
  sessions: Session[];
  modelConfigs: ModelConfig[];
  messages: Message[];
  fileTree: TreeNode[];
  currentFile: ProjectFile | null;
  currentProject: Project | null;
  currentSession: Session | null;
  eventLog: Array<{ type: string; data: SsePayload; time: string }>;
  activePlan: { plan: Plan; steps: PlanStep[] } | null;
  filePatches: FilePatch[];
  loading: boolean;
  eventStatus: 'idle' | 'connecting' | 'open' | 'closed';
  eventSource: EventSource | null;
  streamingAssistantId: string | null;
  agentActivity: AgentActivity | null;
  gitImportStatus: GitImportStatus;
  gitImportError: string;
  gitStatus: GitStatus | null;
  gitStatusLoading: boolean;
  gitStatusError: string;
  gitPublishStatus: GitPublishStatus;
  gitPublishMessage: string;
}

export const useWorkspaceStore = defineStore('workspace', {
  state: (): WorkspaceState => ({
    projects: [],
    sessions: [],
    modelConfigs: [],
    messages: [],
    fileTree: [],
    currentFile: null,
    currentProject: null,
    currentSession: null,
    eventLog: [],
    activePlan: null,
    filePatches: [],
    loading: false,
    eventStatus: 'idle',
    eventSource: null,
    streamingAssistantId: null,
    agentActivity: null,
    gitImportStatus: 'idle',
    gitImportError: '',
    gitStatus: null,
    gitStatusLoading: false,
    gitStatusError: '',
    gitPublishStatus: 'idle',
    gitPublishMessage: '',
  }),
  actions: {
    async bootstrap() {
      await Promise.all([this.loadProjects(), this.loadModelConfigs()]);
      if (this.projects[0]) {
        await this.selectProject(this.projects[0]);
      }
    },
    async loadProjects() {
      this.projects = await request<Project[]>('/projects');
    },
    async loadModelConfigs() {
      this.modelConfigs = await request<ModelConfig[]>('/model-configs');
    },
    async createProject(input: { name: string; description?: string }) {
      const project = await request<Project>('/projects', {
        method: 'POST',
        body: jsonBody(input),
      });
      await this.loadProjects();
      await this.selectProject(project);
    },
    async deleteProject(projectId: string) {
      const wasCurrent = this.currentProject?.id === projectId;
      await request<{ deleted: true }>(`/projects/${projectId}`, { method: 'DELETE' });
      await this.loadProjects();

      if (!wasCurrent) return;

      this.disconnectEvents();
      this.currentProject = null;
      this.currentSession = null;
      this.currentFile = null;
      this.sessions = [];
      this.messages = [];
      this.fileTree = [];
      this.activePlan = null;
      this.filePatches = [];
      this.streamingAssistantId = null;
      this.agentActivity = null;
      this.gitStatus = null;
      this.gitStatusError = '';
      this.resetGitPublishState();

      if (this.projects[0]) {
        await this.selectProject(this.projects[0]);
      }
    },
    async importGit(input: { gitUrl: string; branch?: string }) {
      if (!this.currentProject) return;
      this.gitImportStatus = 'running';
      this.gitImportError = '';
      try {
        const project = await request<Project>(`/projects/${this.currentProject.id}/import/git`, {
          method: 'POST',
          body: jsonBody(input),
        });
        this.currentProject = project;
        await Promise.all([this.loadTree(), this.loadGitStatus()]);
        this.gitImportStatus = 'success';
        window.setTimeout(() => {
          if (this.gitImportStatus === 'success') {
            this.resetGitImportStatus();
          }
        }, 4000);
      } catch (error) {
        this.gitImportStatus = 'error';
        this.gitImportError = error instanceof Error ? error.message : 'Git import failed.';
        throw error;
      }
    },
    resetGitImportStatus() {
      this.gitImportStatus = 'idle';
      this.gitImportError = '';
    },
    async selectProject(project: Project) {
      this.currentProject = project;
      this.currentFile = null;
      this.resetGitImportStatus();
      this.resetGitPublishState();
      await Promise.all([this.loadSessions(), this.loadTree(), this.loadGitStatus()]);
      if (this.sessions[0]) {
        await this.selectSession(this.sessions[0]);
      } else {
        this.currentSession = null;
        this.messages = [];
        this.activePlan = null;
        this.filePatches = [];
        this.streamingAssistantId = null;
        this.agentActivity = null;
        this.disconnectEvents();
      }
    },
    async loadGitStatus() {
      if (!this.currentProject) {
        this.gitStatus = null;
        this.gitStatusError = '';
        return null;
      }
      this.gitStatusLoading = true;
      this.gitStatusError = '';
      try {
        const status = await request<GitStatus>(`/projects/${this.currentProject.id}/git/status`);
        this.gitStatus = status;
        return status;
      } catch (error) {
        this.gitStatus = null;
        this.gitStatusError = error instanceof Error ? error.message : 'Git status failed.';
        throw error;
      } finally {
        this.gitStatusLoading = false;
      }
    },
    resetGitPublishState() {
      this.gitPublishStatus = 'idle';
      this.gitPublishMessage = '';
    },
    async commitGit(message: string) {
      if (!this.currentProject) return null;
      this.gitPublishStatus = 'running';
      this.gitPublishMessage = '';
      try {
        const result = await request<GitCommitResult>(`/projects/${this.currentProject.id}/git/commit`, {
          method: 'POST',
          body: jsonBody({ message }),
        });
        this.gitPublishStatus = 'success';
        this.gitPublishMessage = result.summary;
        await this.loadGitStatus();
        return result;
      } catch (error) {
        this.gitPublishStatus = 'error';
        this.gitPublishMessage = error instanceof Error ? error.message : 'Git commit failed.';
        throw error;
      }
    },
    async stageGitFile(path: string) {
      if (!this.currentProject) return null;
      this.gitPublishStatus = 'running';
      this.gitPublishMessage = '';
      try {
        const result = await request<GitActionResult>(`/projects/${this.currentProject.id}/git/stage`, {
          method: 'POST',
          body: jsonBody({ path }),
        });
        this.gitPublishStatus = 'success';
        this.gitPublishMessage = result.summary;
        await this.loadGitStatus();
        return result;
      } catch (error) {
        this.gitPublishStatus = 'error';
        this.gitPublishMessage = error instanceof Error ? error.message : 'Git stage failed.';
        throw error;
      }
    },
    async unstageGitFile(path: string) {
      if (!this.currentProject) return null;
      this.gitPublishStatus = 'running';
      this.gitPublishMessage = '';
      try {
        const result = await request<GitActionResult>(
          `/projects/${this.currentProject.id}/git/unstage`,
          {
            method: 'POST',
            body: jsonBody({ path }),
          },
        );
        this.gitPublishStatus = 'success';
        this.gitPublishMessage = result.summary;
        await this.loadGitStatus();
        return result;
      } catch (error) {
        this.gitPublishStatus = 'error';
        this.gitPublishMessage = error instanceof Error ? error.message : 'Git unstage failed.';
        throw error;
      }
    },
    async stageAllGit() {
      if (!this.currentProject) return null;
      this.gitPublishStatus = 'running';
      this.gitPublishMessage = '';
      try {
        const result = await request<GitActionResult>(`/projects/${this.currentProject.id}/git/stage-all`, {
          method: 'POST',
        });
        this.gitPublishStatus = 'success';
        this.gitPublishMessage = result.summary;
        await this.loadGitStatus();
        return result;
      } catch (error) {
        this.gitPublishStatus = 'error';
        this.gitPublishMessage = error instanceof Error ? error.message : 'Git stage failed.';
        throw error;
      }
    },
    async unstageAllGit() {
      if (!this.currentProject) return null;
      this.gitPublishStatus = 'running';
      this.gitPublishMessage = '';
      try {
        const result = await request<GitActionResult>(
          `/projects/${this.currentProject.id}/git/unstage-all`,
          {
            method: 'POST',
          },
        );
        this.gitPublishStatus = 'success';
        this.gitPublishMessage = result.summary;
        await this.loadGitStatus();
        return result;
      } catch (error) {
        this.gitPublishStatus = 'error';
        this.gitPublishMessage = error instanceof Error ? error.message : 'Git unstage failed.';
        throw error;
      }
    },
    async pushGit() {
      if (!this.currentProject) return null;
      this.gitPublishStatus = 'running';
      this.gitPublishMessage = '';
      try {
        const result = await request<GitPushResult>(`/projects/${this.currentProject.id}/git/push`, {
          method: 'POST',
        });
        this.gitPublishStatus = 'success';
        this.gitPublishMessage = result.summary;
        await this.loadGitStatus();
        return result;
      } catch (error) {
        this.gitPublishStatus = 'error';
        this.gitPublishMessage = error instanceof Error ? error.message : 'Git push failed.';
        throw error;
      }
    },
    async loadSessions() {
      if (!this.currentProject) return;
      const response = await request<ListResponse<Session>>(
        `/projects/${this.currentProject.id}/sessions`,
      );
      this.sessions = response.items;
    },
    async createSession(title?: string) {
      if (!this.currentProject) return;
      const session = await request<Session>(`/projects/${this.currentProject.id}/sessions`, {
        method: 'POST',
        body: jsonBody({ title }),
      });
      await this.loadSessions();
      await this.selectSession(session);
    },
    async deleteSession(sessionId: string) {
      const wasCurrent = this.currentSession?.id === sessionId;
      await request<{ deleted: true }>(`/sessions/${sessionId}`, { method: 'DELETE' });
      await this.loadSessions();

      if (!wasCurrent) return;

      this.disconnectEvents();
      this.currentSession = null;
      this.messages = [];
      this.activePlan = null;
      this.filePatches = [];
      this.streamingAssistantId = null;
      this.agentActivity = null;

      if (this.sessions[0]) {
        await this.selectSession(this.sessions[0]);
      }
    },
    async selectSession(session: Session) {
      this.streamingAssistantId = null;
      this.agentActivity = null;
      this.currentSession = await request<Session>(`/sessions/${session.id}`);
      this.agentActivity = this.currentSession.agentActivity ?? null;
      await this.loadMessages();
      await this.refreshReviewData();
      this.connectEvents();
    },
    async switchSessionModel(modelConfigId: string) {
      if (!this.currentSession) return null;
      const session = await request<Session>(`/sessions/${this.currentSession.id}/commands`, {
        method: 'POST',
        body: jsonBody({ command: '/model', args: { modelConfigId } }),
      });
      this.currentSession = session;
      this.sessions = this.sessions.map((item) => (item.id === session.id ? session : item));
      return session;
    },
    async loadMessages() {
      if (!this.currentSession) return;
      this.messages = await request<Message[]>(`/sessions/${this.currentSession.id}/messages`);
    },
    async submitText(content: string) {
      if (!this.currentSession || !content.trim()) return;
      const trimmed = content.trim();
      if (this.agentActivity?.status === 'waiting_for_approval') {
        const locale = useLocaleStore();
        throw new Error(locale.t('pendingApprovalBeforeChat'));
      }
      if (trimmed.startsWith('/')) {
        const result = await request<unknown>(`/sessions/${this.currentSession.id}/commands`, {
          method: 'POST',
          body: jsonBody({ command: trimmed }),
        });
        this.eventLog.unshift({
          type: 'command_result',
          data: result as SsePayload,
          time: new Date().toISOString(),
        });
        return result;
      }
      this.agentActivity = { status: 'thinking' };
      try {
        await request(`/sessions/${this.currentSession.id}/run`, {
          method: 'POST',
          body: jsonBody({ message: trimmed }),
        });
        await this.loadMessages();
      } catch (error) {
        this.agentActivity = {
          status: 'failed',
          message: error instanceof Error ? error.message : 'Agent run failed.',
        };
        throw error;
      }
    },
    async createPlan(goal: string) {
      if (!this.currentSession || !goal.trim()) return;
      this.activePlan = await request<PlanBundle>(
        `/sessions/${this.currentSession.id}/plan`,
        {
          method: 'POST',
          body: jsonBody({ goal }),
        },
      );
    },
    async approvePlan() {
      if (!this.activePlan) return;
      const plan = await request<Plan>(`/plans/${this.activePlan.plan.id}/approve`, {
        method: 'POST',
      });
      this.activePlan = { ...this.activePlan, plan };
    },
    async loadLatestPlan() {
      if (!this.currentSession) {
        this.activePlan = null;
        return null;
      }
      this.activePlan = await request<PlanBundle | null>(
        `/sessions/${this.currentSession.id}/plans/latest`,
      );
      return this.activePlan;
    },
    async loadPatches() {
      if (!this.currentSession) {
        this.filePatches = [];
        return [];
      }
      this.filePatches = await request<FilePatch[]>(`/sessions/${this.currentSession.id}/patches`);
      return this.filePatches;
    },
    async refreshReviewData() {
      await Promise.all([this.loadLatestPlan(), this.loadPatches()]);
    },
    async loadTree(path = '.', depth = 3) {
      if (!this.currentProject) return;
      this.fileTree = await request<TreeNode[]>(
        `/projects/${this.currentProject.id}/tree?path=${encodeURIComponent(path)}&depth=${depth}`,
      );
    },
    async loadFile(path: string) {
      if (!this.currentProject) return;
      this.currentFile = await request<ProjectFile>(
        `/projects/${this.currentProject.id}/file?path=${encodeURIComponent(path)}`,
      );
    },
    async searchConnectProviders(query: string) {
      if (!this.currentSession) return null;
      return request<ConnectResult>(`/sessions/${this.currentSession.id}/commands`, {
        method: 'POST',
        body: jsonBody({ command: query ? `/connect ${query}` : '/connect' }),
      });
    },
    async connectProvider(input: {
      providerId: string;
      apiKey?: string;
      modelName?: string;
      displayName?: string;
      baseUrl?: string;
    }) {
      if (!this.currentSession) return null;
      const result = await request<ConnectResult>(`/sessions/${this.currentSession.id}/commands`, {
        method: 'POST',
        body: jsonBody({ command: '/connect', args: input }),
      });
      if (result.type === 'connect.connected') {
        this.currentSession = result.session;
        await Promise.all([this.loadSessions(), this.loadModelConfigs()]);
      }
      return result;
    },
    connectEvents() {
      this.disconnectEvents();
      if (!this.currentSession) return;
      const token = getAccessToken();
      if (!token) return;

      this.eventStatus = 'connecting';
      const source = new EventSource(
        `${apiUrl(`/sessions/${this.currentSession.id}/events`)}?access_token=${encodeURIComponent(token)}`,
      );
      this.eventSource = source;
      source.onopen = () => {
        this.eventStatus = 'open';
      };
      source.onerror = () => {
        this.eventStatus = 'closed';
      };

      [
        'agent_status',
        'message_created',
        'token',
        'plan_updated',
        'tool_call_requested',
        'tool_call_result',
        'patch_created',
        'command_output',
        'done',
      ].forEach((type) => {
        source.addEventListener(type, (event) => {
          const data = safeJson((event as MessageEvent).data);
          if (type !== 'token') {
            this.eventLog.unshift({ type, data, time: new Date().toISOString() });
          }
          if (type === 'token') {
            this.handleTokenEvent(data);
            return;
          }
          if (type === 'agent_status') {
            this.handleAgentStatus(data);
            return;
          }
          if (type === 'plan_updated') {
            void this.loadLatestPlan();
            return;
          }
          if (type === 'message_created') {
            this.handleMessageCreated(data);
            return;
          }
          if (type === 'tool_call_requested') {
            void this.refreshReviewData();
            if (this.agentActivity?.status !== 'waiting_for_approval') {
              this.agentActivity = {
                status: 'waiting_for_approval',
                toolName: typeof data.name === 'string' ? data.name : undefined,
              };
            }
            return;
          }
          if (type === 'tool_call_result' || type === 'command_output' || type === 'patch_created') {
            const toolName =
              typeof data.name === 'string'
                ? data.name
                : this.agentActivity?.status === 'using_tools'
                  ? this.agentActivity.toolName
                  : undefined;
            if (toolName && this.agentActivity?.status !== 'failed') {
              this.agentActivity = {
                status: 'using_tools',
                toolName,
              };
            }
            if (type === 'patch_created') {
              void Promise.all([this.loadPatches(), this.loadTree(), this.loadGitStatus()]);
            }
            return;
          }
          if (type === 'done') {
            const streamingMessage = this.getStreamingAssistantMessage();
            void this.loadMessages()
              .then(() => {
                if (streamingMessage && !this.hasAssistantMessageContent(streamingMessage.content)) {
                  this.messages.push({
                    ...streamingMessage,
                    streaming: false,
                    metadata: {
                      ...streamingMessage.metadata,
                      restoredFromStreaming: true,
                    },
                  });
                }
                this.streamingAssistantId = null;
                this.agentActivity = null;
              })
              .catch(() => {
                if (
                  streamingMessage &&
                  !this.messages.some((message) => message.id === streamingMessage.id)
                ) {
                  this.messages.push(streamingMessage);
                }
              });
          }
        });
      });
    },
    handleAgentStatus(data: SsePayload) {
      const status = typeof data.status === 'string' ? data.status : '';
      if (status === 'thinking') {
        this.agentActivity = { status: 'thinking' };
        return;
      }
      if (status === 'using_tools') {
        const tools = Array.isArray(data.tools)
          ? data.tools.filter((item): item is string => typeof item === 'string')
          : [];
        this.agentActivity = {
          status: 'using_tools',
          toolName: typeof data.toolName === 'string' ? data.toolName : tools[0],
        };
        return;
      }
      if (status === 'waiting_for_approval') {
        this.agentActivity = {
          status: 'waiting_for_approval',
          toolName: typeof data.toolName === 'string' ? data.toolName : undefined,
        };
        return;
      }
      if (status === 'failed') {
        this.agentActivity = {
          status: 'failed',
          message: typeof data.message === 'string' ? data.message : undefined,
        };
        return;
      }
      if (status === 'completed') {
        this.agentActivity = null;
      }
    },
    handleTokenEvent(data: SsePayload) {
      this.agentActivity = null;
      const content = typeof data.content === 'string' ? data.content : undefined;
      const delta = typeof data.delta === 'string' ? data.delta : '';
      if (content === undefined && !delta) return;

      const existing = this.streamingAssistantId
        ? this.messages.find((message) => message.id === this.streamingAssistantId)
        : undefined;
      const nextContent = content ?? `${existing?.content ?? ''}${delta}`;

      if (existing) {
        existing.content = nextContent;
        return;
      }

      const id = `streaming-assistant-${Date.now()}`;
      this.streamingAssistantId = id;
      this.messages.push({
        id,
        role: 'assistant',
        content: nextContent,
        metadata: { streaming: true },
        createdAt: new Date().toISOString(),
        streaming: true,
      });
    },
    handleMessageCreated(data: SsePayload) {
      const role = typeof data.role === 'string' ? data.role : '';
      if (role !== 'assistant') {
        this.upsertEventMessage(data);
        return;
      }
      this.promoteStreamingAssistant(data);
      void this.loadMessages().then(() => {
        if (role === 'assistant') {
          this.streamingAssistantId = null;
          this.agentActivity = null;
        }
      });
    },
    upsertEventMessage(data: SsePayload) {
      const id = typeof data.id === 'string' ? data.id : '';
      const role = toMessageRole(data.role);
      const content = typeof data.content === 'string' ? data.content : '';
      if (!id || !role) return;

      const existing = this.messages.find((message) => message.id === id);
      if (existing) {
        existing.content = content;
        return;
      }
      this.messages.push({
        id,
        role,
        content,
        metadata: {},
        createdAt: new Date().toISOString(),
      });
    },
    getStreamingAssistantMessage() {
      if (!this.streamingAssistantId) return null;
      return this.messages.find((message) => message.id === this.streamingAssistantId) ?? null;
    },
    hasAssistantMessageContent(content: string) {
      return this.messages.some(
        (message) => message.role === 'assistant' && !message.streaming && message.content === content,
      );
    },
    promoteStreamingAssistant(data: SsePayload) {
      const streamingMessage = this.getStreamingAssistantMessage();
      if (!streamingMessage) return;

      const id = typeof data.id === 'string' ? data.id : '';
      const content = typeof data.content === 'string' ? data.content : streamingMessage.content;
      if (!id) return;

      streamingMessage.id = id;
      streamingMessage.content = content;
      streamingMessage.streaming = false;
      streamingMessage.metadata = {};
    },
    disconnectEvents() {
      if (this.eventSource) {
        this.eventSource.close();
      }
      this.eventSource = null;
      this.eventStatus = 'idle';
      this.streamingAssistantId = null;
      this.agentActivity = null;
    },
  },
});

function safeJson(value: string): SsePayload {
  try {
    return JSON.parse(value) as SsePayload;
  } catch {
    return { value };
  }
}

function toMessageRole(value: unknown): Message['role'] | null {
  if (value === 'system' || value === 'user' || value === 'assistant' || value === 'tool') {
    return value;
  }
  return null;
}
