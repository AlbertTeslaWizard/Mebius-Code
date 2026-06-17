#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

const packagesByTarget = {
  'win32-x64': { name: '@albert_tesla/mebius-code-win32-x64', executable: 'mebius.exe' },
  'linux-x64': { name: '@albert_tesla/mebius-code-linux-x64', executable: 'mebius' },
  'darwin-x64': { name: '@albert_tesla/mebius-code-darwin-x64', executable: 'mebius' },
  'darwin-arm64': { name: '@albert_tesla/mebius-code-darwin-arm64', executable: 'mebius' },
};

const target = `${process.platform}-${process.arch}`;
const platformPackage = packagesByTarget[target];

if (!platformPackage) {
  console.error(`Mebius Code does not publish a native binary for ${target}.`);
  console.error('Supported targets: win32-x64, linux-x64, darwin-x64, darwin-arm64.');
  process.exit(1);
}

const binary = resolveBinary(platformPackage);
if (!binary || !existsSync(binary)) {
  console.error(`Mebius Code native package is missing: ${platformPackage.name}.`);
  console.error('Reinstall with optional dependencies enabled: npm install -g mebius-code@latest');
  process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.signal) {
  process.kill(process.pid, result.signal);
}

process.exit(result.status ?? 0);

function resolveBinary({ name, executable }) {
  try {
    const packageJson = require.resolve(`${name}/package.json`);
    return join(dirname(packageJson), 'bin', executable);
  } catch {
    return undefined;
  }
}
