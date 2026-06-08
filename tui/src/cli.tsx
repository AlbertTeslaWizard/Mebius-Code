#!/usr/bin/env bun
/** @jsxImportSource @opentui/solid */
import { render } from '@opentui/solid';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { ApiClient } from './api/client';
import { bootstrapWorkspace } from './bootstrap';
import { App } from './app/App';
import { clearToken, DEFAULT_API_BASE_URL, loadConfig, saveConfig } from './config';
import { bunAvailable, isGitRepository, isLocalApiBase, isWritableDirectory, normalizeTargetPath } from './runtime';

interface ParsedArgs {
  command?: string;
  targetPath?: string;
  api?: string;
  rest: string[];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'login') {
    await login(args.api);
    return;
  }
  if (args.command === 'logout') {
    await clearToken();
    console.log('Logged out.');
    return;
  }
  if (args.command === 'doctor') {
    await doctor(args.api, args.targetPath ?? args.rest[0]);
    return;
  }
  if (args.command === 'config') {
    await configCommand(args.rest);
    return;
  }

  const config = await loadConfig();
  const apiBaseUrl = args.api ?? config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  try {
    const initialState = await bootstrapWorkspace({
      apiBaseUrl,
      targetPath: args.targetPath,
      token: config.accessToken,
      persistApiBaseUrl: !args.api,
    });
    await render(() => <App initialState={initialState} />);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Mebius TUI failed to start.';
    console.error(`Mebius could not start: ${message}`);
    console.error('Run `mebius doctor` for diagnostics.');
    process.exitCode = 1;
  }
}

async function login(apiOverride?: string) {
  const config = await loadConfig();
  const apiBaseUrl = apiOverride ?? config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const api = new ApiClient(apiBaseUrl);
  const rl = createInterface({ input, output });
  try {
    const email = await rl.question('Email: ');
    const password = await rl.question('Password: ');
    const auth = await api.login(email.trim(), password);
    await saveConfig({
      ...config,
      apiBaseUrl,
      accessToken: auth.accessToken,
    });
    console.log(`Logged in as ${auth.user.email}.`);
    console.log(`API saved: ${apiBaseUrl}`);
  } finally {
    rl.close();
  }
}

async function configCommand(args: string[]) {
  const [action, key, value] = args;
  if (action === 'set' && key === 'api' && value) {
    const config = await loadConfig();
    await saveConfig({ ...config, apiBaseUrl: value });
    console.log(`API saved: ${value}`);
    return;
  }

  console.log('Usage: mebius config set api <url>');
  process.exitCode = 1;
}

async function doctor(apiOverride?: string, targetPath?: string) {
  const config = await loadConfig();
  const apiBaseUrl = apiOverride ?? config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const api = new ApiClient(apiBaseUrl, config.accessToken);
  const checks: Array<[string, boolean, string]> = [];

  checks.push(['Bun available', await bunAvailable(), 'Install Bun from https://bun.sh']);

  let capabilities: Awaited<ReturnType<ApiClient['capabilities']>> | null = null;
  try {
    capabilities = await api.capabilities();
    checks.push(['API reachable', true, apiBaseUrl]);
  } catch (error) {
    checks.push(['API reachable', false, error instanceof Error ? error.message : 'API request failed']);
  }

  if (capabilities) {
    checks.push(['Backend version', true, capabilities.version]);
    checks.push(['Server mode', true, capabilities.serverMode]);
    checks.push([
      'Local workspace support',
      capabilities.localWorkspacesEnabled,
      capabilities.localWorkspacesEnabled ? 'enabled' : 'disabled',
    ]);
  }

  if (config.accessToken) {
    try {
      const user = await api.me();
      checks.push(['Logged in', true, `${user.email} (${user.role})`]);
    } catch (error) {
      checks.push(['Logged in', false, 'Saved token is invalid or expired']);
    }
  } else {
    checks.push(['Logged in', false, 'Run mebius login']);
  }

  const remoteMode = !isLocalApiBase(apiBaseUrl);
  checks.push(['Remote API mode', remoteMode, remoteMode ? 'client paths will not be registered' : 'localhost API']);

  try {
    const target = await normalizeTargetPath(targetPath);
    checks.push(['Workspace path', true, target]);
    checks.push(['Workspace readable/writable', await isWritableDirectory(target), target]);
    checks.push(['Git repository', await isGitRepository(target), target]);
  } catch (error) {
    checks.push(['Workspace path', false, error instanceof Error ? error.message : 'Invalid workspace path']);
  }

  for (const [label, ok, detail] of checks) {
    console.log(`${ok ? 'OK ' : 'ERR'} ${label}: ${detail}`);
  }

  if (checks.some(([, ok]) => !ok)) {
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): ParsedArgs {
  const rest: string[] = [];
  let api: string | undefined;
  let command: string | undefined;
  let targetPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--api') {
      api = args[index + 1];
      index += 1;
      continue;
    }
    if (!command && ['login', 'logout', 'doctor', 'config'].includes(arg)) {
      command = arg;
      continue;
    }
    if (command) {
      rest.push(arg);
      continue;
    }
    if (!targetPath) {
      targetPath = arg;
      continue;
    }
    rest.push(arg);
  }

  return { command, targetPath, api, rest };
}

void main();
