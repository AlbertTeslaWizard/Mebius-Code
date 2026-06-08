<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { lintKeymap } from '@codemirror/lint';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { vue } from '@codemirror/lang-vue';
import { RotateCcw, Save } from 'lucide-vue-next';

const props = defineProps<{
  path: string;
  content: string;
  dirty: boolean;
  saving: boolean;
  error: string;
  saveLabel: string;
  revertLabel: string;
  unsavedLabel: string;
  savedLabel: string;
  lineLabel: string;
  bytesLabel: string;
}>();

const emit = defineEmits<{
  'update:content': [value: string];
  save: [];
  revert: [];
}>();

const editorHost = ref<HTMLElement | null>(null);
let editor: EditorView | null = null;
let applyingExternalUpdate = false;

const fileName = computed(() => props.path.split(/[\\/]/).pop() || props.path);
const lineCount = computed(() => props.content.split(/\r\n|\r|\n/).length);
const byteCount = computed(() => new TextEncoder().encode(props.content).length);
const statusLabel = computed(() => (props.dirty ? props.unsavedLabel : props.savedLabel));

onMounted(() => {
  mountEditor();
});

onBeforeUnmount(() => {
  editor?.destroy();
  editor = null;
});

watch(
  () => props.path,
  () => {
    remountEditor();
  },
);

watch(
  () => props.content,
  (content) => {
    if (!editor || applyingExternalUpdate || editor.state.doc.toString() === content) return;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: content },
    });
  },
);

function remountEditor() {
  editor?.destroy();
  editor = null;
  void nextTick(() => mountEditor());
}

function mountEditor() {
  if (!editorHost.value) return;

  editor = new EditorView({
    parent: editorHost.value,
    state: EditorState.create({
      doc: props.content,
      extensions: [
        lineNumbers(),
        history(),
        bracketMatching(),
        closeBrackets(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        languageExtension(props.path),
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              emit('save');
              return true;
            },
          },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...closeBracketsKeymap,
          ...searchKeymap,
          ...completionKeymap,
          ...lintKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          applyingExternalUpdate = true;
          emit('update:content', update.state.doc.toString());
          void nextTick(() => {
            applyingExternalUpdate = false;
          });
        }),
        EditorView.theme({
          '&': {
            height: '100%',
            fontSize: '12px',
            backgroundColor: 'var(--workspace-card-bg, #ffffff)',
            color: 'var(--workspace-message-text, #111827)',
          },
          '.cm-scroller': {
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
            lineHeight: '1.6',
          },
          '.cm-content': {
            color: 'var(--workspace-message-text, #111827)',
            padding: '0.75rem 0',
          },
          '.cm-line': {
            padding: '0 0.85rem',
          },
          '.cm-gutters': {
            backgroundColor: 'var(--workspace-card-subtle, #f9fafb)',
            borderRight: '1px solid var(--workspace-card-border, #d1d5db)',
            color: 'var(--workspace-icon-muted, #6b7280)',
          },
          '.cm-activeLine': {
            backgroundColor: 'var(--workspace-hover-bg, #e5f3f1)',
          },
          '.cm-activeLineGutter': {
            backgroundColor: 'var(--workspace-selected-bg, #d2eae5)',
            color: 'var(--workspace-message-muted, #4b5563)',
          },
          '&.cm-focused': {
            outline: 'none',
          },
        }),
      ],
    }),
  });
}

function languageExtension(path: string) {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  if (['js', 'jsx', 'ts', 'tsx'].includes(extension)) {
    return javascript({ jsx: ['jsx', 'tsx'].includes(extension), typescript: ['ts', 'tsx'].includes(extension) });
  }
  if (extension === 'json') return json();
  if (['css', 'scss'].includes(extension)) return css();
  if (['html', 'xml'].includes(extension)) return html();
  if (['md', 'markdown'].includes(extension)) return markdown();
  if (extension === 'py') return python();
  if (extension === 'sql') return sql();
  if (extension === 'vue') return vue();
  return [];
}
</script>

<template>
  <section class="code-editor">
    <header class="code-editor__header">
      <div class="min-w-0">
        <div class="truncate text-sm font-semibold text-mebius-ink" :title="path">{{ fileName }}</div>
        <div class="truncate text-[11px] text-mebius-muted" :title="path">{{ path }}</div>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <span class="code-editor__chip" :class="{ 'is-dirty': dirty }">{{ statusLabel }}</span>
        <span class="code-editor__chip">{{ lineCount }} {{ lineLabel }}</span>
        <span class="code-editor__chip">{{ byteCount }} {{ bytesLabel }}</span>
        <n-button circle secondary size="small" :title="revertLabel" :disabled="!dirty || saving" @click="emit('revert')">
          <template #icon><n-icon><RotateCcw /></n-icon></template>
        </n-button>
        <n-button circle type="primary" size="small" :title="saveLabel" :disabled="!dirty" :loading="saving" @click="emit('save')">
          <template #icon><n-icon><Save /></n-icon></template>
        </n-button>
      </div>
    </header>
    <p v-if="error" class="code-editor__error">{{ error }}</p>
    <div ref="editorHost" class="code-editor__host" />
  </section>
</template>

<style scoped>
.code-editor {
  background: var(--workspace-card-bg, #ffffff);
  border: 1px solid var(--workspace-card-border, #d1d5db);
  border-radius: 8px;
  color: var(--workspace-message-text, #111827);
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
}

.code-editor__header {
  align-items: center;
  background: var(--workspace-card-subtle, #f9fafb);
  border-bottom: 1px solid var(--workspace-card-border, #d1d5db);
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
  padding: 0.65rem 0.75rem;
}

.code-editor__chip {
  background: var(--mebius-code-bg, #f3f4f6);
  border: 1px solid var(--workspace-card-border, #d1d5db);
  border-radius: 999px;
  color: var(--workspace-message-muted, #4b5563);
  font-size: 11px;
  line-height: 1;
  padding: 0.32rem 0.48rem;
  white-space: nowrap;
}

.code-editor__chip.is-dirty {
  background: #fff7ed;
  border-color: #fed7aa;
  color: #c2410c;
}

.code-editor__error {
  background: #fef2f2;
  border-bottom: 1px solid #fecaca;
  color: #b42318;
  font-size: 12px;
  line-height: 1.4;
  margin: 0;
  padding: 0.45rem 0.75rem;
}

.code-editor__host {
  min-height: 0;
  overflow: hidden;
}
</style>
