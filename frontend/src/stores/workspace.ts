import { defineStore } from 'pinia';
import { apiUrl, getAccessToken, jsonBody, request } from '../api/http';
import type {
  ConnectResult,
  ListResponse,
  Message,
  Plan,
  PlanStep,
  Project,
  ProjectFile,
  Session,
  SsePayload,
  TreeNode,
} from '../api/types';

interface WorkspaceState {
  projects: Project[];
  sessions: Session[];
  messages: Message[];
  fileTree: TreeNode[];
  currentFile: ProjectFile | null;
  currentProject: Project | null;
  currentSession: Session | null;
  eventLog: Array<{ type: string; data: SsePayload; time: string }>;
  activePlan: { plan: Plan; steps: PlanStep[] } | null;
  loading: boolean;
  eventStatus: 'idle' | 'connecting' | 'open' | 'closed';
  eventSource: EventSource | null;
}

export const useWorkspaceStore = defineStore('workspace', {
  state: (): WorkspaceState => ({
    projects: [],
    sessions: [],
    messages: [],
    fileTree: [],
    currentFile: null,
    currentProject: null,
    currentSession: null,
    eventLog: [],
    activePlan: null,
    loading: false,
    eventStatus: 'idle',
    eventSource: null,
  }),
  actions: {
    async bootstrap() {
      await this.loadProjects();
      if (this.projects[0]) {
        await this.selectProject(this.projects[0]);
      }
    },
    async loadProjects() {
      this.projects = await request<Project[]>('/projects');
    },
    async createProject(input: { name: string; description?: string }) {
      const project = await request<Project>('/projects', {
        method: 'POST',
        body: jsonBody(input),
      });
      await this.loadProjects();
      await this.selectProject(project);
    },
    async importGit(input: { gitUrl: string; branch?: string }) {
      if (!this.currentProject) return;
      const project = await request<Project>(`/projects/${this.currentProject.id}/import/git`, {
        method: 'POST',
        body: jsonBody(input),
      });
      this.currentProject = project;
      await this.loadTree();
    },
    async selectProject(project: Project) {
      this.currentProject = project;
      this.currentFile = null;
      await Promise.all([this.loadSessions(), this.loadTree()]);
      if (this.sessions[0]) {
        await this.selectSession(this.sessions[0]);
      } else {
        this.currentSession = null;
        this.messages = [];
        this.disconnectEvents();
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
    async selectSession(session: Session) {
      this.currentSession = await request<Session>(`/sessions/${session.id}`);
      await this.loadMessages();
      this.connectEvents();
    },
    async loadMessages() {
      if (!this.currentSession) return;
      this.messages = await request<Message[]>(`/sessions/${this.currentSession.id}/messages`);
    },
    async submitText(content: string) {
      if (!this.currentSession || !content.trim()) return;
      const trimmed = content.trim();
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
      await request(`/sessions/${this.currentSession.id}/run`, {
        method: 'POST',
        body: jsonBody({ message: trimmed }),
      });
      await this.loadMessages();
    },
    async createPlan(goal: string) {
      if (!this.currentSession || !goal.trim()) return;
      this.activePlan = await request<{ plan: Plan; steps: PlanStep[] }>(
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
        await this.loadSessions();
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
          this.eventLog.unshift({ type, data, time: new Date().toISOString() });
          if (type === 'message_created' || type === 'done') {
            void this.loadMessages();
          }
        });
      });
    },
    disconnectEvents() {
      if (this.eventSource) {
        this.eventSource.close();
      }
      this.eventSource = null;
      this.eventStatus = 'idle';
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
