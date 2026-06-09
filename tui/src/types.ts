export type TuiThemeName = 'onedark' | 'monokai' | 'dracula' | 'catppuccin-mocha' | 'gruvbox-dark';

export interface TuiConfig {
  apiBaseUrl: string;
  accessToken?: string;
  recentProjectId?: string;
  recentSessionId?: string;
  preferences?: {
    leftSidebarVisible?: boolean;
    rightPanel?: 'plan' | 'diff' | 'logs';
    theme?: TuiThemeName;
  };
}

export interface AuthResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: 'user' | 'admin';
  };
}

export interface SystemCapabilities {
  version: string;
  serverMode: 'development' | 'production' | 'test' | 'local_runtime';
  localWorkspacesEnabled: boolean;
  workspaceModes: Array<'managed' | 'attached'>;
  sourceTypes: Array<'manual' | 'git' | 'archive' | 'local'>;
  features: Record<string, boolean>;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  sourceType: string;
  workspaceMode?: 'managed' | 'attached';
  deletePolicy?: 'delete_managed_files_allowed' | 'db_record_only';
  workspacePath: string;
}

export interface ListResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Session {
  id: string;
  projectId: string;
  title: string;
  status: string;
  activeModelConfig: ModelConfig | null;
  agentActivity?: AgentActivity | null;
  createdAt: string;
  updatedAt: string;
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

export interface ModelChoice {
  providerId: string;
  providerName: string;
  baseUrl: string;
  modelName: string;
  displayName: string;
  configured: boolean;
  active: boolean;
  isDefault: boolean;
  supportsTools: boolean;
  requiresApiKey: boolean;
  modelConfigId?: string;
}

export type ModelsCommandResult =
  | { type: 'models.list'; models: ModelChoice[] }
  | { type: 'models.selected'; modelConfig: ModelConfig; session: Session };

export interface AgentActivity {
  status: 'thinking' | 'responding' | 'using_tools' | 'waiting_for_approval' | 'failed' | string;
  toolName?: string;
  activity?: string;
  targetPaths?: string[];
  command?: string;
  message?: string;
}

export interface Message {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  streaming?: boolean;
}

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

export interface GitStatus {
  isGitRepo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  files: Array<{ path: string; state: string }>;
  counts: { staged: number; unstaged: number; untracked: number };
}

export type ApprovalPreview =
  | { kind: 'patch'; path: string; diffText: string; truncated: boolean }
  | {
      kind: 'patch_set';
      files: Array<{ path: string; diffText: string; truncated: boolean; status: string }>;
      truncated: boolean;
    }
  | {
      kind: 'command';
      command: string;
      cwd?: string;
      policyAllowed: boolean;
      executionMode: 'argv' | 'shell';
      shellTokens: string[];
      sessionAutoRunActive: boolean;
      canGrantSessionAutoRun: boolean;
      truncated: false;
    };

export interface Approval {
  id: string;
  status: string;
  reason?: string;
  preview?: ApprovalPreview;
  toolCall: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    session?: { id: string; project?: Project };
  };
}

export interface PlanBundle {
  plan: { id: string; summary: string; status: string };
  steps: Array<{ id: string; order: number; title: string; detail?: string; status: string }>;
}

export interface CommandRunView {
  id: string;
  command: string;
  cwd?: string;
  status: string;
  exitCode?: number;
  stdout: string;
  stderr: string;
}

export interface ProjectFile {
  path: string;
  content: string;
  size: number;
}

export interface SseEvent {
  type: string;
  data: Record<string, unknown>;
}
