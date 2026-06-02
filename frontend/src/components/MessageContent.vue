<script setup lang="ts">
import { computed } from 'vue';
import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';

const props = defineProps<{
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}>();

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false,
});

const renderedMarkdown = computed(() => DOMPurify.sanitize(markdown.render(props.content)));
</script>

<template>
  <div
    v-if="role === 'assistant'"
    class="markdown-body text-sm leading-6"
    v-html="renderedMarkdown"
  />
  <pre v-else class="m-0 whitespace-pre-wrap text-sm leading-6">{{ content }}</pre>
</template>

<style scoped>
.markdown-body {
  color: #1f2937;
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
  margin: 0 0 0.75rem;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  color: #111827;
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
  margin: 0.25rem 0;
}

.markdown-body :deep(hr) {
  border: 0;
  border-top: 1px solid #d9dee7;
  margin: 1rem 0;
}

.markdown-body :deep(blockquote) {
  border-left: 3px solid #d9dee7;
  color: #4b5563;
  margin: 0 0 0.75rem;
  padding-left: 0.85rem;
}

.markdown-body :deep(code) {
  background: #f1f5f9;
  border-radius: 4px;
  color: #0f172a;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.92em;
  padding: 0.12rem 0.28rem;
}

.markdown-body :deep(pre) {
  background: #0f172a;
  border-radius: 6px;
  color: #e5e7eb;
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
  border: 1px solid #d9dee7;
  padding: 0.35rem 0.5rem;
  text-align: left;
}

.markdown-body :deep(a) {
  color: #0f766e;
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
