<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { ArrowLeft, Plus, RefreshCw } from 'lucide-vue-next';
import { NButton, NPopconfirm, NSpace, NTag, useMessage } from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import { jsonBody, request } from '../api/http';
import type { ModelConfig, ModelConfigTestResult } from '../api/types';
import MebiusBrand from '../components/MebiusBrand.vue';
import { useLocaleStore } from '../stores/locale';

const configs = ref<ModelConfig[]>([]);
const loading = ref(false);
const saving = ref(false);
const testingId = ref<string | null>(null);
const error = ref('');
const locale = useLocaleStore();
const message = useMessage();
const form = reactive({
  displayName: '',
  baseUrl: '',
  modelName: '',
  apiKey: '',
  supportsTools: true,
  isDefault: false,
});
const editModal = ref(false);
const editing = ref<ModelConfig | null>(null);
const editForm = reactive({
  displayName: '',
  baseUrl: '',
  modelName: '',
  apiKey: '',
  supportsTools: true,
  isDefault: false,
});
const createInputProps = {
  displayName: modelInputProps('create', 'displayName', 'off'),
  baseUrl: modelInputProps('create', 'baseUrl', 'off'),
  modelName: modelInputProps('create', 'modelName', 'off'),
  apiKey: modelInputProps('create', 'apiToken', 'new-password'),
};
const editInputProps = {
  displayName: modelInputProps('edit', 'displayName', 'off'),
  baseUrl: modelInputProps('edit', 'baseUrl', 'off'),
  modelName: modelInputProps('edit', 'modelName', 'off'),
  apiKey: modelInputProps('edit', 'apiToken', 'new-password'),
};

const columns = computed<DataTableColumns<ModelConfig>>(() => [
  { title: locale.t('name'), key: 'displayName' },
  {
    title: locale.t('provider'),
    key: 'providerId',
    render: (row) => row.providerId || locale.t('customEndpoint'),
  },
  { title: locale.t('model'), key: 'modelName' },
  {
    title: locale.t('defaultColumn'),
    key: 'isDefault',
    render: (row) =>
      h(
        NTag,
        { size: 'small', type: row.isDefault ? 'success' : 'default' },
        { default: () => (row.isDefault ? locale.t('yes') : locale.t('no')) },
      ),
  },
  {
    title: locale.t('actions'),
    key: 'actions',
    render: (row) =>
      h(
        NSpace,
        { size: 6 },
        {
          default: () => [
            h(
              NButton,
              { size: 'small', quaternary: true, onClick: () => openEdit(row) },
              { default: () => locale.t('edit') },
            ),
            h(
              NButton,
              {
                size: 'small',
                loading: testingId.value === row.id,
                disabled: saving.value,
                onClick: () => testConfig(row.id),
              },
              { default: () => locale.t('test') },
            ),
            h(
              NPopconfirm,
              { onPositiveClick: () => deleteConfig(row.id) },
              {
                trigger: () =>
                  h(
                    NButton,
                    { size: 'small', quaternary: true, type: 'error', disabled: saving.value },
                    { default: () => locale.t('delete') },
                  ),
                default: () => locale.t('confirmDeleteModelConfig', { name: row.displayName }),
              },
            ),
          ],
        },
      ),
  },
]);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    configs.value = await request<ModelConfig[]>('/model-configs');
  } catch (err) {
    error.value = err instanceof Error ? err.message : locale.t('failedLoadModelConfigs');
  } finally {
    loading.value = false;
  }
}

async function create() {
  await runSaving(async () => {
    await request<ModelConfig>('/model-configs', {
      method: 'POST',
      body: jsonBody(form),
    });
    resetCreateForm();
    await load();
  });
}

