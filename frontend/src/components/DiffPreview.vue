<script setup lang="ts">
import { computed } from 'vue';
import { FileDiff } from 'lucide-vue-next';

const props = withDefaults(
  defineProps<{
    diffText: string;
    path?: string;
    emptyLabel?: string;
  }>(),
  {
    path: '',
    emptyLabel: 'No diff available.',
  },
);

const lines = computed(() =>
  props.diffText
    .split(/\r?\n/)
    .map((text, index) => ({
      id: `${index}-${text}`,
      text,
      kind: diffLineKind(text),
    })),
);

const displayPath = computed(() => props.path || detectPath(props.diffText));

function diffLineKind(text: string) {
  if (text.startsWith('+++') || text.startsWith('---') || text.startsWith('@@')) return 'header';
  if (text.startsWith('+')) return 'added';
  if (text.startsWith('-')) return 'removed';
  return 'context';
}

function detectPath(diffText: string) {
  const line = diffText.split(/\r?\n/).find((item) => item.startsWith('+++ '));
  return line?.replace(/^\+\+\+\s+/, '') ?? '';
}
</script>

<template>
  <section class="diff-preview">
    <header v-if="displayPath" class="diff-preview__header">
      <n-icon><FileDiff /></n-icon>
      <span class="truncate" :title="displayPath">{{ displayPath }}</span>
    </header>
    <div v-if="!diffText" class="diff-preview__empty">{{ emptyLabel }}</div>
    <div v-else class="diff-preview__body scrollbar-thin">
      <div
        v-for="line in lines"
        :key="line.id"
        class="diff-preview__line"
        :class="`is-${line.kind}`"
      >
        <span class="diff-preview__marker">{{ line.text.slice(0, 1) || ' ' }}</span>
        <span class="diff-preview__text">{{ line.text }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.diff-preview {
  background: #ffffff;
  border: 1px solid #d9dee7;
  border-radius: 8px;
  min-height: 0;
  overflow: hidden;
}

.diff-preview__header {
  align-items: center;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  color: #0f172a;
  display: flex;
  font-size: 12px;
  font-weight: 700;
  gap: 0.45rem;
  min-width: 0;
  padding: 0.5rem 0.65rem;
}

.diff-preview__header .n-icon {
  color: #0f766e;
  flex-shrink: 0;
}

.diff-preview__empty {
  color: #64748b;
  font-size: 12px;
  padding: 0.75rem;
}

.diff-preview__body {
  max-height: 280px;
  overflow: auto;
  padding: 0.35rem 0;
}

.diff-preview__line {
  display: grid;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  grid-template-columns: 1.7rem minmax(0, 1fr);
  line-height: 1.55;
  min-width: max-content;
  white-space: pre;
}

.diff-preview__marker {
  color: #94a3b8;
  padding-left: 0.55rem;
  user-select: none;
}

.diff-preview__text {
  padding-right: 0.75rem;
}

.diff-preview__line.is-header {
  background: #f1f5f9;
  color: #475569;
  font-weight: 700;
}

.diff-preview__line.is-added {
  background: #ecfdf3;
  color: #166534;
}

.diff-preview__line.is-removed {
  background: #fef2f2;
  color: #991b1b;
}

.diff-preview__line.is-context {
  color: #334155;
}
</style>
