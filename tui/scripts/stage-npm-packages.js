#!/usr/bin/env node
import { chmod, copyFile, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const inputDir = resolve(packageDir, args.input ?? 'dist/native-artifacts');
const outputDir = resolve(packageDir, args.output ?? 'dist/npm');
const sourcePackage = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));

const platformPackages = [
  {
    name: '@albert_tesla/mebius-code-win32-x64',
    os: 'win32',
    cpu: 'x64',
    executable: 'mebius.exe',
  },
  {
    name: '@albert_tesla/mebius-code-linux-x64',
    os: 'linux',
    cpu: 'x64',
    executable: 'mebius',
  },
  {
    name: '@albert_tesla/mebius-code-darwin-x64',
    os: 'darwin',
    cpu: 'x64',
    executable: 'mebius',
  },
  {
    name: '@albert_tesla/mebius-code-darwin-arm64',
    os: 'darwin',
    cpu: 'arm64',
    executable: 'mebius',
  },
];

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await stageMainPackage();
await Promise.all(platformPackages.map(stagePlatformPackage));

console.log(`Staged npm packages in ${outputDir}`);

async function stageMainPackage() {
  const destination = join(outputDir, sourcePackage.name);
  await mkdir(join(destination, 'bin'), { recursive: true });
  await copyFile(join(packageDir, 'bin', 'mebius.js'), join(destination, 'bin', 'mebius.js'));
  await chmod(join(destination, 'bin', 'mebius.js'), 0o755);
  await copyFile(join(packageDir, 'README.md'), join(destination, 'README.md'));
  await writeJson(join(destination, 'package.json'), {
    name: sourcePackage.name,
    version: sourcePackage.version,
    description: sourcePackage.description,
    license: sourcePackage.license,
    type: sourcePackage.type,
    repository: sourcePackage.repository,
    bin: sourcePackage.bin,
    files: sourcePackage.files,
    optionalDependencies: Object.fromEntries(
      platformPackages.map((platformPackage) => [platformPackage.name, sourcePackage.version]),
    ),
    publishConfig: sourcePackage.publishConfig,
    engines: sourcePackage.engines,
  });
}

async function stagePlatformPackage(platformPackage) {
  const destination = join(outputDir, packageDirectoryName(platformPackage.name));
  const binarySource = join(inputDir, packageDirectoryName(platformPackage.name), platformPackage.executable);
  const binaryDestination = join(destination, 'bin', platformPackage.executable);
  const runtimeSource = join(inputDir, packageDirectoryName(platformPackage.name), 'runtime');
  const runtimeDestination = join(destination, 'bin', 'runtime');

  await mkdir(join(destination, 'bin'), { recursive: true });
  await copyFile(binarySource, binaryDestination);
  await cp(runtimeSource, runtimeDestination, { recursive: true });
  if (platformPackage.os !== 'win32') {
    await chmod(binaryDestination, 0o755);
  }
  await writeJson(join(destination, 'package.json'), {
    name: platformPackage.name,
    version: sourcePackage.version,
    description: `Native binary for Mebius Code (${platformPackage.os}-${platformPackage.cpu}).`,
    license: sourcePackage.license,
    repository: sourcePackage.repository,
    os: [platformPackage.os],
    cpu: [platformPackage.cpu],
    files: ['bin'],
    publishConfig: sourcePackage.publishConfig,
  });
}

function packageDirectoryName(packageName) {
  return packageName.replace(/^@/, '').replace('/', '__');
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === '--input' || arg === '--output') {
      const next = rawArgs[index + 1];
      if (!next) {
        throw new Error(`Missing value for ${arg}`);
      }
      parsed[arg.slice(2)] = next;
      index += 1;
      continue;
    }
    if (arg.startsWith('--input=')) {
      parsed.input = arg.slice('--input='.length);
      continue;
    }
    if (arg.startsWith('--output=')) {
      parsed.output = arg.slice('--output='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}
