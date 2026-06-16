#!/usr/bin/env node
import { createWriteStream, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { chmod, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(packageRoot);
const pkg = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
const platform = process.platform;
const arch = process.arch;
const target = `${platform}-${arch}`;
const asset = assetName(platform, arch);

if (!asset) {
  console.error(`Mebius does not publish a native binary for ${target}.`);
  process.exit(1);
}

const version = process.env.MEBIUS_CODE_VERSION ?? pkg.version;
const releaseBase =
  process.env.MEBIUS_CODE_RELEASE_BASE_URL ??
  releaseBaseForVersion(version);
const vendorDir = join(projectRoot, 'vendor', target);
const tmpRoot = mkdtempSync(join(tmpdir(), 'mebius-code-'));
const archivePath = join(tmpRoot, asset);
const sumsPath = join(tmpRoot, 'SHA256SUMS');

try {
  mkdirSync(vendorDir, { recursive: true });
  await download(`${releaseBase}/${asset}`, archivePath);
  await download(`${releaseBase}/SHA256SUMS`, sumsPath);
  await verifyChecksum(asset, archivePath, sumsPath);
  rmSync(vendorDir, { recursive: true, force: true });
  mkdirSync(vendorDir, { recursive: true });
  extractArchive(archivePath, vendorDir, platform);

  if (platform !== 'win32') {
    await chmod(join(vendorDir, 'mebius'), 0o755);
  }
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}

function assetName(currentPlatform, currentArch) {
  if (currentPlatform === 'linux' && currentArch === 'x64') return 'mebius-linux-x64.tar.gz';
  if (currentPlatform === 'darwin' && currentArch === 'x64') return 'mebius-darwin-x64.tar.gz';
  if (currentPlatform === 'darwin' && currentArch === 'arm64') return 'mebius-darwin-arm64.tar.gz';
  if (currentPlatform === 'win32' && currentArch === 'x64') return 'mebius-windows-x64.zip';
  return undefined;
}

function releaseBaseForVersion(currentVersion) {
  if (currentVersion === 'latest') {
    return 'https://github.com/AlbertTeslaWizard/Mebius-Code/releases/latest/download';
  }

  const tag = currentVersion.startsWith('v') ? currentVersion : `v${currentVersion}`;
  return `https://github.com/AlbertTeslaWizard/Mebius-Code/releases/download/${tag}`;
}

async function download(url, outputPath) {
  await pipeline(await get(url), createWriteStream(outputPath));
}

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          if (redirects > 5) {
            reject(new Error(`Too many redirects while downloading ${url}`));
            return;
          }
          resolve(get(new URL(response.headers.location, url).toString(), redirects + 1));
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Download failed (${response.statusCode}) for ${url}`));
          return;
        }
        resolve(response);
      })
      .on('error', reject);
  });
}

async function verifyChecksum(fileName, filePath, sumsFile) {
  const sums = await readFile(sumsFile, 'utf8');
  const line = sums.split(/\r?\n/).find((entry) => entry.endsWith(`  ${fileName}`));
  if (!line) {
    throw new Error(`No checksum entry found for ${fileName}`);
  }
  const expected = line.slice(0, 64);
  const actual = createHash('sha256').update(await readFile(filePath)).digest('hex');
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${fileName}`);
  }
}

function extractArchive(archive, destination, currentPlatform) {
  if (currentPlatform === 'win32') {
    run('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${destination.replaceAll(
        "'",
        "''",
      )}' -Force`,
    ]);
    return;
  }
  run('tar', ['-xzf', archive, '-C', destination]);
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}
