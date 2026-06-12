import { defineStore } from 'pinia';
import { apiUrl, getAccessToken, jsonBody, request } from '../api/http';
import type {
  CommandAuthorization,
  CommandRunView,
  ConnectResult,
  DeleteProjectFileResult,
  FilePatch,
  GitActionResult,
  GitCommitResult,
  GitPushResult,
  GitStatus,
  ListResponse,
  Message,
  ModelConfig,
  ModelsCommandResult,
  Plan,
  PlanBundle,
  PlanStep,
  Project,
  ProjectFile,
  Session,
  SsePayload,
  TreeNode,
  TurnUndoRedoResult,
} from '../api/types';
import { useLocaleStore } from './locale';

type AgentActivityStatus = 'thinking' | 'responding' | 'using_tools' | 'waiting_for_approval' | 'failed';
type GitImportStatus = 'idle' | 'running' | 'success' | 'error';
type GitPublishStatus = 'idle' | 'running' | 'success' | 'error';

export interface ModelDiagnostic {
  status: 'started' | 'completed' | 'failed';
  mode?: string;
  turn?: number;
  modelConfigId?: string;
  displayName?: string;
  modelName?: string;
  baseUrl?: string;
  providerId?: string | null;
  durationMs?: number;
  message?: string;
  startedAt?: string;
  updatedAt: string;
}

