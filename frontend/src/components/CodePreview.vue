<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import DOMPurify from 'dompurify';
import type { HighlighterCore } from '@shikijs/core';
import { Check, Clipboard, Code2, FileWarning, Loader2 } from 'lucide-vue-next';

const highlightedLanguages = new Set([
  'css',
  'dockerfile',
  'html',
  'javascript',
  'json',
  'jsx',
  'markdown',
  'powershell',
  'python',
  'scss',
  'shellscript',
  'sql',
  'text',
  'tsx',
  'typescript',
  'vue',
  'yaml',
]);

let highlighterPromise: Promise<HighlighterCore> | null = null;

const props = withDefaults(
  defineProps<{
    path: string;
    content: string;
    size: number;
    loading?: boolean;
    error?: string;
    copyLabel: string;
    copiedLabel: string;
    loadingLabel: string;
    lineLabel: string;
    bytesLabel: string;
  }>(),
  {
    loading: false,
    error: '',
  },
);

const highlightedHtml = ref('');
const highlightedLanguage = ref('text');
const highlighting = ref(false);
const copied = ref(false);
let highlightRun = 0;
let copiedTimer: number | null = null;

const fileName = computed(() => props.path.split(/[\\/]/).pop() || props.path);
const lineCount = computed(() => props.content.split(/\r\n|\r|\n/).length);
const languageLabel = computed(() => languageDisplayName(highlightedLanguage.value));
const formattedSize = computed(() => formatBytes(props.size, props.bytesLabel));
const canCopy = computed(() => Boolean(props.content) && !props.loading);

watch(
  () => [props.path, props.content, props.loading] as const,
  () => {
    void renderHighlighted();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (copiedTimer !== null) {
    window.clearTimeout(copiedTimer);
  }
});

async function renderHighlighted() {
  const runId = ++highlightRun;
  if (props.loading) {
    highlightedHtml.value = '';
    return;
  }

  highlighting.value = true;
  const language = normalizeHighlightLanguage(detectLanguage(props.path));

  try {
    const highlighter = await getHighlighter();
    const html = highlighter.codeToHtml(props.content || ' ', {
      lang: language,
      theme: 'light-plus',
    });
    if (runId !== highlightRun) return;
    highlightedLanguage.value = language;
    highlightedHtml.value = DOMPurify.sanitize(html);
  } catch {
    if (runId !== highlightRun) return;
    highlightedLanguage.value = 'text';
    highlightedHtml.value = renderPlainText(props.content);
  } finally {
    if (runId === highlightRun) {
      highlighting.value = false;
    }
  }
}

function getHighlighter() {
  highlighterPromise ??= Promise.all([
    import('@shikijs/core'),
    import('@shikijs/engine-javascript'),
    import('@shikijs/themes/light-plus'),
    import('@shikijs/langs/css'),
    import('@shikijs/langs/dockerfile'),
    import('@shikijs/langs/html'),
    import('@shikijs/langs/javascript'),
    import('@shikijs/langs/json'),
    import('@shikijs/langs/jsx'),
    import('@shikijs/langs/markdown'),
    import('@shikijs/langs/powershell'),
    import('@shikijs/langs/python'),
    import('@shikijs/langs/scss'),
    import('@shikijs/langs/shellscript'),
    import('@shikijs/langs/sql'),
    import('@shikijs/langs/tsx'),
    import('@shikijs/langs/typescript'),
    import('@shikijs/langs/vue'),
    import('@shikijs/langs/yaml'),
  ]).then(
    ([
      { createHighlighterCore },
      { createJavaScriptRegexEngine },
      lightPlus,
      css,
      dockerfile,
      html,
      javascript,
      json,
      jsx,
      markdown,
      powershell,
      python,
      scss,
      shellscript,
      sql,
      tsx,
      typescript,
      vue,
      yaml,
    ]) =>
      createHighlighterCore({
        themes: [lightPlus.default],
        langs: [
          css.default,
          dockerfile.default,
          html.default,
          javascript.default,
          json.default,
          jsx.default,
          markdown.default,
          powershell.default,
          python.default,
          scss.default,
          shellscript.default,
          sql.default,
          tsx.default,
          typescript.default,
          vue.default,
          yaml.default,
        ],
        engine: createJavaScriptRegexEngine(),
      }),
  );

  return highlighterPromise;
}

function normalizeHighlightLanguage(language: string) {
  return highlightedLanguages.has(language) ? language : 'text';
}

async function copyContent() {
  if (!canCopy.value) return;
  await navigator.clipboard.writeText(props.content);
  copied.value = true;
  if (copiedTimer !== null) {
    window.clearTimeout(copiedTimer);
  }
  copiedTimer = window.setTimeout(() => {
    copied.value = false;
  }, 1400);
}

function detectLanguage(path: string) {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  const byName: Record<string, string> = {
    dockerfile: 'dockerfile',
    makefile: 'make',
    '.env': 'dotenv',
    '.gitignore': 'ignore',
  };
  const byExtension: Record<string, string> = {
    c: 'c',
    cpp: 'cpp',
    cs: 'csharp',
    css: 'css',
    go: 'go',
    h: 'c',
    html: 'html',
    java: 'java',
    js: 'javascript',
    json: 'json',
    jsx: 'jsx',
    kt: 'kotlin',
    md: 'markdown',
    php: 'php',
    ps1: 'powershell',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    scss: 'scss',
    sh: 'shellscript',
    sql: 'sql',
    swift: 'swift',
    ts: 'typescript',
    tsx: 'tsx',
    txt: 'text',
    vue: 'vue',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
  };

  return byName[name] ?? byExtension[extension] ?? 'text';
}

