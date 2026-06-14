<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import type { TreeOption } from 'naive-ui';
import {
  Cable,
  Check,
  FileText,
  Folder,
  GitBranch,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-vue-next';
import type { ConnectField, ConnectProvider, LayoutPreferences, TreeNode } from '../api/types';
import MessageContent from '../components/MessageContent.vue';
import { useApprovalStore } from '../stores/approvals';
import { defaultUserPreferences, useAuthStore } from '../stores/auth';
import { useLocaleStore } from '../stores/locale';
import { useWorkspaceStore } from '../stores/workspace';

type ComposerMode = 'build' | 'plan';

const auth = useAuthStore();
const workspace = useWorkspaceStore();
const approvals = useApprovalStore();
const locale = useLocaleStore();

const projectForm = reactive({ name: '', description: '' });
const importForm = reactive({ gitUrl: '', branch: '' });
const gitCommitMessage = ref('');
const sessionTitle = ref('');
const composer = ref('');
const composerMode = ref<ComposerMode>('build');
const selectedFileKeys = ref<Array<string | number>>([]);
const connectModal = ref(false);
const connectQuery = ref('');
const connectProviders = ref<ConnectProvider[]>([]);
const connectSelected = ref<ConnectProvider | null>(null);
const connectFields = ref<ConnectField[]>([]);
const connectForm = reactive<Record<string, string>>({});
const lastConnectCommandQuery = ref<string | null>(null);
const isCompactViewport = ref(false);
const leftOverlayOpen = ref(false);
const rightOverlayOpen = ref(false);
const busy = ref(false);
const error = ref('');
let compactViewportQuery: MediaQueryList | null = null;

const treeOptions = computed<TreeOption[]>(() => workspace.fileTree.map(toTreeOption));
const canChat = computed(() => Boolean(workspace.currentSession));
const activeModelLabel = computed(
  () =>
    workspace.currentSession?.activeModelConfig?.displayName ||
    workspace.currentSession?.activeModelConfig?.modelName ||
    locale.t('currentModelFallback'),
);
const modelOptions = computed(() =>
  workspace.modelConfigs.map((config) => ({
    label: `${config.displayName} · ${config.modelName}`,
    value: config.id,
  })),
);
const canSubmitComposer = computed(
  () =>
    canChat.value &&
    Boolean(composer.value.trim()) &&
    !busy.value &&
    workspace.agentActivity?.status !== 'waiting_for_approval',
);
const composerModeOptions = computed<Array<{ label: string; value: ComposerMode }>>(() => [
  { label: locale.t('build'), value: 'build' },
  { label: locale.t('plan'), value: 'plan' },
]);
const settingsOptions = computed(() => [
  { label: locale.t('modelConfigs'), key: 'models' },
  { label: locale.t('auditLogs'), key: 'audit' },
  { label: locale.t('signOut'), key: 'logout' },
]);
const connectReady = computed(() =>
  connectFields.value.every((field) => !field.required || Boolean(connectForm[field.name]?.trim())),
);
const layoutPreferences = computed(() => auth.user?.preferences ?? defaultUserPreferences);
const leftSidebarCollapsed = computed(() => layoutPreferences.value.layout.leftSidebarCollapsed);
const rightSidebarCollapsed = computed(() => layoutPreferences.value.layout.rightSidebarCollapsed);
const leftSidebarInert = computed(() =>
  isCompactViewport.value ? !leftOverlayOpen.value : leftSidebarCollapsed.value,
);
const rightSidebarInert = computed(() =>
  isCompactViewport.value ? !rightOverlayOpen.value : rightSidebarCollapsed.value,
);
const hasOverlayOpen = computed(() => leftOverlayOpen.value || rightOverlayOpen.value);
const workspaceGridStyle = computed<Record<string, string>>(() => ({
  '--left-sidebar-width': leftSidebarCollapsed.value ? '0px' : '280px',
  '--right-sidebar-width': rightSidebarCollapsed.value ? '0px' : '360px',
}));
const leftSidebarToggleLabel = computed(() => {
  if (isCompactViewport.value) {
    return leftOverlayOpen.value ? locale.t('closeSidebar') : locale.t('openLeftSidebar');
  }
  return leftSidebarCollapsed.value ? locale.t('expandLeftSidebar') : locale.t('collapseLeftSidebar');
});
const rightSidebarToggleLabel = computed(() => {
  if (isCompactViewport.value) {
    return rightOverlayOpen.value ? locale.t('closeSidebar') : locale.t('openRightSidebar');
  }
  return rightSidebarCollapsed.value ? locale.t('expandRightSidebar') : locale.t('collapseRightSidebar');
});
const leftSidebarToggleIcon = computed(() =>
  isCompactViewport.value
    ? leftOverlayOpen.value
      ? PanelLeftClose
      : PanelLeftOpen
    : leftSidebarCollapsed.value
      ? PanelLeftOpen
      : PanelLeftClose,
);
const rightSidebarToggleIcon = computed(() =>
  isCompactViewport.value
    ? rightOverlayOpen.value
      ? PanelRightClose
      : PanelRightOpen
    : rightSidebarCollapsed.value
      ? PanelRightOpen
      : PanelRightClose,
);
const isImportingGit = computed(() => workspace.gitImportStatus === 'running');
const isLoadingGitStatus = computed(() => workspace.gitStatusLoading);
const isPublishingGit = computed(() => workspace.gitPublishStatus === 'running');
const gitStatus = computed(() => workspace.gitStatus);
const gitImportFeedback = computed(() => {
  if (workspace.gitImportStatus === 'running') return locale.t('gitImportRunning');
  if (workspace.gitImportStatus === 'success') return locale.t('gitImportComplete');
  if (workspace.gitImportStatus === 'error') return workspace.gitImportError || locale.t('gitImportFailed');
  return '';
});
const gitPublishFeedback = computed(() => workspace.gitPublishMessage);
const gitImportFeedbackClass = computed(() => {
  if (workspace.gitImportStatus === 'error') return 'text-red-600';
  if (workspace.gitImportStatus === 'success') return 'text-mebius-accent';
  return 'text-mebius-muted';
});
const gitPublishFeedbackClass = computed(() => {
  if (workspace.gitPublishStatus === 'error') return 'text-red-600';
  if (workspace.gitPublishStatus === 'success') return 'text-mebius-accent';
  return 'text-mebius-muted';
});
const canCommitGit = computed(
  () =>
    Boolean(workspace.currentProject) &&
    gitStatus.value?.isGitRepo === true &&
    gitStatus.value.files.length > 0 &&
    Boolean(gitCommitMessage.value.trim()) &&
    !busy.value &&
    !isPublishingGit.value,
);
const canPushGit = computed(
  () =>
    Boolean(workspace.currentProject) &&
    gitStatus.value?.isGitRepo === true &&
    gitStatus.value.hasRemote &&
    !busy.value &&
    !isPublishingGit.value,
);
const agentActivityText = computed(() => {
  const activity = workspace.agentActivity;
  if (!activity) return '';
  if (activity.status === 'thinking') return locale.t('agentThinking');
  if (activity.status === 'using_tools') {
    return activity.toolName
      ? locale.t('agentUsingTool', { tool: activity.toolName })
      : locale.t('agentUsingTools');
  }
  if (activity.status === 'waiting_for_approval') {
    return activity.toolName
      ? locale.t('agentWaitingToolApproval', { tool: activity.toolName })
      : locale.t('agentWaitingApproval');
  }
  return activity.message || locale.t('agentFailed');
});
const agentActivityToneClass = computed(() => {
  if (workspace.agentActivity?.status === 'failed') return 'border-red-200 bg-red-50 text-red-700';
  if (workspace.agentActivity?.status === 'waiting_for_approval') {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  return 'border-mebius-border bg-white text-mebius-muted';
});

onMounted(async () => {
  setupCompactViewportQuery();
  await Promise.all([auth.fetchMe(), approvals.loadPending()]);
  await workspace.bootstrap();
});

onBeforeUnmount(() => {
  workspace.disconnectEvents();
  compactViewportQuery?.removeEventListener('change', handleCompactViewportChange);
});

watch(composer, (value) => {
  const query = parseConnectCommand(value);
  if (query === null) {
    lastConnectCommandQuery.value = null;
    return;
  }
  if (!canChat.value) return;
  if (connectModal.value && lastConnectCommandQuery.value === query) return;
  lastConnectCommandQuery.value = query;
  void openConnect(query);
});

async function runTask(action: () => Promise<unknown>) {
  busy.value = true;
  error.value = '';
  try {
    await action();
  } catch (err) {
    error.value = err instanceof Error ? err.message : locale.t('operationFailed');
  } finally {
    busy.value = false;
  }
}

async function updateLayoutPreferences(layout: Partial<LayoutPreferences>) {
  error.value = '';
  try {
    await auth.updatePreferences({ layout });
  } catch (err) {
    error.value = err instanceof Error ? err.message : locale.t('operationFailed');
  }
}

function toggleLeftSidebar() {
  if (isCompactViewport.value) {
    leftOverlayOpen.value = !leftOverlayOpen.value;
    rightOverlayOpen.value = false;
    return;
  }

  void updateLayoutPreferences({
    leftSidebarCollapsed: !leftSidebarCollapsed.value,
  });
}

function toggleRightSidebar() {
  if (isCompactViewport.value) {
    rightOverlayOpen.value = !rightOverlayOpen.value;
    leftOverlayOpen.value = false;
    return;
  }

  void updateLayoutPreferences({
    rightSidebarCollapsed: !rightSidebarCollapsed.value,
  });
}

function closeSidebars() {
  leftOverlayOpen.value = false;
  rightOverlayOpen.value = false;
}

function setupCompactViewportQuery() {
  compactViewportQuery = window.matchMedia('(max-width: 1023px)');
  isCompactViewport.value = compactViewportQuery.matches;
  compactViewportQuery.addEventListener('change', handleCompactViewportChange);
}

function handleCompactViewportChange(event: MediaQueryListEvent) {
  isCompactViewport.value = event.matches;
  if (!event.matches) {
    closeSidebars();
  }
}

function gitStateLabel(state: string) {
  switch (state) {
    case 'untracked':
      return locale.t('gitStateUntracked');
    case 'staged':
      return locale.t('gitStateStaged');
    case 'modified':
      return locale.t('gitStateModified');
    case 'deleted':
      return locale.t('gitStateDeleted');
    case 'renamed':
      return locale.t('gitStateRenamed');
    case 'conflicted':
      return locale.t('gitStateConflicted');
    default:
      return locale.t('gitStateUnknown');
  }
}

async function createProject() {
  await runTask(async () => {
    await workspace.createProject({
      name: projectForm.name,
      description: projectForm.description || undefined,
    });
    projectForm.name = '';
    projectForm.description = '';
  });
}

async function deleteProject(projectId: string) {
  await runTask(() => workspace.deleteProject(projectId));
}

async function importGit() {
  await runTask(async () => {
    await workspace.importGit({
      gitUrl: importForm.gitUrl,
      branch: importForm.branch || undefined,
    });
    importForm.gitUrl = '';
    importForm.branch = '';
  });
}

async function refreshGitStatus() {
  await runTask(async () => {
    await workspace.loadGitStatus();
  });
}

async function commitGit() {
  await runTask(async () => {
    await workspace.commitGit(gitCommitMessage.value);
    gitCommitMessage.value = '';
  });
}

async function pushGit() {
  await runTask(async () => {
    await workspace.pushGit();
  });
}

async function createSession() {
  await runTask(async () => {
    await workspace.createSession(sessionTitle.value || undefined);
    sessionTitle.value = '';
  });
}

async function deleteSession(sessionId: string) {
  await runTask(() => workspace.deleteSession(sessionId));
}

async function switchModel(modelConfigId: string | null) {
  if (!modelConfigId) return;
  await runTask(() => workspace.switchSessionModel(modelConfigId));
}

async function submitComposer() {
  const value = composer.value.trim();
  if (!value) return;
  const connectCommandQuery = parseConnectCommand(value);
  if (connectCommandQuery !== null) {
    await openConnect(connectCommandQuery);
    return;
  }
  composer.value = '';
  await runTask(() =>
    composerMode.value === 'plan' ? workspace.createPlan(value) : workspace.submitText(value),
  );
}

async function openConnect(initialQuery = '') {
  connectModal.value = true;
  connectQuery.value = initialQuery;
  connectSelected.value = null;
  connectFields.value = [];
  clearConnectForm();
  await searchProviders();
}

async function searchProviders() {
  const result = await workspace.searchConnectProviders(connectQuery.value);
  if (result?.type === 'connect.providers') {
    connectProviders.value = result.providers;
  }
}

async function chooseProvider(provider: ConnectProvider) {
  connectSelected.value = provider;
  clearConnectForm();
  const result = await workspace.connectProvider({ providerId: provider.id });
  if (result?.type === 'connect.form') {
    connectFields.value = result.fields;
    result.fields.forEach((field) => {
      connectForm[field.name] = '';
    });
  }
}

async function submitConnect() {
  if (!connectSelected.value) return;
  await runTask(async () => {
    await workspace.connectProvider({
      providerId: connectSelected.value?.id ?? '',
      apiKey: connectForm.apiKey,
      modelName: connectForm.modelName || undefined,
      displayName: connectForm.displayName || undefined,
      baseUrl: connectForm.baseUrl || undefined,
    });
    connectModal.value = false;
    if (parseConnectCommand(composer.value) !== null) {
      composer.value = '';
    }
    clearConnectForm();
  });
}

function clearConnectForm() {
  Object.keys(connectForm).forEach((key) => {
    delete connectForm[key];
  });
}

function parseConnectCommand(value: string): string | null {
  const match = value.trim().match(/^\/connect(?:\s+(.*))?$/);
  return match ? (match[1]?.trim() ?? '') : null;
}

function connectFieldLabel(field: ConnectField): string {
  if (field.name === 'apiKey') return locale.t('apiKey');
  if (field.name === 'modelName') return locale.t('modelName');
  if (field.name === 'displayName') return locale.t('displayName');
  if (field.name === 'baseUrl') return locale.t('baseUrl');
  return field.label;
}

function connectFieldPlaceholder(field: ConnectField): string {
  if (field.name === 'apiKey') return locale.t('apiKeyPlaceholder');
  if (field.name === 'modelName') return locale.t('modelNamePlaceholder');
  if (field.name === 'displayName') return locale.t('displayNamePlaceholder');
  if (field.name === 'baseUrl') return locale.t('baseUrlPlaceholder');
  return '';
}

function connectInputProps(field: ConnectField) {
  const providerId = connectSelected.value?.id ?? 'provider';
  return {
    id: `mebius-connect-${providerId}-${field.name}`,
    name: `mebius-connect-${providerId}-${field.name}`,
    autocomplete: field.name === 'apiKey' ? 'new-password' : 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
  };
}

function providerDescription(provider: ConnectProvider): string {
  if (provider.id === 'openai') return locale.t('providerOpenaiDescription');
  if (provider.id === 'openrouter') return locale.t('providerOpenrouterDescription');
  if (provider.id === 'deepseek') return locale.t('providerDeepseekDescription');
  if (provider.id === 'moonshot') return locale.t('providerMoonshotDescription');
  if (provider.id === 'dashscope') return locale.t('providerDashscopeDescription');
  if (provider.id === 'siliconflow') return locale.t('providerSiliconflowDescription');
  if (provider.id === 'custom') return locale.t('providerCustomDescription');
  return provider.description;
}

function onFileSelect(keys: Array<string | number>) {
  selectedFileKeys.value = keys;
  const selectedPath = String(keys[0] ?? '');
  const node = findTreeNode(workspace.fileTree, selectedPath);
  if (node?.type === 'file') {
    void workspace.loadFile(node.path);
  }
}

function toTreeOption(node: TreeNode): TreeOption {
  return {
    key: node.path,
    label: node.name,
    isLeaf: node.type === 'file',
    children: node.children?.map(toTreeOption),
  };
}

function findTreeNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    const found = node.children ? findTreeNode(node.children, path) : null;
    if (found) return found;
  }
  return null;
}
</script>

