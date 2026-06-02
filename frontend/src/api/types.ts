export interface LayoutPreferences {
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
}

export interface UserPreferences {
  layout: LayoutPreferences;
}

export type UserPreferencesPatch = {
  layout?: Partial<LayoutPreferences>;
};

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  preferences: UserPreferences;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
}

export interface ModelConfig {
  id: string;
  providerId?: string | null;
  displayName: string;
  baseUrl: string;
  modelName: string;
  supportsTools: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ModelConfigTestResult {
  ok: boolean;
  status?: number;
  message: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  sourceType: string;
  gitUrl?: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  projectId: string;
  title: string;
  status: string;
  activeModelConfig: ModelConfig | null;
  agentActivity?: {
    status: 'using_tools' | 'waiting_for_approval';
    toolName?: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  streaming?: boolean;
}

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

export interface ProjectFile {
  path: string;
  content: string;
  size: number;
}

export interface GitRemoteInfo {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

export interface GitStatusFile {
  path: string;
  indexStatus: string;
  workTreeStatus: string;
  state: 'untracked' | 'staged' | 'modified' | 'deleted' | 'renamed' | 'conflicted' | 'unknown';
}

export interface GitStatus {
  isGitRepo: boolean;
  branch: string | null;
  tracking: string | null;
  ahead: number;
  behind: number;
  hasRemote: boolean;
  remotes: GitRemoteInfo[];
  files: GitStatusFile[];
  counts: {
    staged: number;
    unstaged: number;
    untracked: number;
  };
}

export interface GitCommitResult {
  summary: string;
  commitSha: string;
}

export interface GitActionResult {
  summary: string;
}

export interface GitPushResult {
  summary: string;
  branch: string | null;
  remote: string | null;
}

export interface ListResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface PlanStep {
  id: string;
  order: number;
  title: string;
  detail?: string;
  status: string;
}

export interface Plan {
  id: string;
  summary: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Approval {
  id: string;
  status: string;
  reason?: string;
  createdAt: string;
  toolCall: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    session?: {
      id: string;
      project?: Project;
    };
  };
}

export interface AuditLog {
  id: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  actor?: User | null;
}

export interface ConnectProvider {
  id: string;
  displayName: string;
  description: string;
  aliases: string[];
  baseUrl?: string;
  recommendedModels: string[];
  supportsTools: boolean;
  requiresCustomBaseUrl: boolean;
}

export interface ConnectField {
  name: string;
  label: string;
  type: 'text' | 'password';
  required: boolean;
}

export type ConnectResult =
  | { type: 'connect.providers'; providers: ConnectProvider[] }
  | { type: 'connect.form'; provider: ConnectProvider; fields: ConnectField[] }
  | { type: 'connect.connected'; modelConfig: ModelConfig; session: Session };

export interface SsePayload {
  [key: string]: unknown;
}
