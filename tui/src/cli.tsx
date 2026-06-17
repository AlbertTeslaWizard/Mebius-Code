#!/usr/bin/env bun
/** @jsxImportSource @opentui/solid */
import { render } from '@opentui/solid';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { ApiClient } from './api/client';
import { bootstrapWorkspace } from './bootstrap';
import { App } from './app/App';
import {
  configCommand,
  configWithApiBaseUrl,
  describeApiMode,
  startupFailureHints,
  webRegisterUrl,
} from './cli-config';
import { clearToken, DEFAULT_API_BASE_URL, loadConfig, saveConfig, TUI_VERSION } from './config';
import {
  bunAvailable,
  isGitRepository,
  isLocalApiBase,
  isWritableDirectory,
  normalizeTargetPath,
  openExternalUrl,
} from './runtime';
import {
  formatBundledMarkdownDiagnostic,
  formatBundledOpenTuiRuntimeDiagnostic,
  inspectBundledOpenTuiRuntimeWithParserPreload,
  isBundledOpenTuiRuntime,
} from './nativeRuntime';

interface ParsedArgs {
  command?: string;
  targetPath?: string;
  api?: string;
  version?: boolean;
  rest: string[];
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.version) {
    console.log(TUI_VERSION);
    return;
  }

  if (args.command === 'login') {
    await login(args.api);
    return;
  }
  if (args.command === 'register') {
    await register(args.api);
    return;
  }
  if (args.command === 'pair') {
    await pairDevice(args.api);
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
    console.error(`Mebius could not start with API ${apiBaseUrl}: ${message}`);
    for (const hint of startupFailureHints(apiBaseUrl)) {
      console.error(hint);
    }
    console.error('Run `mebius doctor` for diagnostics.');
    process.exitCode = 1;
  }
}

async function login(apiOverride?: string) {
  const config = await loadConfig();
  const apiBaseUrl = apiOverride ?? config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const api = new ApiClient(apiBaseUrl);
  const capabilities = await api.capabilities();
  if (isLocalApiBase(apiBaseUrl) && capabilities.features.localOwnerAuth) {
    const auth = await api.localBootstrapToken();
    const nextConfig = apiOverride ? configWithApiBaseUrl(config, apiBaseUrl) : { ...config, apiBaseUrl };
    await saveConfig({
      ...nextConfig,
      accessToken: auth.accessToken,
    });
    console.log(`Connected to local API as ${auth.user.nickname}.`);
    console.log(`API saved: ${apiBaseUrl}`);
    return;
  }

  const rl = createInterface({ input, output });
  try {
    const email = await rl.question('Email: ');
    const password = await rl.question('Password: ');
    const auth = await api.login(email.trim(), password);
    const nextConfig = apiOverride ? configWithApiBaseUrl(config, apiBaseUrl) : { ...config, apiBaseUrl };
    await saveConfig({
      ...nextConfig,
      accessToken: auth.accessToken,
    });
    console.log(`Logged in as ${auth.user.email}.`);
    console.log(`API saved: ${apiBaseUrl}`);
  } finally {
    rl.close();
  }
}

async function register(apiOverride?: string) {
  const config = await loadConfig();
  const apiBaseUrl = apiOverride ?? config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  if (isLocalApiBase(apiBaseUrl)) {
    console.log('Local API mode does not use Web account registration.');
    console.log(`Run \`mebius login --api ${apiBaseUrl}\` on this machine to connect as the local owner.`);
    console.log('Run `mebius pair` after that to connect Android.');
    return;
  }

  const url = webRegisterUrl(apiBaseUrl);
  const opened = await openExternalUrl(url).catch(() => false);
  console.log(opened ? `Opened Web registration: ${url}` : `Create an account in the Web app: ${url}`);
}