<template>
  <main class="h-screen overflow-hidden bg-mebius-bg text-mebius-ink">
    <div class="workspace-shell" :style="workspaceGridStyle">
      <button
        v-if="isCompactViewport && hasOverlayOpen"
        class="fixed inset-0 z-20 bg-slate-950/20 lg:hidden"
        type="button"
        :title="locale.t('closeSidebar')"
        :aria-label="locale.t('closeSidebar')"
        @click="closeSidebars"
      />

      <aside
        class="workspace-side-panel workspace-side-panel--left flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-mebius-border bg-white"
        :class="{ 'is-collapsed': leftSidebarCollapsed, 'is-overlay-open': leftOverlayOpen }"
        :inert="leftSidebarInert"
        :aria-hidden="leftSidebarInert"
      >
        <header class="border-b border-mebius-border p-4">
          <div class="mb-3 flex items-center justify-between">
            <div>
              <h1 class="m-0 text-lg font-semibold">Mebius Code</h1>
              <p class="m-0 text-xs text-mebius-muted">{{ auth.user?.email ?? locale.t('workspace') }}</p>
            </div>
            <div class="flex items-center gap-1">
              <n-dropdown
                trigger="click"
                :options="settingsOptions"
                @select="(key: string) => key === 'logout' ? auth.logout() : $router.push(key === 'models' ? '/settings/models' : '/settings/audit')"
              >
                <n-button circle quaternary :title="locale.t('settings')">
                  <template #icon><n-icon><Settings /></n-icon></template>
                </n-button>
              </n-dropdown>
              <n-button
                v-if="isCompactViewport"
                circle
                quaternary
                :title="locale.t('closeSidebar')"
                :aria-label="locale.t('closeSidebar')"
                @click="closeSidebars"
              >
                <template #icon><n-icon><X /></n-icon></template>
              </n-button>
            </div>
          </div>
          <n-alert v-if="error" type="error" :show-icon="false" closable @close="error = ''">
            {{ error }}
          </n-alert>
        </header>

        <section class="border-b border-mebius-border p-3">
          <div class="mb-2 flex items-center gap-2 text-sm font-medium">
            <n-icon><Folder /></n-icon>
            {{ locale.t('projects') }}
          </div>
          <div class="space-y-2">
            <n-input v-model:value="projectForm.name" size="small" :placeholder="locale.t('projectName')" />
            <n-input
              v-model:value="projectForm.description"
              size="small"
              :placeholder="locale.t('description')"
            />
            <n-button size="small" block type="primary" :disabled="!projectForm.name" @click="createProject">
              <template #icon><n-icon><Plus /></n-icon></template>
              {{ locale.t('createProject') }}
            </n-button>
          </div>
        </section>

        <section class="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin">
          <n-list hoverable clickable>
            <n-list-item
              v-for="project in workspace.projects"
              :key="project.id"
              :class="project.id === workspace.currentProject?.id ? 'bg-slate-100' : ''"
              @click="workspace.selectProject(project)"
            >
              <div class="flex items-center justify-between gap-2">
                <n-thing class="min-w-0" :title="project.name" :description="project.description || project.sourceType" />
                <n-popconfirm @positive-click="deleteProject(project.id)">
                  <template #trigger>
                    <n-button
                      circle
                      quaternary
                      size="small"
                      :disabled="busy"
                      :title="locale.t('deleteProject')"
                      @click.stop
                    >
                      <template #icon><n-icon><Trash2 /></n-icon></template>
                    </n-button>
                  </template>
                  {{ locale.t('confirmDeleteProject', { name: project.name }) }}
                </n-popconfirm>
              </div>
            </n-list-item>
          </n-list>
        </section>

        <section class="border-t border-mebius-border p-3">
          <div class="mb-2 flex items-center gap-2 text-sm font-medium">
            <n-icon><GitBranch /></n-icon>
            {{ locale.t('gitImport') }}
          </div>
          <n-input
            v-model:value="importForm.gitUrl"
            class="mb-2"
            size="small"
            :disabled="isImportingGit"
            :placeholder="locale.t('repositoryUrl')"
          />
          <n-input
            v-model:value="importForm.branch"
            class="mb-2"
            size="small"
            :disabled="isImportingGit"
            :placeholder="locale.t('branch')"
          />
          <n-button
            size="small"
            block
            :loading="isImportingGit"
            :disabled="!workspace.currentProject || !importForm.gitUrl || isImportingGit"
            @click="importGit"
          >
            {{ locale.t('importIntoCurrentProject') }}
          </n-button>
          <p v-if="gitImportFeedback" class="m-0 mt-2 text-xs leading-5" :class="gitImportFeedbackClass">
            {{ gitImportFeedback }}
          </p>
        </section>

        <section class="border-t border-mebius-border p-3">
          <div class="mb-2 flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 text-sm font-medium">
              <n-icon><GitBranch /></n-icon>
              {{ locale.t('gitPublish') }}
            </div>
            <n-button
              quaternary
              size="small"
              :loading="isLoadingGitStatus"
              :disabled="!workspace.currentProject || isLoadingGitStatus || busy"
              @click="refreshGitStatus"
            >
              <template #icon><n-icon><RefreshCw /></n-icon></template>
              {{ locale.t('gitRefreshStatus') }}
            </n-button>
          </div>

          <p v-if="workspace.gitStatusError" class="m-0 mb-2 text-xs leading-5 text-red-600">
            {{ workspace.gitStatusError || locale.t('gitStatusFailed') }}
          </p>
          <p v-else-if="isLoadingGitStatus" class="m-0 mb-2 text-xs leading-5 text-mebius-muted">
            {{ locale.t('gitStatusLoading') }}
          </p>
          <template v-else-if="gitStatus">
            <p v-if="!gitStatus.isGitRepo" class="m-0 mb-2 text-xs leading-5 text-mebius-muted">
              {{ locale.t('gitStatusUnavailable') }}
            </p>
            <template v-else>
              <div class="mb-2 rounded-xl border border-mebius-border/80 bg-slate-50 p-2 text-xs text-mebius-muted">
                <p class="m-0">{{ locale.t('gitCurrentBranch', { branch: gitStatus.branch ?? 'HEAD' }) }}</p>
                <p v-if="gitStatus.tracking" class="m-0 mt-1">
                  {{ locale.t('gitTrackingBranch', { tracking: gitStatus.tracking }) }}
                </p>
                <p class="m-0 mt-1">{{ locale.t('gitRemoteCount', { count: gitStatus.remotes.length }) }}</p>
                <p class="m-0 mt-1">
                  staged {{ gitStatus.counts.staged }} · unstaged {{ gitStatus.counts.unstaged }} · untracked
                  {{ gitStatus.counts.untracked }}
                </p>
              </div>

              <n-input
                v-model:value="gitCommitMessage"
                class="mb-2"
                size="small"
                :disabled="isPublishingGit || busy"
                :placeholder="locale.t('gitCommitPlaceholder')"
              />
              <div class="flex gap-2">
                <n-button size="small" block :disabled="!canCommitGit" :loading="isPublishingGit && busy" @click="commitGit">
                  {{ locale.t('gitCommit') }}
                </n-button>
                <n-button size="small" block secondary :disabled="!canPushGit" :loading="isPublishingGit && busy" @click="pushGit">
                  {{ locale.t('gitPush') }}
                </n-button>
              </div>

              <p class="m-0 mt-2 text-xs leading-5 text-mebius-muted">
                {{ locale.t('gitRequiresRemote') }}
              </p>

              <div class="mt-3">
                <div class="mb-1 text-xs font-medium text-mebius-muted">{{ locale.t('gitChangedFiles') }}</div>
                <div
                  v-if="gitStatus.files.length"
                  class="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-mebius-border/80 bg-slate-50 p-2"
                >
                  <div
                    v-for="file in gitStatus.files"
                    :key="file.path"
                    class="flex items-center justify-between gap-2 text-xs"
                  >
                    <span class="min-w-0 truncate">{{ file.path }}</span>
                    <span class="shrink-0 text-mebius-muted">{{ gitStateLabel(file.state) }}</span>
                  </div>
                </div>
                <p v-else class="m-0 text-xs leading-5 text-mebius-muted">
                  {{ locale.t('gitNoChanges') }}
                </p>
              </div>
            </template>
          </template>

          <p v-if="gitPublishFeedback" class="m-0 mt-2 text-xs leading-5" :class="gitPublishFeedbackClass">
            {{ gitPublishFeedback }}
          </p>
        </section>
      </aside>

      <section class="flex min-h-0 min-w-0 flex-col">
        <header class="flex items-center justify-between border-b border-mebius-border bg-white px-4 py-3">
          <div class="flex min-w-0 items-center gap-2">
            <n-button
              circle
              quaternary
              size="small"
              :title="leftSidebarToggleLabel"
              :aria-label="leftSidebarToggleLabel"
              @click="toggleLeftSidebar"
            >
              <template #icon><n-icon><component :is="leftSidebarToggleIcon" /></n-icon></template>
            </n-button>
            <div class="min-w-0">
              <h2 class="m-0 truncate text-base font-semibold">
                {{ workspace.currentSession?.title ?? locale.t('noSessionSelected') }}
              </h2>
              <p class="m-0 truncate text-xs text-mebius-muted">
                {{ workspace.currentProject?.name ?? locale.t('createOrSelectProject') }}
                · SSE {{ workspace.eventStatus }}
              </p>
            </div>
          </div>
          <n-space>
            <n-button size="small" @click="openConnect('')" :disabled="!workspace.currentSession">
              <template #icon><n-icon><Cable /></n-icon></template>
              {{ locale.t('connect') }}
            </n-button>
            <n-button size="small" quaternary @click="locale.toggleLocale">
              {{ locale.t('languageSwitch') }}
            </n-button>
            <n-button size="small" @click="approvals.loadPending">
              <template #icon><n-icon><RefreshCw /></n-icon></template>
              {{ locale.t('sync') }}
            </n-button>
            <n-button
              circle
              quaternary
              size="small"
              :title="rightSidebarToggleLabel"
              :aria-label="rightSidebarToggleLabel"
              @click="toggleRightSidebar"
            >
              <template #icon><n-icon><component :is="rightSidebarToggleIcon" /></n-icon></template>
            </n-button>
          </n-space>
        </header>

        <div class="grid min-h-0 flex-1 grid-cols-[220px_1fr]">
          <aside class="min-h-0 border-r border-mebius-border bg-white p-3">
            <div class="mb-3 flex items-center justify-between">
              <span class="text-sm font-medium">{{ locale.t('sessions') }}</span>
              <n-button circle quaternary size="small" :title="locale.t('newSession')" @click="createSession">
                <template #icon><n-icon><Plus /></n-icon></template>
              </n-button>
            </div>
            <n-input v-model:value="sessionTitle" class="mb-2" size="small" :placeholder="locale.t('sessionTitle')" />
            <div class="h-[calc(100%-72px)] overflow-y-auto scrollbar-thin">
              <n-list hoverable clickable>
                <n-list-item
                  v-for="session in workspace.sessions"
                  :key="session.id"
                  :class="session.id === workspace.currentSession?.id ? 'bg-slate-100' : ''"
                  @click="workspace.selectSession(session)"
                >
                  <div class="flex items-center justify-between gap-2">
                    <n-thing
                      class="min-w-0"
                      :title="session.title"
                      :description="session.activeModelConfig?.modelName || session.status"
                    />
                    <n-popconfirm @positive-click="deleteSession(session.id)">
                      <template #trigger>
                        <n-button
                          circle
                          quaternary
                          size="small"
                          :disabled="busy"
                          :title="locale.t('deleteSession')"
                          @click.stop
                        >
                          <template #icon><n-icon><Trash2 /></n-icon></template>
                        </n-button>
                      </template>
                      {{ locale.t('confirmDeleteSession', { name: session.title }) }}
                    </n-popconfirm>
                  </div>
                </n-list-item>
              </n-list>
            </div>
          </aside>

          <div class="flex min-h-0 flex-col">
            <div class="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
              <div v-if="workspace.messages.length === 0" class="rounded border border-dashed border-mebius-border bg-white p-6 text-sm text-mebius-muted">
                {{ locale.t('createSessionHint') }}
              </div>
              <div
                v-for="message in workspace.messages"
                :key="message.id"
                class="mb-3 rounded border border-mebius-border bg-white p-3"
              >
                <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-mebius-muted">
                  {{ message.role }}
                </div>
                <MessageContent :role="message.role" :content="message.content" />
              </div>

              <div
                v-if="agentActivityText"
                class="mb-3 flex items-center gap-2 rounded border p-3 text-sm"
                :class="agentActivityToneClass"
              >
                <n-icon v-if="workspace.agentActivity?.status !== 'failed'" class="shrink-0 animate-spin">
                  <RefreshCw />
                </n-icon>
                <span>{{ agentActivityText }}</span>
              </div>

              <section v-if="workspace.activePlan" class="rounded border border-mebius-border bg-white p-3">
                <div class="mb-2 flex items-center justify-between">
                  <strong>{{ locale.t('planStatus', { status: workspace.activePlan.plan.status }) }}</strong>
                  <n-button size="small" type="primary" @click="workspace.approvePlan">
                    <template #icon><n-icon><Check /></n-icon></template>
                    {{ locale.t('approve') }}
                  </n-button>
                </div>
                <p class="text-sm">{{ workspace.activePlan.plan.summary }}</p>
                <ol class="pl-5 text-sm">
                  <li v-for="step in workspace.activePlan.steps" :key="step.id">
                    {{ step.title }}
                  </li>
                </ol>
              </section>
            </div>

            <footer class="border-t border-mebius-border bg-white p-3">
              <div class="rounded-2xl border border-mebius-border bg-white shadow-sm">
                <n-input
                  v-model:value="composer"
                  type="textarea"
                  :bordered="false"
                  :autosize="{ minRows: 2, maxRows: 5 }"
                  :placeholder="locale.t('askPlaceholder')"
                  @keydown.ctrl.enter.prevent="submitComposer"
                />
                <div class="flex flex-wrap items-center justify-between gap-2 border-t border-mebius-border px-3 py-2">
                  <div class="flex min-w-0 flex-wrap items-center gap-2">
                    <n-segmented
                      v-model:value="composerMode"
                      size="small"
                      :options="composerModeOptions"
                    />
                    <n-select
                      size="small"
                      class="w-[260px] max-w-full"
                      :value="workspace.currentSession?.activeModelConfig?.id ?? null"
                      :options="modelOptions"
                      :placeholder="activeModelLabel"
                      :disabled="!workspace.currentSession || modelOptions.length === 0 || busy"
                      :consistent-menu-width="false"
                      @update:value="switchModel"
                    />
                  </div>
                  <n-button
                    circle
                    :disabled="!canSubmitComposer"
                    :loading="busy"
                    type="primary"
                    :title="locale.t('send')"
                    @click="submitComposer"
                  >
                    <template #icon><n-icon><Send /></n-icon></template>
                  </n-button>
                </div>
              </div>
            </footer>
          </div>
        </div>
      </section>

      <aside
        class="workspace-side-panel workspace-side-panel--right relative flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-mebius-border bg-white"
        :class="{ 'is-collapsed': rightSidebarCollapsed, 'is-overlay-open': rightOverlayOpen }"
        :inert="rightSidebarInert"
        :aria-hidden="rightSidebarInert"
      >
        <n-button
          v-if="isCompactViewport"
          class="absolute right-2 top-2 z-10"
          circle
          quaternary
          :title="locale.t('closeSidebar')"
          :aria-label="locale.t('closeSidebar')"
          @click="closeSidebars"
        >
          <template #icon><n-icon><X /></n-icon></template>
        </n-button>
        <n-tabs type="line" animated class="min-h-0 flex-1" pane-class="h-full">
          <n-tab-pane name="files" :tab="locale.t('files')">
            <div class="grid h-[calc(100vh-48px)] grid-rows-[250px_1fr]">
              <div class="overflow-y-auto border-b border-mebius-border p-3 scrollbar-thin">
                <div class="mb-2 flex items-center justify-between">
                  <span class="flex items-center gap-2 text-sm font-medium">
                    <n-icon><FileText /></n-icon>
                    {{ locale.t('fileTree') }}
                  </span>
                  <n-button circle quaternary size="small" @click="workspace.loadTree()">
                    <template #icon><n-icon><RefreshCw /></n-icon></template>
                  </n-button>
                </div>
                <n-tree
                  block-line
                  :data="treeOptions"
                  :selected-keys="selectedFileKeys"
                  @update:selected-keys="onFileSelect"
                />
              </div>
              <div class="min-h-0 overflow-y-auto p-3 scrollbar-thin">
                <div v-if="workspace.currentFile" class="text-xs">
                  <div class="mb-2 font-medium">{{ workspace.currentFile.path }}</div>
                  <pre class="m-0 whitespace-pre-wrap rounded bg-slate-950 p-3 text-slate-100">{{ workspace.currentFile.content }}</pre>
                </div>
                <div v-else class="text-sm text-mebius-muted">{{ locale.t('selectFilePreview') }}</div>
              </div>
            </div>
          </n-tab-pane>

          <n-tab-pane name="approvals" :tab="locale.t('approvals')">
            <div class="h-[calc(100vh-48px)] overflow-y-auto p-3 scrollbar-thin">
              <div class="mb-3 flex items-center justify-between">
                <span class="flex items-center gap-2 text-sm font-medium">
                  <n-icon><ShieldCheck /></n-icon>
                  {{ locale.t('pendingApprovals') }}
                </span>
                <n-button circle quaternary size="small" @click="approvals.loadPending">
                  <template #icon><n-icon><RefreshCw /></n-icon></template>
                </n-button>
              </div>
              <n-empty v-if="approvals.pending.length === 0" :description="locale.t('noPendingApprovals')" />
              <div
                v-for="approval in approvals.pending"
                :key="approval.id"
                class="mb-3 rounded border border-mebius-border p-3"
              >
                <div class="mb-1 text-sm font-semibold">{{ approval.toolCall.name }}</div>
                <pre class="max-h-32 overflow-auto rounded bg-slate-100 p-2 text-xs">{{ JSON.stringify(approval.toolCall.arguments, null, 2) }}</pre>
                <n-space class="mt-2">
                  <n-button size="small" type="primary" @click="approvals.approve(approval.id)">
                    <template #icon><n-icon><Check /></n-icon></template>
                    {{ locale.t('approve') }}
                  </n-button>
                  <n-button size="small" @click="approvals.reject(approval.id)">
                    <template #icon><n-icon><X /></n-icon></template>
                    {{ locale.t('reject') }}
                  </n-button>
                </n-space>
              </div>
            </div>
          </n-tab-pane>

          <n-tab-pane name="events" :tab="locale.t('events')">
            <div class="h-[calc(100vh-48px)] overflow-y-auto p-3 scrollbar-thin">
              <div
                v-for="event in workspace.eventLog"
                :key="`${event.time}-${event.type}`"
                class="mb-2 rounded border border-mebius-border p-2 text-xs"
              >
                <div class="mb-1 font-semibold">{{ event.type }}</div>
                <pre class="m-0 whitespace-pre-wrap">{{ JSON.stringify(event.data, null, 2) }}</pre>
              </div>
            </div>
          </n-tab-pane>
        </n-tabs>
      </aside>
    </div>

    <n-modal v-model:show="connectModal" preset="card" :title="locale.t('connectModelProvider')" class="max-w-[720px]">
      <div class="grid gap-4 md:grid-cols-[260px_1fr]">
        <section>
          <n-input
            v-model:value="connectQuery"
            class="mb-3"
            :placeholder="locale.t('searchProvidersPlaceholder')"
            @update:value="() => searchProviders()"
            @keyup.enter="searchProviders"
          />
          <div class="space-y-2">
            <button
              v-for="provider in connectProviders"
              :key="provider.id"
              class="w-full rounded border border-mebius-border p-3 text-left hover:bg-slate-50"
              :class="connectSelected?.id === provider.id ? 'border-mebius-accent bg-teal-50' : ''"
              @click="chooseProvider(provider)"
            >
              <div class="font-medium">{{ provider.displayName }}</div>
              <div class="text-xs text-mebius-muted">{{ providerDescription(provider) }}</div>
            </button>
          </div>
        </section>
        <section>
          <n-empty v-if="!connectSelected" :description="locale.t('selectProvider')" />
          <div v-else>
            <h3 class="m-0 mb-1 text-base font-semibold">{{ connectSelected.displayName }}</h3>
            <p class="m-0 text-sm text-mebius-muted">{{ connectSelected.baseUrl || locale.t('customEndpoint') }}</p>
            <p v-if="connectSelected.recommendedModels.length" class="m-0 mb-4 text-xs text-mebius-muted">
              {{ locale.t('recommendedModels', { models: connectSelected.recommendedModels.join(', ') }) }}
            </p>
            <div v-else class="mb-4"></div>
            <n-form label-placement="top" autocomplete="off">
              <input class="pointer-events-none fixed h-px w-px opacity-0" style="left: -1000px; top: -1000px;" type="text" name="mebius-connect-username-decoy" autocomplete="username" tabindex="-1" aria-hidden="true" />
              <input class="pointer-events-none fixed h-px w-px opacity-0" style="left: -1000px; top: -1000px;" type="password" name="mebius-connect-password-decoy" autocomplete="current-password" tabindex="-1" aria-hidden="true" />
              <n-form-item v-for="field in connectFields" :key="field.name" :label="connectFieldLabel(field)">
                <n-input
                  v-model:value="connectForm[field.name]"
                  :type="field.type === 'password' ? 'password' : 'text'"
                  :placeholder="connectFieldPlaceholder(field)"
                  :input-props="connectInputProps(field)"
                  show-password-on="mousedown"
                />
              </n-form-item>
              <n-button type="primary" :loading="busy" :disabled="!connectReady" @click="submitConnect">
                <template #icon><n-icon><Play /></n-icon></template>
                {{ locale.t('validateAndConnect') }}
              </n-button>
            </n-form>
          </div>
        </section>
      </div>
    </n-modal>
  </main>
</template>

<style scoped>
.workspace-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  height: 100%;
  position: relative;
}

.workspace-side-panel {
  min-width: 0;
}

@media (min-width: 1024px) {
  .workspace-shell {
    grid-template-columns:
      var(--left-sidebar-width) minmax(420px, 1fr)
      var(--right-sidebar-width);
  }

  .workspace-side-panel {
    position: relative;
    transition: opacity 120ms ease;
  }

  .workspace-side-panel.is-collapsed {
    opacity: 0;
    pointer-events: none;
  }
}

@media (max-width: 1023px) {
  .workspace-side-panel {
    bottom: 0;
    max-width: 90vw;
    position: fixed;
    top: 0;
    transition:
      box-shadow 160ms ease,
      transform 160ms ease;
    width: 320px;
    z-index: 30;
  }

  .workspace-side-panel--left {
    left: 0;
    transform: translateX(-100%);
  }

  .workspace-side-panel--right {
    right: 0;
    transform: translateX(100%);
    width: 380px;
  }

  .workspace-side-panel.is-overlay-open {
    box-shadow: 0 24px 80px rgb(15 23 42 / 18%);
    transform: translateX(0);
  }
}
</style>
