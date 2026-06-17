import '@opentui/solid/preload';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

process.env.MEBIUS_NATIVE_ENTRY = '1';

await configureOpenTuiRuntime();

const { main } = await import('./cli');
await main();

async function configureOpenTuiRuntime() {
  const runtimeDir = join(dirname(process.execPath), 'runtime');
  const workerPath = join(runtimeDir, 'parser.worker.js');
  if (existsSync(workerPath) && !process.env.OTUI_TREE_SITTER_WORKER_PATH) {
    process.env.OTUI_TREE_SITTER_WORKER_PATH = workerPath;
  }

  const assetsDir = join(runtimeDir, 'assets');
  const parsers = createBundledParserConfig(assetsDir);
  if (!parsers.every(hasParserFiles)) return;

  const { addDefaultParsers } = await import('@opentui/core');
  addDefaultParsers(parsers);
}

function createBundledParserConfig(assetsDir: string) {
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

function hasParserFiles(parser: ReturnType<typeof createBundledParserConfig>[number]) {
  return (
    existsSync(parser.wasm) &&
    parser.queries.highlights.every((queryPath) => existsSync(queryPath)) &&
    (parser.queries.injections?.every((queryPath) => existsSync(queryPath)) ?? true)
  );
}
