export interface LayoutPreferences {
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  leftSidebarWidth: number;
  rightSidebarWidth: number;
}

export type ThemeMode = 'dark' | 'light';
export type PermissionMode = 'read_only' | 'ask_first' | 'auto' | 'full_access';

export interface ThemePreferences {
  mode: ThemeMode;
}

export interface UserPreferences {
  layout: LayoutPreferences;
  theme: ThemePreferences;
}

export type UserPreferencesPatch = {
  layout?: Partial<LayoutPreferences>;
  theme?: Partial<ThemePreferences>;
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

export interface RegisterVerificationCodeResponse {
  sent: true;
  expiresInSeconds: number;
  resendAfterSeconds: number;
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

export interface Project {
  id: string;
  name: string;
  description?: string;
  sourceType: 'manual' | 'git' | 'archive' | 'local' | string;
  workspaceMode?: 'managed' | 'attached';
  deletePolicy?: 'delete_managed_files_allowed' | 'db_record_only';
  gitUrl?: string | null;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  projectId: string;
  title: string;
  status: string;
  permissionMode: PermissionMode;
  activeModelConfig: ModelConfig | null;
  agentActivity?: {
    status: 'using_tools' | 'waiting_for_approval';
    toolName?: string;
    activity?: string;
    targetPaths?: string[];
    command?: string;
    message?: string;
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

export interface DeleteProjectFileResult {
  deleted: true;
  path: string;
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
  pushableCommits: number;
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
  goal?: string;
  summary: string;
  status: string;
  draftMarkdown?: string;
  finalMarkdown?: string | null;
  questions?: PlanQuestion[];
  answers?: PlanQuestionAnswer[];
  createdAt: string;
  updatedAt: string;
}

export interface PlanQuestionChoice {
  id: string;
  label: string;
  description?: string;
  notes?: string;
}

export interface PlanQuestion {
  id: string;
  title: string;
  prompt: string;
  choices: PlanQuestionChoice[];
  recommendedChoiceId?: string;
  allowCustomAnswer: boolean;
  notes?: string;
  required?: boolean;
  multiSelect?: boolean;
}

export interface PlanQuestionAnswer {
  questionId: string;
  choiceId?: string;
  choiceIds?: string[];
  customAnswer?: string;
  notes?: string;
}

export interface PlanBundle {
  plan: Plan;
  steps: PlanStep[];
  questions?: PlanQuestion[];
  answers?: PlanQuestionAnswer[];
}

export interface FilePatch {
  id: string;
  relativePath: string;
  diffText: string;
  status: 'proposed' | 'applied' | 'conflicted' | 'rejected' | 'reverted' | string;
  createdAt: string;
  toolCall?: {
    id: string;
    name: string;
    status: string;
  };
}

export interface CommandRunView {
  id: string;
  command: string;
  cwd?: string;
  status: string;
  exitCode?: number;
  stdout: string;
  stderr: string;
  createdAt: string;
  toolCall?: {
    id: string;
    name: string;
    status: string;
  };
}

export interface TurnUndoRedoResult {
  direction: 'undo' | 'redo';
  turnId?: string;
  messageCount: number;
  reverted: Array<{ path: string; patchId: string }>;
  restored: Array<{ path: string; patchId: string }>;
  conflicts: Array<{ path: string; patchId: string; reason: string }>;
}

export interface CommandAuthorization {
  shellAutoRun: boolean;
  canGrantShellAutoRun: boolean;
  grantedAt?: string;
  grantedById?: string;
}

export interface CommandPolicyPreset {
  id: string;
  label: string;
  description: string;
  commands: string[];
  enabled: boolean;
}

export interface CommandPolicy {
  canManage: boolean;
  environmentCommands: string[];
  enabledPresets: string[];
  customCommands: string[];
  effectiveCommands: string[];
  presets: CommandPolicyPreset[];
  updatedAt?: string;
}

export type ApprovalPreview =
  | {
      kind: 'patch';
      path: string;
      diffText: string;
      truncated: boolean;
    }
  | {
      kind: 'patch_set';
      files: Array<{
        path: string;
        diffText: string;
        truncated: boolean;
        status: string;
      }>;
      truncated: boolean;
    }
  | {
      kind: 'command';
      command: string;
      cwd?: string;
      policyAllowed: boolean;
      policySource?: 'environment' | 'preset' | 'custom' | 'project';
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
  createdAt: string;
  preview?: ApprovalPreview;
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

export type ModelsCommandResult =
  | { type: 'models.list'; models: ModelChoice[] }
  | { type: 'models.selected'; modelConfig: ModelConfig; session: Session };

export interface SsePayload {
  [key: string]: unknown;
}
