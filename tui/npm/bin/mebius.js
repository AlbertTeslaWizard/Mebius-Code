#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const platform = process.platform;
const arch = process.arch;
const executable = platform === 'win32' ? 'mebius.exe' : 'mebius';
const binary = join(packageRoot, 'vendor', `${platform}-${arch}`, executable);

if (!existsSync(binary)) {
  console.error(`Mebius binary is missing for ${platform}-${arch}.`);
  console.error('Try reinstalling with: npm install -g mebius-code@latest');
  process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 0);
