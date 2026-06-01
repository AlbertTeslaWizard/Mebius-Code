<script setup lang="ts">
import { h, onMounted, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { ArrowLeft, RefreshCw } from 'lucide-vue-next';
import { request } from '../api/http';
import type { AuditLog, ListResponse } from '../api/types';
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
            <h1 class="m-0 text-xl font-semibold">{{ locale.t('auditLogs') }}</h1>
            <p class="m-0 text-sm text-mebius-muted">{{ locale.t('recordsVisible', { total }) }}</p>
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

      <section class="mb-4 rounded border border-mebius-border bg-white p-4">
        <div class="grid gap-3 md:grid-cols-4">
          <n-input v-model:value="filters.action" :placeholder="locale.t('action')" />
          <n-input v-model:value="filters.resourceType" :placeholder="locale.t('resourceType')" />
          <n-input v-model:value="filters.resourceId" :placeholder="locale.t('resourceId')" />
          <n-button type="primary" @click="load">{{ locale.t('applyFilters') }}</n-button>
        </div>
      </section>

      <section class="rounded border border-mebius-border bg-white">
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
