import type {
  Approval,
  AuthResponse,
  CommandRunView,
  GitStatus,
  ListResponse,
  Message,
  ModelChoice,
  ModelsCommandResult,
  PlanBundle,
  Project,
  ProjectFile,
  Session,
  SystemCapabilities,
  TreeNode,
} from '../types';

export class ApiClient {
  constructor(
    readonly apiBaseUrl: string,
    private readonly token?: string,
  ) {}

  withToken(token: string | undefined): ApiClient {
    return new ApiClient(this.apiBaseUrl, token);
  }

  async capabilities(): Promise<SystemCapabilities> {
    return this.request<SystemCapabilities>('/system/capabilities');
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    return this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async me() {
    return this.request<AuthResponse['user']>('/auth/me');
  }

  async listProjects(): Promise<Project[]> {
    return this.request<Project[]>('/projects');
  }

  async createOrGetLocalProject(path: string, name?: string): Promise<Project> {
    return this.request<Project>('/projects/local', {
      method: 'POST',
      body: JSON.stringify({ path, ...(name ? { name } : {}) }),
    });
  }

  async listSessions(projectId: string): Promise<ListResponse<Session>> {
    return this.request<ListResponse<Session>>(`/projects/${projectId}/sessions`);
  }

  async createSession(projectId: string, title?: string): Promise<Session> {
    return this.request<Session>(`/projects/${projectId}/sessions`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
  }

  async getSession(sessionId: string): Promise<Session> {
    return this.request<Session>(`/sessions/${sessionId}`);
  }

  async listModels(sessionId: string): Promise<ModelChoice[]> {
    const result = await this.request<ModelsCommandResult>(`/sessions/${sessionId}/commands`, {
      method: 'POST',
      body: JSON.stringify({ command: '/models' }),
    });
    return result.type === 'models.list' ? result.models : [];
  }

  async selectModel(
    sessionId: string,
    input: { providerId: string; modelName: string; apiKey?: string },
  ): Promise<ModelsCommandResult> {
    return this.request<ModelsCommandResult>(`/sessions/${sessionId}/commands`, {
      method: 'POST',
      body: JSON.stringify({ command: '/models', args: input }),
    });
  }

  async listMessages(sessionId: string): Promise<Message[]> {
    return this.request<Message[]>(`/sessions/${sessionId}/messages`);
  }

  async runAgent(sessionId: string, message: string, approvedPlanId?: string): Promise<unknown> {
    return this.request(`/sessions/${sessionId}/run`, {
      method: 'POST',
      body: JSON.stringify({ message, approvedPlanId }),
    });
  }

  async createPlan(sessionId: string, goal: string): Promise<PlanBundle> {
    return this.request<PlanBundle>(`/sessions/${sessionId}/plan`, {
      method: 'POST',
      body: JSON.stringify({ goal }),
    });
  }

  async latestPlan(sessionId: string): Promise<PlanBundle | null> {
    return this.request<PlanBundle | null>(`/sessions/${sessionId}/plans/latest`);
  }

  async approvePlan(planId: string): Promise<PlanBundle['plan']> {
    return this.request<PlanBundle['plan']>(`/plans/${planId}/approve`, { method: 'POST' });
  }

  async pendingApprovals(): Promise<Approval[]> {
    return this.request<Approval[]>('/approvals/pending');
  }

  async approve(approvalId: string, mode: 'once' | 'project' | 'session_auto' = 'once'): Promise<unknown> {
    return this.request(`/approvals/${approvalId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ mode }),
    });
  }

  async reject(approvalId: string): Promise<unknown> {
    return this.request(`/approvals/${approvalId}/reject`, { method: 'POST' });
  }

  async tree(projectId: string, depth = 2): Promise<TreeNode[]> {
    return this.request<TreeNode[]>(`/projects/${projectId}/tree?depth=${depth}`);
  }

  async file(projectId: string, path: string): Promise<ProjectFile> {
    return this.request<ProjectFile>(`/projects/${projectId}/file?path=${encodeURIComponent(path)}`);
  }

  async gitStatus(projectId: string): Promise<GitStatus> {
    return this.request<GitStatus>(`/projects/${projectId}/git/status`);
  }

  async commandRuns(sessionId: string): Promise<CommandRunView[]> {
    return this.request<CommandRunView[]>(`/sessions/${sessionId}/command-runs`);
  }

  async requestCommand(sessionId: string, command: string, cwd?: string): Promise<unknown> {
    return this.request(`/sessions/${sessionId}/command-runs`, {
      method: 'POST',
      body: JSON.stringify({ command, ...(cwd ? { cwd } : {}) }),
    });
  }

  eventUrl(sessionId: string, token: string): string {
    return this.url(`/sessions/${sessionId}/events?access_token=${encodeURIComponent(token)}`);
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }
    if (options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    let response: Response;
    try {
      response = await fetch(this.url(path), { ...options, headers });
    } catch (error) {
      throw new Error(`API is not reachable at ${this.apiBaseUrl}. Start the backend or run mebius --api <url>.`);
    }

    if (!response.ok) {
      throw new Error(await readError(response));
    }
    if (response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }

  private url(path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${normalizedPath}`;
  }
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return `Request failed with HTTP ${response.status}`;
  try {
    const payload = JSON.parse(text) as { message?: unknown; error?: unknown };
    if (Array.isArray(payload.message)) return payload.message.join(', ');
    if (typeof payload.message === 'string') return payload.message;
    if (typeof payload.error === 'string') return payload.error;
  } catch {
    return text;
  }
  return text;
}
