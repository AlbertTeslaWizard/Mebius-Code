export enum PermissionMode {
  ReadOnly = 'read_only',
  AskFirst = 'ask_first',
  Auto = 'auto',
  FullAccess = 'full_access',
}

export const DEFAULT_PERMISSION_MODE = PermissionMode.AskFirst;

