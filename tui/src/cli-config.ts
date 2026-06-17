import {
  configPath,
  DEFAULT_API_BASE_URL,
  loadConfig,
  normalizeApiBaseUrl,
  saveConfig,
} from './config';
import { isLocalApiBase } from './runtime';
import type { TuiConfig } from './types';

interface ConfigCommandDeps {
  load: () => Promise<TuiConfig>;
  save: (config: TuiConfig) => Promise<void>;
  write: (line: string) => void;
}

export async function configCommand(
  args: string[],
  deps: ConfigCommandDeps = {
    load: loadConfig,
    save: saveConfig,
    write: (line) => console.log(line),
  },
) {
  const [action, key, value] = args;
  if (action === 'set' && key === 'api' && value) {
    const config = await deps.load();
    const nextConfig = configWithApiBaseUrl(config, value);
    await deps.save(nextConfig);
    deps.write(`API saved: ${nextConfig.apiBaseUrl}`);
    deps.write('Saved login and recent session state were cleared. Run `mebius login` for this API.');
    return;
  }
  if (action === 'reset' && key === 'api' && !value) {
    const config = await deps.load();
    const nextConfig = configWithApiBaseUrl(config, DEFAULT_API_BASE_URL);
    await deps.save(nextConfig);
    deps.write(`API reset to default: ${DEFAULT_API_BASE_URL}`);
    deps.write('Saved login and recent session state were cleared. Run `mebius login` for the public API.');
    return;
  }
  if (action === 'show' && !key) {
    const config = await deps.load();
    for (const line of formatConfigShow(config)) {
      deps.write(line);
    }
    return;
  }

  deps.write('Usage: mebius config show | mebius config set api <url> | mebius config reset api');
  process.exitCode = 1;
}

export function configWithApiBaseUrl(config: TuiConfig, apiBaseUrl: string): TuiConfig {
  const normalized = normalizeApiBaseUrl(apiBaseUrl) ?? DEFAULT_API_BASE_URL;
  return {
    apiBaseUrl: normalized,
    preferences: config.preferences,
  };
}

export function formatConfigShow(config: TuiConfig): string[] {
  return [
    `Config: ${configPath()}`,
    `API: ${config.apiBaseUrl}`,
    `Mode: ${describeApiMode(config.apiBaseUrl)}`,
    `Logged in: ${config.accessToken ? 'yes' : 'no'}`,
  ];
}

export function describeApiMode(apiBaseUrl: string): string {
  return isLocalApiBase(apiBaseUrl)
    ? `local backend (${apiBaseUrl})`
    : `public or remote backend (${apiBaseUrl}); client paths will not be registered`;
}

export function startupFailureHints(apiBaseUrl: string): string[] {
  if (isLocalApiBase(apiBaseUrl)) {
    return [
      'This CLI is configured for a local backend.',
      'Start the backend or reset to the public API: mebius config reset api',
    ];
  }
  return ['Check the API URL or set another API: mebius config set api <url>'];
}
