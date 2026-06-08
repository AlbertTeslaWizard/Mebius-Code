<script setup lang="ts">
import { computed } from 'vue';
import {
  Braces,
  ChevronRight,
  File,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Pencil,
  TerminalSquare,
  Trash2,
} from 'lucide-vue-next';
import type { TreeNode } from '../api/types';

defineOptions({ name: 'WorkspaceFileTree' });

const props = withDefaults(
  defineProps<{
    nodes: TreeNode[];
    selectedPath: string;
    expandedPaths: string[];
    emptyLabel: string;
    renameLabel: string;
    deleteLabel: string;
    depth?: number;
  }>(),
  {
    depth: 0,
  },
);

const emit = defineEmits<{
  select: [node: TreeNode];
  toggle: [path: string];
  rename: [node: TreeNode];
  delete: [node: TreeNode];
}>();

const expandedSet = computed(() => new Set(props.expandedPaths));

function isExpanded(node: TreeNode) {
  return node.type === 'directory' && expandedSet.value.has(node.path);
}

function isSelected(node: TreeNode) {
  return node.type === 'file' && node.path === props.selectedPath;
}

function rowPadding(depth: number) {
  return `${depth * 0.75 + 0.35}rem`;
}

function handleNodeClick(node: TreeNode) {
  if (node.type === 'directory') {
    emit('toggle', node.path);
    return;
  }
  emit('select', node);
}

function handleRename(node: TreeNode) {
  emit('rename', node);
}

function handleDelete(node: TreeNode) {
  emit('delete', node);
}

function nodeIcon(node: TreeNode) {
  if (node.type === 'directory') {
    return isExpanded(node) ? FolderOpen : Folder;
  }

  const name = node.name.toLowerCase();
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  if (['json', 'jsonc'].includes(extension)) return FileJson;
  if (['md', 'markdown', 'txt', 'log'].includes(extension)) return FileText;
  if (['sh', 'ps1', 'bat', 'cmd'].includes(extension)) return TerminalSquare;
  if (['css', 'scss', 'html', 'xml', 'vue'].includes(extension)) return Braces;
  if (
    [
      'c',
      'cpp',
      'cs',
      'go',
      'h',
      'java',
      'js',
      'jsx',
      'kt',
      'php',
      'py',
      'rb',
      'rs',
      'swift',
      'ts',
      'tsx',
    ].includes(extension)
  ) {
    return FileCode2;
  }
  return File;
}
</script>

<template>
  <div v-if="depth === 0 && nodes.length === 0" class="workspace-file-tree__empty">
    {{ emptyLabel }}
  </div>
  <ul v-else class="workspace-file-tree" :class="{ 'is-root': depth === 0 }">
    <li v-for="node in nodes" :key="node.path" class="workspace-file-tree__item">
      <button
        type="button"
        class="workspace-file-tree__row"
        :class="{
          'is-directory': node.type === 'directory',
          'is-file': node.type === 'file',
          'is-selected': isSelected(node),
        }"
        :style="{ paddingLeft: rowPadding(depth) }"
        :title="node.path"
        @click="handleNodeClick(node)"
      >
        <span class="workspace-file-tree__chevron" :class="{ 'is-expanded': isExpanded(node) }">
          <n-icon v-if="node.type === 'directory'"><ChevronRight /></n-icon>
        </span>
        <n-icon class="workspace-file-tree__icon">
          <component :is="nodeIcon(node)" />
        </n-icon>
        <span class="workspace-file-tree__name">{{ node.name }}</span>
        <span v-if="node.type === 'file'" class="workspace-file-tree__actions">
          <span
            role="button"
            tabindex="0"
            class="workspace-file-tree__action"
            :title="renameLabel"
            @click.stop="handleRename(node)"
            @keydown.enter.stop.prevent="handleRename(node)"
            @keydown.space.stop.prevent="handleRename(node)"
          >
            <n-icon><Pencil /></n-icon>
          </span>
          <span
            role="button"
            tabindex="0"
            class="workspace-file-tree__action is-danger"
            :title="deleteLabel"
            @click.stop="handleDelete(node)"
            @keydown.enter.stop.prevent="handleDelete(node)"
            @keydown.space.stop.prevent="handleDelete(node)"
          >
            <n-icon><Trash2 /></n-icon>
          </span>
        </span>
      </button>

      <WorkspaceFileTree
        v-if="node.type === 'directory' && node.children?.length && isExpanded(node)"
        :nodes="node.children"
        :selected-path="selectedPath"
        :expanded-paths="expandedPaths"
        :empty-label="emptyLabel"
        :rename-label="renameLabel"
        :delete-label="deleteLabel"
        :depth="depth + 1"
        @select="emit('select', $event)"
        @toggle="emit('toggle', $event)"
        @rename="emit('rename', $event)"
        @delete="emit('delete', $event)"
      />
    </li>
  </ul>
