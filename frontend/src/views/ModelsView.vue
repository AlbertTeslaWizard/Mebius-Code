<script setup lang="ts">
import { h, onMounted, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { ArrowLeft, Plus, RefreshCw } from 'lucide-vue-next';
import { jsonBody, request } from '../api/http';
import type { ModelConfig } from '../api/types';
import { useLocaleStore } from '../stores/locale';

const configs = ref<ModelConfig[]>([]);
const loading = ref(false);
const error = ref('');
const locale = useLocaleStore();
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
    error.value = err instanceof Error ? err.message : locale.t('failedLoadModelConfigs');
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
            <n-button quaternary circle :title="locale.t('backToWorkspace')">
              <template #icon><n-icon><ArrowLeft /></n-icon></template>
            </n-button>
          </RouterLink>
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
            <n-form-item :label="locale.t('displayName')">
              <n-input v-model:value="form.displayName" autocomplete="off" />
            </n-form-item>
            <n-form-item :label="locale.t('baseUrl')">
              <n-input v-model:value="form.baseUrl" :placeholder="locale.t('baseUrlPlaceholder')" autocomplete="off" />
            </n-form-item>
            <n-form-item :label="locale.t('modelName')">
              <n-input v-model:value="form.modelName" autocomplete="off" />
            </n-form-item>
            <n-form-item :label="locale.t('apiKey')">
              <n-input v-model:value="form.apiKey" type="password" show-password-on="mousedown" autocomplete="new-password" />
            </n-form-item>
            <n-space>
              <n-checkbox v-model:checked="form.supportsTools">{{ locale.t('supportsTools') }}</n-checkbox>
              <n-checkbox v-model:checked="form.isDefault">{{ locale.t('defaultConfig') }}</n-checkbox>
            </n-space>
            <n-button
              class="mt-4"
              type="primary"
              block
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
            :columns="[
              { title: locale.t('name'), key: 'displayName' },
              { title: locale.t('provider'), key: 'providerId' },
              { title: locale.t('model'), key: 'modelName' },
              { title: locale.t('defaultColumn'), key: 'isDefault' },
              {
                title: locale.t('actions'),
                key: 'actions',
                render: (row: ModelConfig) => h('button', { class: 'text-mebius-accent', onClick: () => testConfig(row.id) }, locale.t('test'))
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
