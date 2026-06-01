<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
import type { TreeOption } from 'naive-ui';
import {
  Cable,
  Check,
  ClipboardList,
  FileText,
  Folder,
  GitBranch,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-vue-next';
import type { ConnectField, ConnectProvider, TreeNode } from '../api/types';
import { useApprovalStore } from '../stores/approvals';
import { useAuthStore } from '../stores/auth';
import { useWorkspaceStore } from '../stores/workspace';

const auth = useAuthStore();
const workspace = useWorkspaceStore();
const approvals = useApprovalStore();

const projectForm = reactive({ name: '', description: '' });
const importForm = reactive({ gitUrl: '', branch: '' });
const sessionTitle = ref('');
const composer = ref('');
const planGoal = ref('');
const selectedFileKeys = ref<Array<string | number>>([]);
const connectModal = ref(false);
const connectQuery = ref('');
const connectProviders = ref<ConnectProvider[]>([]);
const connectSelected = ref<ConnectProvider | null>(null);
const connectFields = ref<ConnectField[]>([]);
const connectForm = reactive<Record<string, string>>({});
const busy = ref(false);
const error = ref('');

const treeOptions = computed<TreeOption[]>(() => workspace.fileTree.map(toTreeOption));
const canChat = computed(() => Boolean(workspace.currentSession));

onMounted(async () => {
  await Promise.all([auth.fetchMe(), approvals.loadPending()]);
  await workspace.bootstrap();
});

onBeforeUnmount(() => {
  workspace.disconnectEvents();
});

async function runTask(action: () => Promise<unknown>) {
  busy.value = true;
  error.value = '';
  try {
    await action();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Operation failed.';
  } finally {
    busy.value = false;
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

async function createSession() {
  await runTask(async () => {
    await workspace.createSession(sessionTitle.value || undefined);
    sessionTitle.value = '';
  });
}

async function submitText() {
  const value = composer.value;
  composer.value = '';
  await runTask(() => workspace.submitText(value));
}

async function createPlan() {
  await runTask(() => workspace.createPlan(planGoal.value));
}

async function openConnect() {
  connectModal.value = true;
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
    clearConnectForm();
  });
}

function clearConnectForm() {
  Object.keys(connectForm).forEach((key) => {
    delete connectForm[key];
  });
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
    <div class="grid h-full grid-cols-[280px_minmax(420px,1fr)_360px]">
      <aside class="flex min-h-0 flex-col border-r border-mebius-border bg-white">
        <header class="border-b border-mebius-border p-4">
          <div class="mb-3 flex items-center justify-between">
            <div>
              <h1 class="m-0 text-lg font-semibold">Mebius Code</h1>
              <p class="m-0 text-xs text-mebius-muted">{{ auth.user?.email ?? 'Workspace' }}</p>
            </div>
            <n-dropdown
              trigger="click"
              :options="[
                { label: 'Model configs', key: 'models' },
                { label: 'Audit logs', key: 'audit' },
                { label: 'Sign out', key: 'logout' }
              ]"
              @select="(key: string) => key === 'logout' ? auth.logout() : $router.push(key === 'models' ? '/settings/models' : '/settings/audit')"
            >
              <n-button circle quaternary title="Settings">
                <template #icon><n-icon><Settings /></n-icon></template>
              </n-button>
            </n-dropdown>
          </div>
          <n-alert v-if="error" type="error" :show-icon="false" closable @close="error = ''">
            {{ error }}
          </n-alert>
        </header>

        <section class="border-b border-mebius-border p-3">
          <div class="mb-2 flex items-center gap-2 text-sm font-medium">
            <n-icon><Folder /></n-icon>
            Projects
          </div>
          <div class="space-y-2">
            <n-input v-model:value="projectForm.name" size="small" placeholder="Project name" />
            <n-input
              v-model:value="projectForm.description"
              size="small"
              placeholder="Description"
            />
            <n-button size="small" block type="primary" :disabled="!projectForm.name" @click="createProject">
              <template #icon><n-icon><Plus /></n-icon></template>
              Create project
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
              <n-thing :title="project.name" :description="project.description || project.sourceType" />
            </n-list-item>
          </n-list>
        </section>

        <section class="border-t border-mebius-border p-3">
          <div class="mb-2 flex items-center gap-2 text-sm font-medium">
            <n-icon><GitBranch /></n-icon>
            Git import
          </div>
          <n-input v-model:value="importForm.gitUrl" class="mb-2" size="small" placeholder="Repository URL" />
          <n-input v-model:value="importForm.branch" class="mb-2" size="small" placeholder="Branch" />
          <n-button size="small" block :disabled="!workspace.currentProject || !importForm.gitUrl" @click="importGit">
            Import into current project
          </n-button>
        </section>
      </aside>

      <section class="flex min-h-0 flex-col">
        <header class="flex items-center justify-between border-b border-mebius-border bg-white px-4 py-3">
          <div>
            <h2 class="m-0 text-base font-semibold">
              {{ workspace.currentSession?.title ?? 'No session selected' }}
            </h2>
            <p class="m-0 text-xs text-mebius-muted">
              {{ workspace.currentProject?.name ?? 'Create or select a project' }}
              · SSE {{ workspace.eventStatus }}
            </p>
          </div>
          <n-space>
            <n-button size="small" @click="openConnect" :disabled="!workspace.currentSession">
              <template #icon><n-icon><Cable /></n-icon></template>
              Connect
            </n-button>
            <n-button size="small" @click="approvals.loadPending">
              <template #icon><n-icon><RefreshCw /></n-icon></template>
              Sync
            </n-button>
          </n-space>
        </header>

        <div class="grid min-h-0 flex-1 grid-cols-[220px_1fr]">
          <aside class="min-h-0 border-r border-mebius-border bg-white p-3">
            <div class="mb-3 flex items-center justify-between">
              <span class="text-sm font-medium">Sessions</span>
              <n-button circle quaternary size="small" title="New session" @click="createSession">
                <template #icon><n-icon><Plus /></n-icon></template>
              </n-button>
            </div>
            <n-input v-model:value="sessionTitle" class="mb-2" size="small" placeholder="Session title" />
            <div class="h-[calc(100%-72px)] overflow-y-auto scrollbar-thin">
              <n-list hoverable clickable>
                <n-list-item
                  v-for="session in workspace.sessions"
                  :key="session.id"
                  :class="session.id === workspace.currentSession?.id ? 'bg-slate-100' : ''"
                  @click="workspace.selectSession(session)"
                >
                  <n-thing
                    :title="session.title"
                    :description="session.activeModelConfig?.modelName || session.status"
                  />
                </n-list-item>
              </n-list>
            </div>
          </aside>

          <div class="flex min-h-0 flex-col">
            <div class="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
              <div v-if="workspace.messages.length === 0" class="rounded border border-dashed border-mebius-border bg-white p-6 text-sm text-mebius-muted">
                Create a session, connect a model, then send a request.
              </div>
              <div
                v-for="message in workspace.messages"
                :key="message.id"
                class="mb-3 rounded border border-mebius-border bg-white p-3"
              >
                <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-mebius-muted">
                  {{ message.role }}
                </div>
                <pre class="m-0 whitespace-pre-wrap text-sm leading-6">{{ message.content }}</pre>
              </div>

              <section v-if="workspace.activePlan" class="rounded border border-mebius-border bg-white p-3">
                <div class="mb-2 flex items-center justify-between">
                  <strong>Plan: {{ workspace.activePlan.plan.status }}</strong>
                  <n-button size="small" type="primary" @click="workspace.approvePlan">
                    <template #icon><n-icon><Check /></n-icon></template>
                    Approve
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
              <div class="mb-2 grid grid-cols-[1fr_auto_auto] gap-2">
                <n-input
                  v-model:value="composer"
                  type="textarea"
                  :autosize="{ minRows: 2, maxRows: 5 }"
                  placeholder="Ask Mebius Code, or type /connect kimi"
                  @keydown.ctrl.enter.prevent="submitText"
                />
                <n-button :disabled="!canChat || !composer" :loading="busy" type="primary" @click="submitText">
                  <template #icon><n-icon><Send /></n-icon></template>
                  Send
                </n-button>
                <n-button :disabled="!canChat || !composer" @click="planGoal = composer; createPlan()">
                  <template #icon><n-icon><ClipboardList /></n-icon></template>
                  Plan
                </n-button>
              </div>
            </footer>
          </div>
        </div>
      </section>

      <aside class="flex min-h-0 flex-col border-l border-mebius-border bg-white">
        <n-tabs type="line" animated class="min-h-0 flex-1" pane-class="h-full">
          <n-tab-pane name="files" tab="Files">
            <div class="grid h-[calc(100vh-48px)] grid-rows-[250px_1fr]">
              <div class="overflow-y-auto border-b border-mebius-border p-3 scrollbar-thin">
                <div class="mb-2 flex items-center justify-between">
                  <span class="flex items-center gap-2 text-sm font-medium">
                    <n-icon><FileText /></n-icon>
                    File tree
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
                <div v-else class="text-sm text-mebius-muted">Select a file to preview it.</div>
              </div>
            </div>
          </n-tab-pane>

          <n-tab-pane name="approvals" tab="Approvals">
            <div class="h-[calc(100vh-48px)] overflow-y-auto p-3 scrollbar-thin">
              <div class="mb-3 flex items-center justify-between">
                <span class="flex items-center gap-2 text-sm font-medium">
                  <n-icon><ShieldCheck /></n-icon>
                  Pending approvals
                </span>
                <n-button circle quaternary size="small" @click="approvals.loadPending">
                  <template #icon><n-icon><RefreshCw /></n-icon></template>
                </n-button>
              </div>
              <n-empty v-if="approvals.pending.length === 0" description="No pending approvals" />
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
                    Approve
                  </n-button>
                  <n-button size="small" @click="approvals.reject(approval.id)">
                    <template #icon><n-icon><X /></n-icon></template>
                    Reject
                  </n-button>
                </n-space>
              </div>
            </div>
          </n-tab-pane>

          <n-tab-pane name="events" tab="Events">
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

    <n-modal v-model:show="connectModal" preset="card" title="Connect Model Provider" class="max-w-[720px]">
      <div class="grid gap-4 md:grid-cols-[260px_1fr]">
        <section>
          <n-input
            v-model:value="connectQuery"
            class="mb-3"
            placeholder="Search providers, e.g. kimi or 通义"
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
              <div class="text-xs text-mebius-muted">{{ provider.description }}</div>
            </button>
          </div>
        </section>
        <section>
          <n-empty v-if="!connectSelected" description="Select a provider" />
          <div v-else>
            <h3 class="m-0 mb-1 text-base font-semibold">{{ connectSelected.displayName }}</h3>
            <p class="m-0 mb-4 text-sm text-mebius-muted">{{ connectSelected.baseUrl || 'Custom endpoint' }}</p>
            <n-form label-placement="top">
              <n-form-item v-for="field in connectFields" :key="field.name" :label="field.label">
                <n-input
                  v-model:value="connectForm[field.name]"
                  :type="field.type === 'password' ? 'password' : 'text'"
                  show-password-on="mousedown"
                />
              </n-form-item>
              <n-button type="primary" :loading="busy" :disabled="!connectForm.apiKey" @click="submitConnect">
                <template #icon><n-icon><Play /></n-icon></template>
                Validate and connect
              </n-button>
            </n-form>
          </div>
        </section>
      </div>
    </n-modal>
  </main>
</template>