</template>

<style scoped>
.workspace-file-tree {
  list-style: none;
  margin: 0;
  padding: 0;
}

.workspace-file-tree.is-root {
  padding: 0.2rem;
}

.workspace-file-tree__item {
  min-width: 0;
}

.workspace-file-tree__row {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 6px;
  color: var(--workspace-message-text, #0f172a);
  display: grid;
  font-size: 12px;
  gap: 0.35rem;
  grid-template-columns: 14px 18px minmax(0, 1fr) auto;
  height: 29px;
  letter-spacing: 0;
  line-height: 1;
  margin: 1px 0;
  outline: none;
  padding-bottom: 0;
  padding-right: 0.45rem;
  padding-top: 0;
  text-align: left;
  width: 100%;
}

.workspace-file-tree__row:hover {
  background: var(--workspace-hover-bg, #e8f4f1);
  color: var(--workspace-message-text, #0f172a);
}

.workspace-file-tree__row:focus-visible {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--mebius-accent, #0f766e) 24%, transparent);
}

.workspace-file-tree__row.is-selected {
  background: var(--workspace-selected-bg, #d7eee9);
  box-shadow: inset 3px 0 0 var(--mebius-accent, #0f766e);
  color: var(--workspace-message-text, #0f172a);
  font-weight: 650;
}

.workspace-file-tree__row.is-directory {
  color: var(--workspace-message-text, #0f172a);
}

.workspace-file-tree__chevron {
  align-items: center;
  color: var(--workspace-icon-muted, #536579);
  display: inline-flex;
  justify-content: center;
  transition: transform 120ms ease;
}

.workspace-file-tree__chevron.is-expanded {
  transform: rotate(90deg);
}

.workspace-file-tree__icon {
  color: var(--workspace-icon-muted, #536579);
}

.workspace-file-tree__row.is-directory .workspace-file-tree__icon {
  color: var(--mebius-warning, #b45309);
}

.workspace-file-tree__row.is-selected .workspace-file-tree__icon {
  color: var(--mebius-accent, #0f766e);
}

.workspace-file-tree__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-file-tree__actions {
  align-items: center;
  display: inline-flex;
  gap: 0.15rem;
  opacity: 0;
  pointer-events: none;
}

.workspace-file-tree__row:hover .workspace-file-tree__actions,
.workspace-file-tree__row:focus-within .workspace-file-tree__actions {
  opacity: 1;
  pointer-events: auto;
}

.workspace-file-tree__action {
  align-items: center;
  border-radius: 5px;
  color: var(--workspace-icon-muted, #536579);
  display: inline-flex;
  height: 22px;
  justify-content: center;
  outline: none;
  width: 22px;
}

.workspace-file-tree__action:hover,
.workspace-file-tree__action:focus-visible {
  background: var(--workspace-hover-bg, #e8f4f1);
  color: var(--mebius-accent, #0f766e);
}

.workspace-file-tree__action.is-danger:hover,
.workspace-file-tree__action.is-danger:focus-visible {
  background: #fee2e2;
  color: #b91c1c;
}

.workspace-file-tree__empty {
  align-items: center;
  border: 1px dashed var(--workspace-card-border, #b8c7d3);
  border-radius: 8px;
  color: var(--workspace-message-muted, #475569);
  display: flex;
  font-size: 13px;
  justify-content: center;
  min-height: 120px;
  padding: 1rem;
  text-align: center;
}
</style>
