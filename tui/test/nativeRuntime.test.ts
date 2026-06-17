import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'bun:test';
import {
  createBundledParserConfig,
  formatBundledMarkdownDiagnostic,
  formatBundledOpenTuiRuntimeDiagnostic,
  inspectBundledOpenTuiRuntime,
} from '../src/nativeRuntime';

describe('bundled OpenTUI runtime diagnostics', () => {
  it('reports the bundled runtime as available when worker and parser files exist', async () => {
    const runtimeDir = await createRuntimeFixture();

    const diagnostic = inspectBundledOpenTuiRuntime(runtimeDir);

    expect(diagnostic.ok).toBe(true);
    expect(diagnostic.markdownOk).toBe(true);
    expect(formatBundledOpenTuiRuntimeDiagnostic(diagnostic)).toContain('worker and parser assets found');
    expect(formatBundledMarkdownDiagnostic(diagnostic)).toBe('markdown and markdown_inline parser assets found');
  });

  it('reports missing markdown parser files explicitly', async () => {
    const runtimeDir = await createRuntimeFixture({
      skip: new Set(['markdown_inline:wasm']),
    });

    const diagnostic = inspectBundledOpenTuiRuntime(runtimeDir);

    expect(diagnostic.ok).toBe(false);
    expect(diagnostic.markdownOk).toBe(false);
    expect(formatBundledMarkdownDiagnostic(diagnostic)).toContain('markdown_inline wasm');
    expect(formatBundledMarkdownDiagnostic(diagnostic)).toContain('tree-sitter-markdown_inline.wasm');
  });

  it('formats parser preload failures explicitly', async () => {
    const runtimeDir = await createRuntimeFixture();
    const diagnostic = {
      ...inspectBundledOpenTuiRuntime(runtimeDir),
      markdownOk: false,
      parserPreload: {
        ok: false,
        markdown: true,
        markdownInline: false,
      },
    };

    expect(formatBundledMarkdownDiagnostic(diagnostic)).toBe('parser preload failed for markdown_inline');
  });

  it('formats parser preload timeouts explicitly', async () => {
    const runtimeDir = await createRuntimeFixture();
    const diagnostic = {
      ...inspectBundledOpenTuiRuntime(runtimeDir),
      markdownOk: false,
      parserPreload: {
        ok: false,
        markdown: false,
        markdownInline: false,
        error: 'timed out after 3000ms',
      },
    };

    expect(formatBundledMarkdownDiagnostic(diagnostic)).toBe('parser preload failed: timed out after 3000ms');
  });
});

async function createRuntimeFixture(options: { skip?: Set<string> } = {}): Promise<string> {
  const runtimeDir = join(tmpdir(), `mebius-runtime-${crypto.randomUUID()}`);
  await writeFixtureFile(join(runtimeDir, 'parser.worker.js'));
  await writeFixtureFile(join(runtimeDir, 'node_modules', 'web-tree-sitter', 'package.json'));
  await writeFixtureFile(join(runtimeDir, 'node_modules', 'web-tree-sitter', 'tree-sitter.js'));
  await writeFixtureFile(join(runtimeDir, 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm'));
  const assetsDir = join(runtimeDir, 'assets');

  for (const parser of createBundledParserConfig(assetsDir)) {
    if (!options.skip?.has(`${parser.filetype}:wasm`)) {
      await writeFixtureFile(parser.wasm);
    }
    for (const path of parser.queries.highlights) {
      if (!options.skip?.has(`${parser.filetype}:highlights`)) {
        await writeFixtureFile(path);
      }
    }
    for (const path of parser.queries.injections ?? []) {
      if (!options.skip?.has(`${parser.filetype}:injections`)) {
        await writeFixtureFile(path);
      }
    }
  }

  return runtimeDir;
}

async function writeFixtureFile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, '');
}