export interface AgentActivity {
  status: AgentActivityStatus;
  toolName?: string;
  activity?: string;
  targetPaths?: string[];
  command?: string;
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
  commandRuns: CommandRunView[];
  allowedCommands: string[];
  allowedCommandsLoading: boolean;
  commandAuthorization: CommandAuthorization | null;
  commandAuthorizationLoading: boolean;
  loading: boolean;
  eventStatus: 'idle' | 'connecting' | 'open' | 'closed';
  eventSource: EventSource | null;
  streamingAssistantId: string | null;
  agentActivity: AgentActivity | null;
  latestModelDiagnostic: ModelDiagnostic | null;
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
    commandRuns: [],
    allowedCommands: [],
    allowedCommandsLoading: false,
    commandAuthorization: null,
    commandAuthorizationLoading: false,
    loading: false,
    eventStatus: 'idle',
    eventSource: null,
    streamingAssistantId: null,
    agentActivity: null,
    latestModelDiagnostic: null,
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
      this.commandRuns = [];
      this.allowedCommands = [];
      this.allowedCommandsLoading = false;
      this.commandAuthorization = null;
      this.commandAuthorizationLoading = false;
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
        this.projects = this.projects.map((item) => (item.id === project.id ? project : item));
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
    async importArchive(file: File) {
      if (!this.currentProject) return;
      this.gitImportStatus = 'running';
      this.gitImportError = '';
      const formData = new FormData();
      formData.append('file', file);
      try {
        const project = await request<Project>(`/projects/${this.currentProject.id}/import/archive`, {
          method: 'POST',
          body: formData,
        });
        this.currentProject = project;
        this.projects = this.projects.map((item) => (item.id === project.id ? project : item));
        await Promise.all([this.loadTree(), this.loadGitStatus()]);
        this.gitImportStatus = 'success';
        window.setTimeout(() => {
          if (this.gitImportStatus === 'success') {
            this.resetGitImportStatus();
          }
        }, 4000);
      } catch (error) {
        this.gitImportStatus = 'error';
        this.gitImportError = error instanceof Error ? error.message : 'Archive import failed.';
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
        this.commandRuns = [];
        this.allowedCommands = [];
        this.allowedCommandsLoading = false;
        this.commandAuthorization = null;
        this.commandAuthorizationLoading = false;
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
      this.commandRuns = [];
      this.allowedCommands = [];
      this.allowedCommandsLoading = false;
      this.commandAuthorization = null;
      this.commandAuthorizationLoading = false;
      this.streamingAssistantId = null;
      this.agentActivity = null;

      if (this.sessions[0]) {
        await this.selectSession(this.sessions[0]);
      }
    },
    async selectSession(session: Session) {
      this.streamingAssistantId = null;
      this.agentActivity = null;
      this.latestModelDiagnostic = null;
      this.currentSession = await request<Session>(`/sessions/${session.id}`);
      this.agentActivity = normalizeAgentActivity(this.currentSession.agentActivity ?? null, null);
      await this.loadMessages();
      await this.refreshReviewData();
      this.connectEvents();
    },
    async switchSessionModel(modelConfigId: string) {
      if (!this.currentSession) return null;
      const result = await request<ModelsCommandResult>(`/sessions/${this.currentSession.id}/commands`, {
        method: 'POST',
        body: jsonBody({ command: '/models', args: { modelConfigId } }),
      });
      if (result.type !== 'models.selected') return null;
      const session = result.session;
      this.currentSession = session;
      this.sessions = this.sessions.map((item) => (item.id === session.id ? session : item));
      await this.loadModelConfigs();
      return session;
    },
    async loadMessages() {
      if (!this.currentSession) return;
      this.messages = await request<Message[]>(`/sessions/${this.currentSession.id}/messages`);
    },
    async refreshCurrentSession() {
      if (!this.currentSession) return null;
      const session = await request<Session>(`/sessions/${this.currentSession.id}`);
      this.currentSession = session;
      this.sessions = this.sessions.map((item) => (item.id === session.id ? session : item));
      this.agentActivity = normalizeAgentActivity(session.agentActivity ?? null, this.agentActivity);
      return session;
    },
    async submitText(content: string, options: { approvedPlanId?: string } = {}) {
      if (!this.currentSession || !content.trim()) return;
      const trimmed = content.trim();
      if (this.agentActivity?.status === 'waiting_for_approval') {
        const locale = useLocaleStore();
        throw new Error(locale.t('pendingApprovalBeforeChat'));
      }
      if (trimmed.startsWith('/')) {
        if (trimmed === '/undo') {
          await this.undoLastTurn();
          return;
        }
        if (trimmed.startsWith('/undo ')) {
          throw new Error('/undo does not accept arguments.');
        }
        if (trimmed === '/redo') {
          await this.redoLastTurn();
          return;
        }
        if (trimmed.startsWith('/redo ')) {
          throw new Error('/redo does not accept arguments.');
        }
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
      await this.ensureEventStream();
      this.agentActivity = { status: 'thinking' };
      try {
        await request(`/sessions/${this.currentSession.id}/run`, {
          method: 'POST',
          body: jsonBody({ message: trimmed, approvedPlanId: options.approvedPlanId }),
        });
        await Promise.all([
          this.loadMessages(),
          this.refreshCurrentSession(),
          this.refreshReviewData(),
          this.loadCommandRuns(),
        ]);
      } catch (error) {
        this.agentActivity = {
          status: 'failed',
          message: error instanceof Error ? error.message : 'Agent run failed.',
        };
        throw error;
      }
    },
    async undoLastTurn() {
      return this.applyTurnUndoRedo('undo');
    },
    async redoLastTurn() {
      return this.applyTurnUndoRedo('redo');
    },
    async applyTurnUndoRedo(direction: 'undo' | 'redo') {
      if (!this.currentSession) return null;
      const result = await request<TurnUndoRedoResult>(`/sessions/${this.currentSession.id}/${direction}`, {
        method: 'POST',
      });
      if (result.conflicts.length === 0) {
        await Promise.all([
          this.loadMessages(),
          this.refreshCurrentSession(),
          this.refreshReviewData(),
          this.loadTree(),
          this.loadGitStatus(),
        ]);
      }
      this.eventLog.unshift({
        type: direction === 'undo' ? 'turn_undone' : 'turn_redone',
        data: result as unknown as SsePayload,
        time: new Date().toISOString(),
      });
      return result;
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
    async loadCommandRuns() {
      if (!this.currentSession) {
        this.commandRuns = [];
        return [];
      }
      this.commandRuns = await request<CommandRunView[]>(
        `/sessions/${this.currentSession.id}/command-runs`,
      );
      return this.commandRuns;
    },
    async loadAllowedCommands() {
      if (!this.currentSession) {
        this.allowedCommands = [];
        this.allowedCommandsLoading = false;
        return [];
      }
      this.allowedCommandsLoading = true;
      try {
        this.allowedCommands = await request<string[]>(`/sessions/${this.currentSession.id}/allowed-commands`);
        return this.allowedCommands;
      } finally {
        this.allowedCommandsLoading = false;
      }
    },
    async loadCommandAuthorization() {
      if (!this.currentSession) {
        this.commandAuthorization = null;
        this.commandAuthorizationLoading = false;
        return null;
      }
      this.commandAuthorizationLoading = true;
      try {
        this.commandAuthorization = await request<CommandAuthorization>(
          `/sessions/${this.currentSession.id}/command-authorization`,
        );
        return this.commandAuthorization;
      } finally {
        this.commandAuthorizationLoading = false;
      }
    },
    async revokeCommandAuthorization() {
      if (!this.currentSession) return null;
      this.commandAuthorization = await request<CommandAuthorization>(
        `/sessions/${this.currentSession.id}/command-authorization`,
        { method: 'DELETE' },
      );
      return this.commandAuthorization;
    },
    async requestCommand(input: { command: string; cwd?: string }) {
      if (!this.currentSession) return null;
      const toolCall = await request<{ id: string; status: string }>(
        `/sessions/${this.currentSession.id}/command-runs`,
        {
          method: 'POST',
          body: jsonBody(input),
        },
      );
      await this.refreshCurrentSession();
      return toolCall;
    },
    async revertPatch(patchId: string) {
      await request<FilePatch>(`/patches/${patchId}/revert`, { method: 'POST' });
      await Promise.all([this.loadPatches(), this.loadTree(), this.loadGitStatus()]);
    },
    async refreshReviewData() {
      await Promise.all([
        this.loadLatestPlan(),
        this.loadPatches(),
        this.loadCommandRuns(),
        this.loadAllowedCommands(),
        this.loadCommandAuthorization(),
      ]);
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
    async createFile(path: string, content = '') {
      if (!this.currentProject) return null;
      const file = await request<ProjectFile>(`/projects/${this.currentProject.id}/file`, {
        method: 'POST',
        body: jsonBody({ path, content }),
      });
      this.currentFile = file;
      await Promise.all([this.loadTree(), this.loadGitStatus()]);
      return file;
    },
    async saveFile(path: string, content: string) {
      if (!this.currentProject) return null;
      const file = await request<ProjectFile>(`/projects/${this.currentProject.id}/file`, {
        method: 'PUT',
        body: jsonBody({ path, content }),
      });
      this.currentFile = file;
      await Promise.all([this.loadTree(), this.loadGitStatus()]);
      return file;
    },
    async deleteFile(path: string) {
      if (!this.currentProject) return null;
      const result = await request<DeleteProjectFileResult>(
        `/projects/${this.currentProject.id}/file?path=${encodeURIComponent(path)}`,
        { method: 'DELETE' },
      );
      if (this.currentFile?.path === result.path) {
        this.currentFile = null;
      }
      await Promise.all([this.loadTree(), this.loadGitStatus()]);
      return result;
    },
    async renameFile(path: string, newPath: string) {
      if (!this.currentProject) return null;
      const file = await request<ProjectFile>(`/projects/${this.currentProject.id}/file`, {
        method: 'PATCH',
        body: jsonBody({ path, newPath }),
      });
      if (this.currentFile?.path === path) {
        this.currentFile = file;
      }
      await Promise.all([this.loadTree(), this.loadGitStatus()]);
      return file;
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
        'command_started',
        'command_output',
        'patch_reverted',
        'turn_undone',
        'turn_redone',
        'model_call_started',
        'model_call_completed',
        'model_call_failed',
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
          if (type === 'turn_undone' || type === 'turn_redone') {
            this.agentActivity = null;
            void Promise.all([
              this.loadMessages(),
              this.refreshCurrentSession(),
              this.refreshReviewData(),
              this.loadTree(),
              this.loadGitStatus(),
            ]);
            return;
          }
          if (type === 'model_call_started' || type === 'model_call_completed' || type === 'model_call_failed') {
            this.handleModelDiagnostic(type, data);
            return;
          }
          if (type === 'tool_call_requested') {
            void this.refreshReviewData();
            this.agentActivity = normalizeAgentActivity(
              {
                ...data,
                status: 'waiting_for_approval',
                toolName: typeof data.toolName === 'string' ? data.toolName : data.name,
                activity: typeof data.activity === 'string' ? data.activity : 'waiting_for_approval',
              },
              this.agentActivity,
            );
            return;
          }
          if (
            type === 'tool_call_result' ||
            type === 'command_output' ||
            type === 'patch_created' ||
            type === 'patch_reverted' ||
            type === 'command_started'
          ) {
            if (type === 'patch_reverted') {
              void Promise.all([this.loadPatches(), this.loadTree(), this.loadGitStatus()]);
              return;
            }
            const toolName = inferEventToolName(type, data, this.agentActivity);
            const activity =
              typeof data.activity === 'string' ? data.activity : defaultEventActivity(type, toolName);
            this.agentActivity = normalizeAgentActivity(
              {
                ...data,
                status: 'using_tools',
                toolName,
                activity,
              },
              this.agentActivity,
            );
            if (type === 'patch_created') {
              void Promise.all([this.loadPatches(), this.loadTree(), this.loadGitStatus()]);
            }
            if (type === 'command_started' || type === 'command_output') {
              void this.loadCommandRuns();
            }
            return;
          }
          if (type === 'done') {
            const streamingMessage = this.getStreamingAssistantMessage();
            void this.loadMessages()
              .then(() => {
                if (
                  streamingMessage &&
                  this.hasStreamingAssistantContent(streamingMessage) &&
                  !this.hasAssistantMessageContent(streamingMessage.content)
                ) {
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
                if (this.agentActivity?.status !== 'failed') {
                  this.agentActivity = null;
                }
              })
              .catch(() => {
                if (
                  streamingMessage &&
                  this.hasStreamingAssistantContent(streamingMessage) &&
                  !this.messages.some((message) => message.id === streamingMessage.id)
                ) {
                  this.messages.push(streamingMessage);
                }
                this.streamingAssistantId = null;
                if (this.agentActivity?.status !== 'failed') {
                  this.agentActivity = null;
                }
              });
          }
        });
      });
    },
    async ensureEventStream() {
      if (!this.currentSession || this.eventStatus === 'open') return;
      this.connectEvents();
      await this.waitForEventStreamOpen();
    },
    waitForEventStreamOpen(timeoutMs = 900): Promise<void> {
      if (this.eventStatus === 'open') return Promise.resolve();
      return new Promise((resolve) => {
        const startedAt = Date.now();
        const timer = window.setInterval(() => {
          if (this.eventStatus === 'open' || Date.now() - startedAt >= timeoutMs) {
            window.clearInterval(timer);
            resolve();
          }
        }, 50);
      });
    },
    handleAgentStatus(data: SsePayload) {
      const status = typeof data.status === 'string' ? data.status : '';
      if (status === 'thinking') {
        this.agentActivity = normalizeAgentActivity(data, this.agentActivity);
        return;
      }
      if (status === 'responding') {
        this.agentActivity = normalizeAgentActivity(data, this.agentActivity);
        return;
      }
      if (status === 'using_tools') {
        this.agentActivity = normalizeAgentActivity(data, this.agentActivity);
        return;
      }
      if (status === 'waiting_for_approval') {
        this.agentActivity = normalizeAgentActivity(data, this.agentActivity);
        return;
      }
      if (status === 'failed') {
        this.agentActivity = normalizeAgentActivity(data, this.agentActivity);
        return;
      }
      if (status === 'completed') {
        this.agentActivity = null;
      }
    },
    handleTokenEvent(data: SsePayload) {
      const content = typeof data.content === 'string' ? data.content : undefined;
      const delta = typeof data.delta === 'string' ? data.delta : '';
      if (content === undefined && !delta) return;
      if (content === '' && !delta) {
        this.clearStreamingAssistant();
        return;
      }
      if (this.agentActivity?.activity !== 'stream_fallback') {
        this.agentActivity = { status: 'responding' };
      }

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
    handleModelDiagnostic(type: string, data: SsePayload) {
      this.latestModelDiagnostic = {
        status:
          type === 'model_call_failed'
            ? 'failed'
            : type === 'model_call_completed'
              ? 'completed'
              : 'started',
        mode: typeof data.mode === 'string' ? data.mode : undefined,
        turn: typeof data.turn === 'number' ? data.turn : undefined,
        modelConfigId: typeof data.modelConfigId === 'string' ? data.modelConfigId : undefined,
        displayName: typeof data.displayName === 'string' ? data.displayName : undefined,
        modelName: typeof data.modelName === 'string' ? data.modelName : undefined,
        baseUrl: typeof data.baseUrl === 'string' ? data.baseUrl : undefined,
        providerId:
          typeof data.providerId === 'string' || data.providerId === null ? data.providerId : undefined,
        durationMs: typeof data.durationMs === 'number' ? data.durationMs : undefined,
        message: typeof data.message === 'string' ? data.message : undefined,
        startedAt: typeof data.startedAt === 'string' ? data.startedAt : undefined,
        updatedAt: new Date().toISOString(),
      };
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
    hasStreamingAssistantContent(message: Message | null) {
      return Boolean(message?.content.trim());
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
    clearStreamingAssistant() {
      if (!this.streamingAssistantId) return;
      const streamingAssistantId = this.streamingAssistantId;
      this.messages = this.messages.filter((message) => message.id !== streamingAssistantId);
      this.streamingAssistantId = null;
    },
    disconnectEvents() {
      if (this.eventSource) {
        this.eventSource.close();
      }
      this.eventSource = null;
      this.eventStatus = 'idle';
      this.streamingAssistantId = null;
      this.agentActivity = null;
      this.latestModelDiagnostic = null;
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

function normalizeAgentActivity(value: unknown, previous: AgentActivity | null): AgentActivity | null {
  if (!isRecord(value)) return null;

  const status = typeof value.status === 'string' ? value.status : '';
  if (!isAgentActivityStatus(status)) return null;

  const tools = Array.isArray(value.tools)
    ? value.tools.filter((item): item is string => typeof item === 'string')
    : [];
  const explicitToolName =
    typeof value.toolName === 'string'
      ? value.toolName
      : typeof value.name === 'string'
        ? value.name
        : tools[0];
  const previousMatches =
    Boolean(previous?.toolName) && (!explicitToolName || previous?.toolName === explicitToolName);
  const activity: AgentActivity = {
    status,
  };

  if (explicitToolName || previousMatches) {
    activity.toolName = explicitToolName || previous?.toolName;
  }
  if (typeof value.activity === 'string') {
    activity.activity = value.activity;
  } else if (previousMatches) {
    activity.activity = previous?.activity;
  }

  const targetPaths = extractTargetPaths(value);
  if (targetPaths.length > 0) {
    activity.targetPaths = targetPaths;
  } else if (previousMatches && previous?.targetPaths?.length) {
    activity.targetPaths = previous.targetPaths;
  }

  if (typeof value.command === 'string') {
    activity.command = value.command;
  } else if (previousMatches && previous?.command) {
    activity.command = previous.command;
  }
  if (typeof value.message === 'string') {
    activity.message = value.message;
  }

  return activity;
}

function isAgentActivityStatus(value: string): value is AgentActivityStatus {
  return (
    value === 'thinking' ||
    value === 'responding' ||
    value === 'using_tools' ||
    value === 'waiting_for_approval' ||
    value === 'failed'
  );
}

function inferEventToolName(type: string, data: SsePayload, previous: AgentActivity | null): string | undefined {
  if (typeof data.toolName === 'string') return data.toolName;
  if (typeof data.name === 'string') return data.name;
  if (type === 'patch_created') return 'create_patch';
  if (type === 'command_started' || type === 'command_output') return 'run_command';
  if (previous?.status === 'using_tools') return previous.toolName;
  return undefined;
}

function defaultEventActivity(type: string, toolName?: string): string | undefined {
  if (type === 'patch_created') return 'patch_applied';
  if (type === 'command_started') return 'running_tool';
  if (type === 'command_output') return 'tool_completed';
  if (type === 'tool_call_result') return toolName === 'create_patch' ? 'patch_applied' : 'tool_completed';
  return undefined;
}

function extractTargetPaths(data: Record<string, unknown>): string[] {
  if (Array.isArray(data.targetPaths)) {
    return data.targetPaths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  if (typeof data.path === 'string' && data.path.trim()) {
    return [data.path.trim()];
  }
  return extractPatchTargetPaths(data.arguments);
}

function extractPatchTargetPaths(args: unknown): string[] {
  if (!isRecord(args)) return [];
  const rawPaths = Array.isArray(args.files)
    ? args.files.map((item) => (isRecord(item) ? item.path : undefined))
    : [args.path];
  return rawPaths
    .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
    .map((path) => path.trim().replaceAll('\\', '/'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function toMessageRole(value: unknown): Message['role'] | null {
  if (value === 'system' || value === 'user' || value === 'assistant' || value === 'tool') {
    return value;
  }
  return null;
}