function languageDisplayName(language: string) {
  const labels: Record<string, string> = {
    c: 'C',
    cpp: 'C++',
    csharp: 'C#',
    css: 'CSS',
    dockerfile: 'Dockerfile',
    dotenv: 'ENV',
    go: 'Go',
    html: 'HTML',
    ignore: 'Ignore',
    java: 'Java',
    javascript: 'JavaScript',
    json: 'JSON',
    jsx: 'JSX',
    kotlin: 'Kotlin',
    make: 'Make',
    markdown: 'Markdown',
    php: 'PHP',
    powershell: 'PowerShell',
    python: 'Python',
    ruby: 'Ruby',
    rust: 'Rust',
    scss: 'SCSS',
    shellscript: 'Shell',
    sql: 'SQL',
    swift: 'Swift',
    text: 'Text',
    typescript: 'TypeScript',
    tsx: 'TSX',
    vue: 'Vue',
    xml: 'XML',
    yaml: 'YAML',
  };

  return labels[language] ?? language;
}

function formatBytes(size: number, bytesLabel: string) {
  if (!Number.isFinite(size) || size < 0) return `0 ${bytesLabel}`;
  if (size < 1024) return `${size} ${bytesLabel}`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function renderPlainText(content: string) {
  const lines = (content || ' ').split(/\r\n|\r|\n/);
  const renderedLines = lines
    .map((line) => `<span class="line">${escapeHtml(line) || ' '}</span>`)
    .join('\n');

  return `<pre class="shiki light-plus code-preview__fallback" tabindex="0"><code>${renderedLines}</code></pre>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
</script>

<template>
  <section class="code-preview" :class="{ 'is-loading': loading || highlighting }">
    <header class="code-preview__header">
      <div class="min-w-0 flex items-center gap-2">
        <span class="code-preview__file-icon">
          <n-icon><Code2 /></n-icon>
        </span>
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold text-slate-950" :title="path">{{ fileName }}</div>
          <div class="truncate text-[11px] text-slate-500" :title="path">{{ path }}</div>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <span class="code-preview__chip">{{ languageLabel }}</span>
        <span class="code-preview__chip">{{ lineCount }} {{ lineLabel }}</span>
        <span class="code-preview__chip">{{ formattedSize }}</span>
        <n-button
          circle
          secondary
          size="small"
          :disabled="!canCopy"
          :title="copied ? copiedLabel : copyLabel"
          :aria-label="copied ? copiedLabel : copyLabel"
          @click="copyContent"
        >
          <template #icon>
            <n-icon>
              <Check v-if="copied" />
              <Clipboard v-else />
            </n-icon>
          </template>
        </n-button>
      </div>
    </header>

    <div v-if="loading" class="code-preview__state">
      <n-icon class="animate-spin"><Loader2 /></n-icon>
      <span>{{ loadingLabel }}</span>
    </div>
    <div v-else-if="error" class="code-preview__state code-preview__state--error">
      <n-icon><FileWarning /></n-icon>
      <span>{{ error }}</span>
    </div>
    <div
      v-else
      class="code-preview__scroller scrollbar-thin"
      v-html="highlightedHtml"
    />
  </section>
</template>

<style scoped>
.code-preview {
  background:
    linear-gradient(180deg, rgb(255 255 255 / 92%), rgb(248 250 252 / 96%)),
    radial-gradient(circle at top right, rgb(20 184 166 / 10%), transparent 38%);
  border: 1px solid #d8dee8;
  border-radius: 8px;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 72%);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
}

.code-preview__header {
  align-items: center;
  background: #f8fafc;
  border-bottom: 1px solid #d8dee8;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
  padding: 0.65rem 0.75rem;
}

.code-preview__file-icon {
  align-items: center;
  background: #e6f6f2;
  border: 1px solid #b8e6dc;
  border-radius: 6px;
  color: #0f766e;
  display: inline-flex;
  height: 28px;
  justify-content: center;
  width: 28px;
}

.code-preview__chip {
  background: #eef2f7;
  border: 1px solid #dce3ed;
  border-radius: 999px;
  color: #475569;
  font-size: 11px;
  line-height: 1;
  padding: 0.32rem 0.48rem;
  white-space: nowrap;
}

.code-preview__state {
  align-items: center;
  color: #64748b;
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  min-height: 180px;
  padding: 1.5rem;
  text-align: center;
}

.code-preview__state--error {
  color: #b42318;
}

.code-preview__scroller {
  background: #ffffff;
  min-height: 0;
  overflow: auto;
}

.code-preview__scroller :deep(.shiki) {
  background: #ffffff !important;
  border: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.65;
  margin: 0;
  min-height: 100%;
  min-width: max-content;
  padding: 0.85rem 0;
}

.code-preview__scroller :deep(.shiki code) {
  counter-reset: code-line;
  display: block;
}

.code-preview__scroller :deep(.shiki .line) {
  counter-increment: code-line;
  display: block;
  min-height: 1.65em;
  padding: 0 1rem 0 3.75rem;
  position: relative;
  white-space: pre;
}

.code-preview__scroller :deep(.shiki .line)::before {
  border-right: 1px solid #e2e8f0;
  color: #94a3b8;
  content: counter(code-line);
  font-variant-numeric: tabular-nums;
  left: 0;
  padding-right: 0.7rem;
  position: absolute;
  text-align: right;
  user-select: none;
  width: 2.9rem;
}

.code-preview__scroller :deep(.shiki .line:hover) {
  background: #f8fafc;
}
</style>
