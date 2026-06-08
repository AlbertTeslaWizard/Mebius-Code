import { access, constants, stat } from 'fs/promises';
import { resolve } from 'path';
import { spawn } from 'child_process';

export function isLocalApiBase(apiBaseUrl: string): boolean {
  try {
    const url = new URL(apiBaseUrl);
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export async function normalizeTargetPath(value: string | undefined): Promise<string> {
  const target = resolve(value ?? process.cwd());
  const info = await stat(target);
  if (!info.isDirectory()) {
    throw new Error(`Workspace path is not a directory: ${target}`);
  }
  return target;
}

export async function isWritableDirectory(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function isGitRepository(path: string): Promise<boolean> {
  const result = await runProcess('git', ['rev-parse', '--is-inside-work-tree'], path);
  return result.exitCode === 0 && result.stdout.trim() === 'true';
}

export async function bunAvailable(): Promise<boolean> {
  const result = await runProcess('bun', ['--version'], process.cwd());
  return result.exitCode === 0;
}

function runProcess(command: string, args: string[], cwd: string): Promise<{ exitCode: number; stdout: string }> {
  return new Promise((resolveProcess) => {
    const child = spawn(command, args, { cwd, shell: false });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on('error', () => {
      resolveProcess({ exitCode: 1, stdout });
    });
    child.on('close', (code) => {
      resolveProcess({ exitCode: code ?? 1, stdout });
    });
  });
}
