export interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
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
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
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
