import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

interface BundledParserConfig {
  filetype: string;
  aliases?: string[];
  queries: {
    highlights: string[];
    injections?: string[];
  };
  wasm: string;
  injectionMapping?: {
    nodeTypes?: Record<string, string>;
    infoStringMap?: Record<string, string>;
  };
}

export interface RuntimeFileCheck {
  label: string;
  path: string;
  exists: boolean;
  group: 'worker' | 'dependency' | 'parser';
  parser?: string;
}

export interface BundledOpenTuiRuntimeDiagnostic {
  runtimeDir: string;
  workerPath: string;
  assetsDir: string;
  ok: boolean;
  markdownOk: boolean;
  files: RuntimeFileCheck[];
  missingFiles: RuntimeFileCheck[];
  parserPreload?: {
    ok: boolean;
    markdown: boolean;
    markdownInline: boolean;
    error?: string;
    logs?: string[];
  };
}

const DEFAULT_PARSER_PRELOAD_TIMEOUT_MS = 3000;

export function defaultBundledOpenTuiRuntimeDir(execPath = process.execPath): string {
  return join(dirname(execPath), 'runtime');
}

export function isBundledOpenTuiRuntime(): boolean {
  return process.env.MEBIUS_NATIVE_ENTRY === '1';
}

export function inspectBundledOpenTuiRuntime(
  runtimeDir = defaultBundledOpenTuiRuntimeDir(),
): BundledOpenTuiRuntimeDiagnostic {
  const workerPath = join(runtimeDir, 'parser.worker.js');
  const assetsDir = join(runtimeDir, 'assets');
  const parsers = createBundledParserConfig(assetsDir);
  const files: RuntimeFileCheck[] = [
    createRuntimeFileCheck('TreeSitter worker', workerPath, 'worker'),
    ...webTreeSitterFileChecks(runtimeDir),
    ...parsers.flatMap((parser) => parserFileChecks(parser)),
  ];
  const missingFiles = files.filter((file) => !file.exists);
  const markdownFiles = files.filter(
    (file) => file.parser === 'markdown' || file.parser === 'markdown_inline',
  );
  const runtimeFiles = files.filter((file) => file.group !== 'parser');

  return {
    runtimeDir,
    workerPath,
    assetsDir,
    files,
    missingFiles,
    ok: missingFiles.length === 0,
    markdownOk: runtimeFiles.every((file) => file.exists) && markdownFiles.every((file) => file.exists),
  };
}

export async function configureBundledOpenTuiRuntime(
  runtimeDir = defaultBundledOpenTuiRuntimeDir(),
): Promise<BundledOpenTuiRuntimeDiagnostic> {
  const diagnostic = inspectBundledOpenTuiRuntime(runtimeDir);

  if (existsSync(diagnostic.workerPath) && !process.env.OTUI_TREE_SITTER_WORKER_PATH) {
    process.env.OTUI_TREE_SITTER_WORKER_PATH = diagnostic.workerPath;
  }

  if (!diagnostic.ok) return diagnostic;

  const { addDefaultParsers, clearEnvCache } = await import('@opentui/core');
  clearEnvCache();
  addDefaultParsers(createBundledParserConfig(diagnostic.assetsDir));
  return diagnostic;
}

export async function inspectBundledOpenTuiRuntimeWithParserPreload(
  runtimeDir = defaultBundledOpenTuiRuntimeDir(),
  options: { timeoutMs?: number } = {},
): Promise<BundledOpenTuiRuntimeDiagnostic> {
  const diagnostic = await configureBundledOpenTuiRuntime(runtimeDir);
  if (!diagnostic.ok) return diagnostic;

  const timeoutMs = options.timeoutMs ?? DEFAULT_PARSER_PRELOAD_TIMEOUT_MS;
  const workerLogs: string[] = [];
  let client:
    | {
        initialize(): Promise<void>;
        preloadParser(filetype: string): Promise<boolean>;
        destroy(): Promise<void>;
        on?(event: 'worker:log' | 'error' | 'warning', listener: (...args: string[]) => void): void;
      }
    | undefined;

  try {
    const { getTreeSitterClient } = await import('@opentui/core');
    client = getTreeSitterClient();
    client.on?.('worker:log', (logType, message) => {
      workerLogs.push(`${logType}: ${message}`);
    });
    client.on?.('error', (message) => {
      workerLogs.push(`error: ${message}`);
    });
    client.on?.('warning', (message) => {
      workerLogs.push(`warning: ${message}`);
    });

    const [markdown, markdownInline] = await withTimeout(
      (async () => {
        await client.initialize();
        return Promise.all([client.preloadParser('markdown'), client.preloadParser('markdown_inline')]);
      })(),
      timeoutMs,
      `timed out after ${timeoutMs}ms`,
    );
    return {
      ...diagnostic,
      parserPreload: {
        ok: markdown && markdownInline,
        markdown,
        markdownInline,
        logs: workerLogs,
      },
      markdownOk: diagnostic.markdownOk && markdown && markdownInline,
    };
  } catch (error) {
    return {
      ...diagnostic,
      markdownOk: false,
      parserPreload: {
        ok: false,
        markdown: false,
        markdownInline: false,
        error: error instanceof Error ? error.message : String(error),
        logs: workerLogs,
      },
    };
  } finally {
    if (client) {
      await client.destroy().catch(() => undefined);
    }
  }
}

export function formatBundledOpenTuiRuntimeDiagnostic(
  diagnostic: BundledOpenTuiRuntimeDiagnostic,
): string {
  if (diagnostic.ok) {
    return `worker and parser assets found in ${diagnostic.runtimeDir}`;
  }
  return `missing ${formatMissingRuntimeFiles(diagnostic.missingFiles)}`;
}

