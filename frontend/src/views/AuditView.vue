<script setup lang="ts">
import { h, onMounted, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { ArrowLeft, RefreshCw } from 'lucide-vue-next';
import { request } from '../api/http';
import type { AuditLog, ListResponse } from '../api/types';
import MebiusBrand from '../components/MebiusBrand.vue';
import ThemeToggle from '../components/ThemeToggle.vue';
import { useLocaleStore } from '../stores/locale';

const logs = ref<AuditLog[]>([]);
const total = ref(0);
const loading = ref(false);
const locale = useLocaleStore();
const filters = reactive({
  action: '',
  resourceType: '',
  resourceId: '',
});

async function load() {
  loading.value = true;
  try {
    const params = new URLSearchParams({ limit: '50', offset: '0' });
    if (filters.action) params.set('action', filters.action);
    if (filters.resourceType) params.set('resourceType', filters.resourceType);
    if (filters.resourceId) params.set('resourceId', filters.resourceId);
    const response = await request<ListResponse<AuditLog>>(`/audit-logs?${params.toString()}`);
    logs.value = response.items;
    total.value = response.total;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <main class="settings-shell min-h-screen p-4 md:p-6">
    <div class="settings-frame mx-auto max-w-6xl">
      <div class="settings-header mb-5 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <RouterLink to="/app">
            <n-button quaternary circle :title="locale.t('backToWorkspace')">
              <template #icon><n-icon><ArrowLeft /></n-icon></template>
            </n-button>
          </RouterLink>
          <MebiusBrand size="compact" :text="false" />
          <div>
            <h1 class="settings-title m-0 text-xl font-semibold">{{ locale.t('auditLogs') }}</h1>
            <p class="m-0 text-sm text-mebius-muted">{{ locale.t('recordsVisible', { total }) }}</p>
          </div>
        </div>
        <n-space>
          <ThemeToggle />
          <n-button size="small" quaternary @click="locale.toggleLocale">
            {{ locale.t('languageSwitch') }}
          </n-button>
          <n-button :loading="loading" @click="load">
            <template #icon><n-icon><RefreshCw /></n-icon></template>
            {{ locale.t('refresh') }}
          </n-button>
        </n-space>
      </div>

      <section class="settings-panel settings-panel--padded mb-4">
        <div class="grid gap-3 md:grid-cols-4">
          <n-input v-model:value="filters.action" :placeholder="locale.t('action')" />
          <n-input v-model:value="filters.resourceType" :placeholder="locale.t('resourceType')" />
          <n-input v-model:value="filters.resourceId" :placeholder="locale.t('resourceId')" />
          <n-button type="primary" @click="load">{{ locale.t('applyFilters') }}</n-button>
        </div>
      </section>

      <section class="settings-panel">
        <n-data-table
            :loading="loading"
            :columns="[
            { title: locale.t('time'), key: 'createdAt' },
            { title: locale.t('actions'), key: 'action' },
            { title: locale.t('resource'), key: 'resourceType' },
            { title: locale.t('resourceId'), key: 'resourceId' },
            {
              title: locale.t('metadata'),
              key: 'metadata',
              render: (row: AuditLog) => h('code', { class: 'text-xs' }, JSON.stringify(row.metadata))
            }
          ]"
          :data="logs"
          :pagination="{ pageSize: 12 }"
        />
      </section>
    </div>
  </main>
</template>
