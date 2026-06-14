<script setup lang="ts">
import { computed } from 'vue';
import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';

const props = defineProps<{
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  metadata?: Record<string, unknown>;
}>();

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false,
});

const renderedMarkdown = computed(() => DOMPurify.sanitize(markdown.render(props.content)));

const parsedToolContent = computed<Record<string, unknown> | null>(() => {
  try {
    const parsed = JSON.parse(props.content) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
});

const toolName = computed(() => stringValue(props.metadata?.toolName) || inferToolName());
const toolStatus = computed(() => stringValue(props.metadata?.status));
const toolDetail = computed(() => {
  return (
    stringValue(props.metadata?.query) ||
    stringValue(parsedToolContent.value?.query) ||
    stringValue(props.metadata?.command) ||
    stringValue(parsedToolContent.value?.command) ||
    listValue(props.metadata?.targetPaths).join(', ') ||
    stringValue(parsedToolContent.value?.provider) ||
    compactPreview(props.content)
  );
});

const toolSummary = computed(() => {
  return [toolName.value || 'Tool result', toolDetail.value, toolStatus.value].filter(Boolean).join(' · ');
});

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function listValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function inferToolName(): string {
  if (parsedToolContent.value?.query || parsedToolContent.value?.provider) return 'web_search';
  return '';
}

function compactPreview(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.length > 96 ? `${compact.slice(0, 96)}...` : compact;
}
</script>

<template>
  <div
    v-if="role === 'assistant'"
    class="markdown-body text-sm leading-6"
    v-html="renderedMarkdown"
  />
  <div v-else-if="role === 'tool'" class="tool-result">
    <div class="tool-result__header">
      <span class="tool-result__eyebrow">Tool</span>
      <span class="tool-result__summary">{{ toolSummary }}</span>
    </div>
    <details v-if="content.trim()" class="tool-result__details">
      <summary>Details</summary>
      <pre class="m-0 whitespace-pre-wrap text-sm leading-6">{{ content }}</pre>
    </details>
  </div>
  <pre v-else class="m-0 whitespace-pre-wrap text-sm leading-6">{{ content }}</pre>
</template>

<style scoped>
.markdown-body {
  color: var(--workspace-message-text, var(--mebius-ink));
  overflow-wrap: anywhere;
}

.markdown-body :deep(*) {
  letter-spacing: 0;
}

.markdown-body :deep(:first-child) {
  margin-top: 0;
}

.markdown-body :deep(:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(p) {
  color: var(--workspace-message-text, var(--mebius-ink));
  margin: 0 0 0.75rem;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  color: var(--workspace-message-text, var(--mebius-ink));
  font-weight: 650;
  line-height: 1.35;
  margin: 1rem 0 0.5rem;
}

.markdown-body :deep(h1) {
  font-size: 1.25rem;
}

.markdown-body :deep(h2) {
  font-size: 1.125rem;
}

.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  font-size: 1rem;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 0 0 0.75rem;
  padding-left: 1.35rem;
}

.markdown-body :deep(li) {
  color: var(--workspace-message-text, var(--mebius-ink));
  margin: 0.25rem 0;
}

.markdown-body :deep(hr) {
  border: 0;
  border-top: 1px solid var(--workspace-card-border, var(--mebius-border));
  margin: 1rem 0;
}

.markdown-body :deep(blockquote) {
  border-left: 3px solid var(--mebius-accent);
  color: var(--workspace-message-text, var(--mebius-ink));
  margin: 0 0 0.75rem;
  padding-left: 0.85rem;
}

.markdown-body :deep(code) {
  background: color-mix(in srgb, var(--workspace-card-subtle, var(--mebius-code-bg)) 86%, var(--mebius-accent) 14%);
  border-radius: 4px;
  color: var(--workspace-message-text, var(--mebius-ink));
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.92em;
  padding: 0.12rem 0.28rem;
}

.markdown-body :deep(pre) {
  background: var(--mebius-code-bg);
  border: 1px solid var(--workspace-card-border, var(--mebius-border));
  border-radius: 6px;
  color: var(--workspace-message-text, var(--mebius-ink));
  margin: 0 0 0.85rem;
  overflow-x: auto;
  padding: 0.85rem;
}

.markdown-body :deep(pre code) {
  background: transparent;
  color: inherit;
  display: block;
  font-size: 0.85rem;
  padding: 0;
}

.markdown-body :deep(table) {
  border-collapse: collapse;
  display: block;
  margin: 0 0 0.85rem;
  overflow-x: auto;
  width: 100%;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  border: 1px solid var(--workspace-card-border, var(--mebius-border));
  color: var(--workspace-message-text, var(--mebius-ink));
  padding: 0.35rem 0.5rem;
  text-align: left;
}

.markdown-body :deep(th) {
  background: var(--workspace-card-subtle, var(--mebius-code-bg));
  font-weight: 700;
}

.markdown-body :deep(a) {
  color: var(--mebius-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

pre {
  color: var(--workspace-message-text, var(--mebius-ink));
}

.tool-result {
  display: grid;
  gap: 0.65rem;
}

.tool-result__header {
  align-items: flex-start;
  display: flex;
  gap: 0.6rem;
  min-width: 0;
}

.tool-result__eyebrow {
  background: color-mix(in srgb, var(--mebius-accent) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--mebius-accent) 34%, transparent);
  border-radius: 999px;
  color: var(--mebius-accent);
  flex: 0 0 auto;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0;
  line-height: 1;
  padding: 0.3rem 0.45rem;
  text-transform: uppercase;
}

.tool-result__summary {
  color: var(--workspace-message-text, var(--mebius-ink));
  font-size: 0.875rem;
  font-weight: 650;
  line-height: 1.45;
  min-width: 0;
  overflow-wrap: anywhere;
}

.tool-result__details {
  border-top: 1px solid var(--workspace-card-border, var(--mebius-border));
  padding-top: 0.55rem;
}

.tool-result__details summary {
  color: var(--workspace-message-muted, var(--mebius-muted));
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0;
  margin-bottom: 0.55rem;
}

.tool-result__details pre {
  background: var(--mebius-code-bg);
  border: 1px solid var(--workspace-card-border, var(--mebius-border));
  border-radius: 6px;
  max-height: 24rem;
  overflow: auto;
  padding: 0.75rem;
}
</style>