async function pairDevice(apiOverride?: string) {
  const config = await loadConfig();
  const apiBaseUrl = apiOverride ?? config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  if (!isLocalApiBase(apiBaseUrl)) {
    console.error('Device pairing is for local API mode only.');
    console.error(`Current API: ${apiBaseUrl}`);
    process.exitCode = 1;
    return;
  }

  let token = apiOverride ? undefined : config.accessToken;
  let api = new ApiClient(apiBaseUrl, token);
  const capabilities = await api.capabilities();
  if (!capabilities.features.devicePairing) {
    console.error('This backend does not support local device pairing.');
    process.exitCode = 1;
    return;
  }

  if (token) {
    try {
      await api.me();
    } catch {
      token = undefined;
      api = new ApiClient(apiBaseUrl);
    }
  }

  if (!token) {
    const auth = await new ApiClient(apiBaseUrl).localBootstrapToken();
    token = auth.accessToken;
    api = api.withToken(token);
    const nextConfig = apiOverride ? configWithApiBaseUrl(config, apiBaseUrl) : { ...config, apiBaseUrl };
    await saveConfig({
      ...nextConfig,
      accessToken: token,
    });
  }

  const pairing = await api.createLocalPairingCode();
  console.log(`Android pairing code: ${pairing.code}`);
  console.log(`Expires in ${Math.round(pairing.expiresInSeconds / 60)} minutes.`);
}

async function doctor(apiOverride?: string, targetPath?: string) {
  const config = await loadConfig();
  const apiBaseUrl = apiOverride ?? config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const diagnosticToken = apiOverride ? undefined : config.accessToken;
  const api = new ApiClient(apiBaseUrl, diagnosticToken);
  const checks: Array<[string, boolean, string]> = [];

  const bunOk = await bunAvailable();
  checks.push(['TUI version', true, TUI_VERSION]);
  checks.push(['Bun available', bunOk, bunOk ? 'available' : 'Install Bun from https://bun.sh']);
  checks.push(['API mode', true, describeApiMode(apiBaseUrl)]);
  if (isBundledOpenTuiRuntime()) {
    const runtimeDiagnostic = await inspectBundledOpenTuiRuntimeWithParserPreload();
    checks.push(['OpenTUI runtime', runtimeDiagnostic.ok, formatBundledOpenTuiRuntimeDiagnostic(runtimeDiagnostic)]);
    checks.push(['Markdown parser', runtimeDiagnostic.markdownOk, formatBundledMarkdownDiagnostic(runtimeDiagnostic)]);
  } else {
    checks.push(['OpenTUI runtime', true, 'source runtime; native parser assets are checked in release builds']);
  }

  let capabilities: Awaited<ReturnType<ApiClient['capabilities']>> | null = null;
  try {
    capabilities = await api.capabilities();
    checks.push(['API reachable', true, apiBaseUrl]);
  } catch (error) {
    checks.push(['API reachable', false, error instanceof Error ? error.message : 'API request failed']);
    for (const hint of startupFailureHints(apiBaseUrl)) {
      checks.push(['API hint', false, hint]);
    }
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

  if (diagnosticToken && capabilities) {
    try {
      const user = await api.me();
      checks.push(['Logged in', true, `${user.email} (${user.role})`]);
    } catch (error) {
      checks.push(['Logged in', false, 'Saved token is invalid or expired']);
    }
  } else if (diagnosticToken) {
    checks.push(['Logged in', false, 'Cannot verify saved token until the API is reachable']);
  } else {
    checks.push([
      'Logged in',
      false,
      isLocalApiBase(apiBaseUrl) ? 'Run mebius login for local owner access' : 'Run mebius login',
    ]);
  }

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

export function parseArgs(args: string[]): ParsedArgs {
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
    if (arg === '--version' || arg === '-v') {
      return { command, targetPath, api, version: true, rest };
    }
    if (!command && ['login', 'register', 'pair', 'logout', 'doctor', 'config'].includes(arg)) {
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

  return { command, targetPath, api, version: false, rest };
}

function isDirectRun(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(entry) === fileURLToPath(importMetaUrl);
}

if (!process.env.MEBIUS_NATIVE_ENTRY && isDirectRun(import.meta.url)) {
  void main();
}