async function testConfig(id: string) {
  testingId.value = id;
  error.value = '';
  try {
    const result = await request<ModelConfigTestResult>(`/model-configs/${id}/test`, { method: 'POST' });
    const text = result.status ? `${result.message} (${result.status})` : result.message;
    if (result.ok) {
      message.success(text);
    } else {
      message.warning(text);
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : locale.t('operationFailed');
    message.error(error.value);
  } finally {
    testingId.value = null;
  }
}

function openEdit(config: ModelConfig) {
  editing.value = config;
  editForm.displayName = config.displayName;
  editForm.baseUrl = config.baseUrl;
  editForm.modelName = config.modelName;
  editForm.apiKey = '';
  editForm.supportsTools = config.supportsTools;
  editForm.isDefault = config.isDefault;
  editModal.value = true;
}

async function saveEdit() {
  if (!editing.value) return;
  const configId = editing.value.id;
  await runSaving(async () => {
    const payload: {
      displayName: string;
      baseUrl: string;
      modelName: string;
      supportsTools: boolean;
      isDefault: boolean;
      apiKey?: string;
    } = {
      displayName: editForm.displayName,
      baseUrl: editForm.baseUrl,
      modelName: editForm.modelName,
      supportsTools: editForm.supportsTools,
      isDefault: editForm.isDefault,
    };
    if (editForm.apiKey.trim()) {
      payload.apiKey = editForm.apiKey;
    }
    await request<ModelConfig>(`/model-configs/${configId}`, {
      method: 'PATCH',
      body: jsonBody(payload),
    });
    editModal.value = false;
    editing.value = null;
    await load();
  });
}

async function deleteConfig(id: string) {
  await runSaving(async () => {
    await request<{ deleted: true }>(`/model-configs/${id}`, { method: 'DELETE' });
    await load();
  });
}

async function runSaving(action: () => Promise<void>) {
  saving.value = true;
  error.value = '';
  try {
    await action();
  } catch (err) {
    error.value = err instanceof Error ? err.message : locale.t('operationFailed');
    message.error(error.value);
  } finally {
    saving.value = false;
  }
}

function resetCreateForm() {
  form.displayName = '';
  form.baseUrl = '';
  form.modelName = '';
  form.apiKey = '';
  form.supportsTools = true;
  form.isDefault = false;
}

function modelInputProps(scope: 'create' | 'edit', field: string, autocomplete: string) {
  return {
    id: `mebius-model-config-${scope}-${field}`,
    name: `mebius-model-config-${scope}-${field}`,
    autocomplete,
    autocapitalize: 'off',
    spellcheck: 'false',
  };
}

onMounted(load);
</script>

<template>
  <main class="min-h-screen bg-mebius-bg p-6">
    <div class="mx-auto max-w-6xl">
      <div class="mb-5 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <RouterLink to="/app">
            <n-button quaternary circle :title="locale.t('backToWorkspace')">
              <template #icon><n-icon><ArrowLeft /></n-icon></template>
            </n-button>
          </RouterLink>
          <MebiusBrand size="compact" :text="false" />
          <div>
            <h1 class="m-0 text-xl font-semibold">{{ locale.t('modelConfigs') }}</h1>
            <p class="m-0 text-sm text-mebius-muted">{{ locale.t('encryptedCredentials') }}</p>
          </div>
        </div>
        <n-space>
          <n-button size="small" quaternary @click="locale.toggleLocale">
            {{ locale.t('languageSwitch') }}
          </n-button>
          <n-button :loading="loading" @click="load">
            <template #icon><n-icon><RefreshCw /></n-icon></template>
            {{ locale.t('refresh') }}
          </n-button>
        </n-space>
      </div>

      <n-alert v-if="error" class="mb-4" type="error" :show-icon="false">{{ error }}</n-alert>

      <div class="grid gap-4 lg:grid-cols-[360px_1fr]">
        <section class="rounded border border-mebius-border bg-white p-4">
          <h2 class="m-0 mb-4 text-base font-semibold">{{ locale.t('addManually') }}</h2>
          <n-form label-placement="top" autocomplete="off">
            <input class="pointer-events-none fixed h-px w-px opacity-0" style="left: -1000px; top: -1000px;" type="text" name="mebius-model-config-create-username-decoy" autocomplete="username" tabindex="-1" aria-hidden="true" />
            <input class="pointer-events-none fixed h-px w-px opacity-0" style="left: -1000px; top: -1000px;" type="password" name="mebius-model-config-create-password-decoy" autocomplete="current-password" tabindex="-1" aria-hidden="true" />
            <n-form-item :label="locale.t('displayName')">
              <n-input v-model:value="form.displayName" autocomplete="off" :input-props="createInputProps.displayName" />
            </n-form-item>
            <n-form-item :label="locale.t('baseUrl')">
              <n-input
                v-model:value="form.baseUrl"
                :placeholder="locale.t('baseUrlPlaceholder')"
                autocomplete="off"
                :input-props="createInputProps.baseUrl"
              />
            </n-form-item>
            <n-form-item :label="locale.t('modelName')">
              <n-input v-model:value="form.modelName" autocomplete="off" :input-props="createInputProps.modelName" />
            </n-form-item>
            <n-form-item :label="locale.t('apiKey')">
              <n-input
                v-model:value="form.apiKey"
                type="password"
                show-password-on="mousedown"
                autocomplete="new-password"
                :input-props="createInputProps.apiKey"
              />
            </n-form-item>
            <n-space>
              <n-checkbox v-model:checked="form.supportsTools">{{ locale.t('supportsTools') }}</n-checkbox>
              <n-checkbox v-model:checked="form.isDefault">{{ locale.t('defaultConfig') }}</n-checkbox>
            </n-space>
            <n-button
              class="mt-4"
              type="primary"
              block
              :loading="saving"
              :disabled="!form.displayName || !form.baseUrl || !form.modelName || !form.apiKey"
              @click="create"
            >
              <template #icon><n-icon><Plus /></n-icon></template>
              {{ locale.t('addConfig') }}
            </n-button>
          </n-form>
        </section>

        <section class="rounded border border-mebius-border bg-white">
          <n-data-table
            :loading="loading"
            :columns="columns"
            :data="configs"
            :pagination="{ pageSize: 10 }"
          />
        </section>
      </div>
    </div>

    <n-modal v-model:show="editModal" preset="card" :title="locale.t('editModelConfig')" class="max-w-[520px]">
      <n-form label-placement="top" autocomplete="off">
        <input class="pointer-events-none fixed h-px w-px opacity-0" style="left: -1000px; top: -1000px;" type="text" name="mebius-model-config-edit-username-decoy" autocomplete="username" tabindex="-1" aria-hidden="true" />
        <input class="pointer-events-none fixed h-px w-px opacity-0" style="left: -1000px; top: -1000px;" type="password" name="mebius-model-config-edit-password-decoy" autocomplete="current-password" tabindex="-1" aria-hidden="true" />
        <n-form-item :label="locale.t('displayName')">
          <n-input v-model:value="editForm.displayName" autocomplete="off" :input-props="editInputProps.displayName" />
        </n-form-item>
        <n-form-item :label="locale.t('baseUrl')">
          <n-input
            v-model:value="editForm.baseUrl"
            :placeholder="locale.t('baseUrlPlaceholder')"
            autocomplete="off"
            :input-props="editInputProps.baseUrl"
          />
        </n-form-item>
        <n-form-item :label="locale.t('modelName')">
          <n-input v-model:value="editForm.modelName" autocomplete="off" :input-props="editInputProps.modelName" />
        </n-form-item>
        <n-form-item :label="locale.t('apiKey')">
          <n-input
            v-model:value="editForm.apiKey"
            type="password"
            show-password-on="mousedown"
            autocomplete="new-password"
            :input-props="editInputProps.apiKey"
            :placeholder="locale.t('keepOriginalApiKey')"
          />
        </n-form-item>
        <n-space>
          <n-checkbox v-model:checked="editForm.supportsTools">{{ locale.t('supportsTools') }}</n-checkbox>
          <n-checkbox v-model:checked="editForm.isDefault">{{ locale.t('defaultConfig') }}</n-checkbox>
        </n-space>
      </n-form>
      <template #footer>
        <div class="flex justify-end gap-2">
          <n-button @click="editModal = false">{{ locale.t('cancel') }}</n-button>
          <n-button
            type="primary"
            :loading="saving"
            :disabled="!editForm.displayName || !editForm.baseUrl || !editForm.modelName"
            @click="saveEdit"
          >
            {{ locale.t('save') }}
          </n-button>
        </div>
      </template>
    </n-modal>
  </main>
</template>
