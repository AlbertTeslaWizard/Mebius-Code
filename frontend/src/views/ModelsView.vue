<script setup lang="ts">
import { h, onMounted, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { ArrowLeft, Plus, RefreshCw } from 'lucide-vue-next';
import { jsonBody, request } from '../api/http';
import type { ModelConfig } from '../api/types';

const configs = ref<ModelConfig[]>([]);
const loading = ref(false);
const error = ref('');
const form = reactive({
  displayName: '',
  baseUrl: '',
  modelName: '',
  apiKey: '',
  supportsTools: true,
  isDefault: false,
});

async function load() {
  loading.value = true;
  error.value = '';
  try {
    configs.value = await request<ModelConfig[]>('/model-configs');
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load model configs.';
  } finally {
    loading.value = false;
  }
}

async function create() {
  error.value = '';
  await request<ModelConfig>('/model-configs', {
    method: 'POST',
    body: jsonBody(form),
  });
  form.displayName = '';
  form.baseUrl = '';
  form.modelName = '';
  form.apiKey = '';
  await load();
}

async function testConfig(id: string) {
  await request(`/model-configs/${id}/test`, { method: 'POST' });
}

onMounted(load);
</script>

<template>
  <main class="min-h-screen bg-mebius-bg p-6">
    <div class="mx-auto max-w-6xl">
      <div class="mb-5 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <RouterLink to="/app">
            <n-button quaternary circle title="Back to workspace">
              <template #icon><n-icon><ArrowLeft /></n-icon></template>
            </n-button>
          </RouterLink>
          <div>
            <h1 class="m-0 text-xl font-semibold">Model Configs</h1>
            <p class="m-0 text-sm text-mebius-muted">Encrypted provider credentials and defaults.</p>
          </div>
        </div>
        <n-button :loading="loading" @click="load">
          <template #icon><n-icon><RefreshCw /></n-icon></template>
          Refresh
        </n-button>
      </div>

      <n-alert v-if="error" class="mb-4" type="error" :show-icon="false">{{ error }}</n-alert>

      <div class="grid gap-4 lg:grid-cols-[360px_1fr]">
        <section class="rounded border border-mebius-border bg-white p-4">
          <h2 class="m-0 mb-4 text-base font-semibold">Add Manually</h2>
          <n-form label-placement="top">
            <n-form-item label="Display name">
              <n-input v-model:value="form.displayName" />
            </n-form-item>
            <n-form-item label="Base URL">
              <n-input v-model:value="form.baseUrl" placeholder="https://api.example.com/v1" />
            </n-form-item>
            <n-form-item label="Model name">
              <n-input v-model:value="form.modelName" />
            </n-form-item>
            <n-form-item label="API key">
              <n-input v-model:value="form.apiKey" type="password" show-password-on="mousedown" />
            </n-form-item>
            <n-space>
              <n-checkbox v-model:checked="form.supportsTools">Tools</n-checkbox>
              <n-checkbox v-model:checked="form.isDefault">Default</n-checkbox>
            </n-space>
            <n-button
              class="mt-4"
              type="primary"
              block
              :disabled="!form.displayName || !form.baseUrl || !form.modelName || !form.apiKey"
              @click="create"
            >
              <template #icon><n-icon><Plus /></n-icon></template>
              Add config
            </n-button>
          </n-form>
        </section>

        <section class="rounded border border-mebius-border bg-white">
          <n-data-table
            :loading="loading"
            :columns="[
              { title: 'Name', key: 'displayName' },
              { title: 'Provider', key: 'providerId' },
              { title: 'Model', key: 'modelName' },
              { title: 'Default', key: 'isDefault' },
              {
                title: 'Actions',
                key: 'actions',
                render: (row: ModelConfig) => h('button', { class: 'text-mebius-accent', onClick: () => testConfig(row.id) }, 'Test')
              }
            ]"
            :data="configs"
            :pagination="{ pageSize: 10 }"
          />
        </section>
      </div>
    </div>
  </main>
</template>
