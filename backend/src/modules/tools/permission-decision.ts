import { PermissionMode } from '../../common/enums/permission-mode.enum';
import type { CommandInspection } from '../../common/security/command-policy.service';

export type PermissionDecision = 'allow' | 'ask' | 'deny';

export interface ToolPermissionRequest {
  name: string;
  args: Record<string, unknown>;
  commandInspection?: CommandInspection;
  inspectionError?: string;
}

export interface SessionApprovalRuleLike {
  toolKind: string;
  pattern?: string | null;
  scope?: string | null;
}

const READ_TOOLS = new Set(['list_files', 'read_file', 'search_text', 'read', 'glob', 'grep', 'list']);
const WRITE_TOOLS = new Set(['create_patch', 'edit', 'write']);

const SAFE_COMMAND_PREFIXES = [
  'python -m py_compile',
  'python -m compileall',
  'py -m py_compile',
  'py -m compileall',
  'pytest',
  'python -m pytest',
  'py -m pytest',
  'npm test',
  'npm run test',
  'npm run build',
  'npm run lint',
  'npm run typecheck',
  'git diff',
  'git status',
  'git log',
  'git show',
];

const DESTRUCTIVE_COMMAND_PREFIXES = ['rm', 'del', 'rmdir', 'git reset', 'git clean'];
const NETWORK_COMMAND_PREFIXES = [
  'curl',
  'wget',
  'git push',
  'npm install',
  'npm i',
  'pip install',
  'pip3 install',
  'python -m pip install',
  'py -m pip install',
  'powershell invoke-webrequest',
  'powershell iwr',
  'powershell irm',
  'pwsh invoke-webrequest',
  'pwsh iwr',
  'pwsh irm',
  'invoke-webrequest',
  'iwr',
  'irm',
];

export function decidePermission(
  mode: PermissionMode,
  request: ToolPermissionRequest,
  sessionRules: SessionApprovalRuleLike[] = [],
): PermissionDecision {
  if (matchesSessionApprovalRule(request, sessionRules)) {
    return 'allow';
  }

  if (hasExternalToolPath(request)) {
    return mode === PermissionMode.ReadOnly ? 'deny' : 'ask';
  }

  if (isReadTool(request.name)) {
    return 'allow';
  }

  if (isWriteTool(request.name)) {
    return decideWritePermission(mode);
  }

  if (request.name === 'run_command') {
    return decideCommandPermission(mode, request);
  }

  return mode === PermissionMode.FullAccess ? 'allow' : 'ask';
}

export function matchesSessionApprovalRule(
  request: ToolPermissionRequest,
  rules: SessionApprovalRuleLike[],
): boolean {
  return rules.some((rule) => {
    if (rule.toolKind !== request.name) {
      return false;
    }
    if (rule.scope === 'session') {
      return true;
    }
    if (request.name === 'create_patch') {
      return rule.scope === 'workspace' && !hasExternalToolPath(request);
    }
    if (request.name === 'run_command' && rule.pattern) {
      const normalized = request.commandInspection?.normalized ?? normalizeCommandString(stringArg(request.args, 'command'));
      return !hasExternalPathToken(normalized) && commandMatchesPrefix(normalized, rule.pattern);
    }
    return false;
  });
}

export function commandApprovalPattern(command: string): string {
  const normalized = normalizeCommandString(command);
  if (!normalized) {
    return normalized;
  }
  if (/[;&|<>]/.test(normalized)) {
    return normalized;
  }
  const parts = splitCommandParts(normalized);
  if (parts.length <= 2) {
    return normalized;
  }
  if (parts[0] === 'npm' && parts[1] === 'run' && parts[2]) {
    return parts.slice(0, 3).join(' ');
  }
  if ((parts[0] === 'python' || parts[0] === 'py') && parts[1] === '-m' && parts[2]) {
    return parts.slice(0, 3).join(' ');
  }
  return parts.slice(0, 2).join(' ');
}

export function isSafeCommand(command: string): boolean {
  const normalized = normalizeCommandString(command).toLowerCase();
  return SAFE_COMMAND_PREFIXES.some((prefix) => commandMatchesPrefix(normalized, prefix));
}

export function isNetworkCommand(command: string): boolean {
  const normalized = normalizeCommandString(command).toLowerCase();
  return NETWORK_COMMAND_PREFIXES.some((prefix) => commandMatchesPrefix(normalized, prefix));
}

export function isDestructiveCommand(command: string): boolean {
  const normalized = normalizeCommandString(command).toLowerCase();
  return DESTRUCTIVE_COMMAND_PREFIXES.some((prefix) => commandMatchesPrefix(normalized, prefix));
}

export function hasExternalPathToken(command: string): boolean {
  const normalized = normalizeCommandString(command);
  return (
    /(^|\s)[A-Za-z]:[\\/]/.test(normalized) ||
    /(^|\s)\\\\/.test(normalized) ||
    /(^|\s)\/[^\s]/.test(normalized)
  );
}

export function hasExternalToolPath(request: ToolPermissionRequest): boolean {
  return collectToolPaths(request).some(isExternalPath);
}

function decideWritePermission(mode: PermissionMode): PermissionDecision {
  if (mode === PermissionMode.ReadOnly || mode === PermissionMode.AskFirst) {
    return 'ask';
  }
  return 'allow';
}

function decideCommandPermission(mode: PermissionMode, request: ToolPermissionRequest): PermissionDecision {
  if (request.inspectionError) {
    return 'deny';
  }

  const command = request.commandInspection?.normalized ?? normalizeCommandString(stringArg(request.args, 'command'));
  const destructive = isDestructiveCommand(command);
  const network = isNetworkCommand(command);
  const externalPath = hasExternalPathToken(command);
  const shellSyntax = (request.commandInspection?.shellTokens?.length ?? 0) > 0;

  if (mode === PermissionMode.ReadOnly) {
    return destructive || network || externalPath ? 'deny' : 'ask';
  }
  if (mode === PermissionMode.AskFirst) {
    return 'ask';
  }
  if (mode === PermissionMode.Auto) {
    return isSafeCommand(command) && !shellSyntax && !network && !destructive && !externalPath ? 'allow' : 'ask';
  }
  if (mode === PermissionMode.FullAccess) {
    return destructive || network || externalPath ? 'ask' : 'allow';
  }
  return 'ask';
}

function isReadTool(name: string): boolean {
  return READ_TOOLS.has(name);
}

function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

function collectToolPaths(request: ToolPermissionRequest): string[] {
  const paths: string[] = [];
  addStringPath(paths, request.args.path);
  addStringPath(paths, request.args.cwd);
  if (Array.isArray(request.args.files)) {
    request.args.files.forEach((item) => {
      if (item && typeof item === 'object') {
        addStringPath(paths, (item as Record<string, unknown>).path);
      }
    });
  }
  return paths;
}

function addStringPath(paths: string[], value: unknown): void {
  if (typeof value === 'string' && value.trim()) {
    paths.push(value.trim());
  }
}

function isExternalPath(value: string): boolean {
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\\\')) {
    return true;
  }
  return value
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
    .includes('..');
}

function commandMatchesPrefix(command: string, prefix: string): boolean {
  const normalizedCommand = normalizeCommandString(command).toLowerCase();
  const normalizedPrefix = normalizeCommandString(prefix).toLowerCase();
  return normalizedCommand === normalizedPrefix || normalizedCommand.startsWith(`${normalizedPrefix} `);
}

function normalizeCommandString(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

function splitCommandParts(command: string): string[] {
  return command.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, '')) ?? [];
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}
