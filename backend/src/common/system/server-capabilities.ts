import { ConfigService } from '@nestjs/config';

export const SERVER_MODES = ['development', 'production', 'test', 'local_runtime'] as const;
export type ServerMode = (typeof SERVER_MODES)[number];

export const WORKSPACE_MODES = ['managed', 'attached'] as const;
export const PROJECT_SOURCE_TYPES = ['manual', 'git', 'archive', 'local'] as const;

export function resolveServerMode(config: ConfigService): ServerMode {
  const configured = config.get<string>('MEBIUS_CODE_SERVER_MODE');
  if (configured && isServerMode(configured)) {
    return configured;
  }

  const nodeEnv = config.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? 'development';
  if (nodeEnv === 'production' || nodeEnv === 'test') {
    return nodeEnv;
  }
  return 'development';
}

export function localWorkspacesEnabled(config: ConfigService): boolean {
  const serverMode = resolveServerMode(config);
  if (serverMode === 'production') {
    return false;
  }

  return (config.get<string>('MEBIUS_CODE_LOCAL_WORKSPACES_ENABLED') ?? 'false').toLowerCase() === 'true';
}

function isServerMode(value: string): value is ServerMode {
  return SERVER_MODES.includes(value as ServerMode);
}