export function formatBundledMarkdownDiagnostic(
  diagnostic: BundledOpenTuiRuntimeDiagnostic,
): string {
  if (diagnostic.parserPreload?.error) {
    return joinParserPreloadDetails(
      `parser preload failed: ${diagnostic.parserPreload.error}`,
      diagnostic.parserPreload.logs,
    );
  }
  if (diagnostic.parserPreload && !diagnostic.parserPreload.ok) {
    const missing = [
      diagnostic.parserPreload.markdown ? undefined : 'markdown',
      diagnostic.parserPreload.markdownInline ? undefined : 'markdown_inline',
    ].filter((value): value is string => value !== undefined);
    return joinParserPreloadDetails(
      `parser preload failed for ${missing.join(', ')}`,
      diagnostic.parserPreload.logs,
    );
  }
  if (diagnostic.markdownOk) {
    return diagnostic.parserPreload
      ? 'markdown and markdown_inline parsers loaded'
      : 'markdown and markdown_inline parser assets found';
  }
  const missing = diagnostic.missingFiles.filter(
    (file) => file.parser === 'markdown' || file.parser === 'markdown_inline',
  );
  if (missing.length === 0) {
    const runtimeMissing = diagnostic.missingFiles.filter((file) => file.group !== 'parser');
    return `runtime prerequisites missing: ${formatMissingRuntimeFiles(runtimeMissing)}`;
  }
  return `missing ${formatMissingRuntimeFiles(missing)}`;
}

export function createBundledParserConfig(assetsDir: string): BundledParserConfig[] {
  const languageMap = {
    javascript: 'javascript',
    js: 'javascript',
    jsx: 'javascriptreact',
    javascriptreact: 'javascriptreact',
    typescript: 'typescript',
    ts: 'typescript',
    tsx: 'typescriptreact',
    typescriptreact: 'typescriptreact',
    markdown: 'markdown',
    md: 'markdown',
  };

  return [
    {
      filetype: 'javascript',
      aliases: ['javascriptreact'],
      queries: {
        highlights: [join(assetsDir, 'javascript', 'highlights.scm')],
      },
      wasm: join(assetsDir, 'javascript', 'tree-sitter-javascript.wasm'),
    },
    {
      filetype: 'typescript',
      aliases: ['typescriptreact'],
      queries: {
        highlights: [join(assetsDir, 'typescript', 'highlights.scm')],
      },
      wasm: join(assetsDir, 'typescript', 'tree-sitter-typescript.wasm'),
    },
    {
      filetype: 'markdown',
      queries: {
        highlights: [join(assetsDir, 'markdown', 'highlights.scm')],
        injections: [join(assetsDir, 'markdown', 'injections.scm')],
      },
      wasm: join(assetsDir, 'markdown', 'tree-sitter-markdown.wasm'),
      injectionMapping: {
        nodeTypes: {
          inline: 'markdown_inline',
          pipe_table_cell: 'markdown_inline',
        },
        infoStringMap: languageMap,
      },
    },
    {
      filetype: 'markdown_inline',
      queries: {
        highlights: [join(assetsDir, 'markdown_inline', 'highlights.scm')],
      },
      wasm: join(assetsDir, 'markdown_inline', 'tree-sitter-markdown_inline.wasm'),
    },
    {
      filetype: 'zig',
      queries: {
        highlights: [join(assetsDir, 'zig', 'highlights.scm')],
      },
      wasm: join(assetsDir, 'zig', 'tree-sitter-zig.wasm'),
    },
  ];
}

function parserFileChecks(parser: BundledParserConfig): RuntimeFileCheck[] {
  return [
    createRuntimeFileCheck(`${parser.filetype} wasm`, parser.wasm, 'parser', parser.filetype),
    ...parser.queries.highlights.map((path) =>
      createRuntimeFileCheck(`${parser.filetype} highlights`, path, 'parser', parser.filetype),
    ),
    ...(parser.queries.injections ?? []).map((path) =>
      createRuntimeFileCheck(`${parser.filetype} injections`, path, 'parser', parser.filetype),
    ),
  ];
}

function webTreeSitterFileChecks(runtimeDir: string): RuntimeFileCheck[] {
  const packageDir = join(runtimeDir, 'node_modules', 'web-tree-sitter');
  return [
    createRuntimeFileCheck('web-tree-sitter package', join(packageDir, 'package.json'), 'dependency'),
    createRuntimeFileCheck('web-tree-sitter runtime', join(packageDir, 'tree-sitter.js'), 'dependency'),
    createRuntimeFileCheck('web-tree-sitter wasm', join(packageDir, 'tree-sitter.wasm'), 'dependency'),
  ];
}

function createRuntimeFileCheck(
  label: string,
  path: string,
  group: RuntimeFileCheck['group'],
  parser?: string,
): RuntimeFileCheck {
  return {
    label,
    path,
    group,
    parser,
    exists: existsSync(path),
  };
}

function formatMissingRuntimeFiles(files: RuntimeFileCheck[]): string {
  if (files.length === 0) return 'no files';
  return files.map((file) => `${file.label}: ${file.path}`).join('; ');
}

function joinParserPreloadDetails(message: string, logs?: string[]): string {
  const relevantLogs = logs?.filter((log) => log.trim()).slice(-3) ?? [];
  if (relevantLogs.length === 0) return message;
  return `${message}; ${relevantLogs.join('; ')}`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
