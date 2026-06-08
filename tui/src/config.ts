import { mkdir, readFile, writeFile, chmod, rm } from 'fs/promises';
import { dirname, join } from 'path';
import { homedir } from 'os';
import type { TuiConfig } from './types';

export const DEFAULT_API_BASE_URL = 'http://localhost:3000/api';

export function configPath(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'Mebius', 'config.json');
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'mebius', 'config.json');
}

export async function loadConfig(): Promise<TuiConfig> {
  const path = configPath();
  try {
    const content = await readFile(path, 'utf8');
    const parsed = JSON.parse(content) as Partial<TuiConfig>;
    return {
      apiBaseUrl: parsed.apiBaseUrl ?? DEFAULT_API_BASE_URL,
      accessToken: parsed.accessToken,
      recentProjectId: parsed.recentProjectId,
      recentSessionId: parsed.recentSessionId,
      preferences: parsed.preferences,
    };
  } catch {
    return { apiBaseUrl: DEFAULT_API_BASE_URL };
  }
}

export async function saveConfig(config: TuiConfig): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') {
    await chmod(path, 0o600).catch(() => undefined);
  }
}

export async function clearToken(): Promise<void> {
  const config = await loadConfig();
  delete config.accessToken;
  delete config.recentSessionId;
  await saveConfig(config);
}

export async function removeConfig(): Promise<void> {
  await rm(configPath(), { force: true }).catch(() => undefined);
}
