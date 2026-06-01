<script setup lang="ts">
import { h, onMounted, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { ArrowLeft, RefreshCw } from 'lucide-vue-next';
import { request } from '../api/http';
import type { AuditLog, ListResponse } from '../api/types';

const logs = ref<AuditLog[]>([]);
const total = ref(0);
const loading = ref(false);
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
            <n-button quaternary circle title="Back to workspace">
              <template #icon><n-icon><ArrowLeft /></n-icon></template>
            </n-button>
          </RouterLink>
          <div>
            <h1 class="m-0 text-xl font-semibold">Audit Logs</h1>
            <p class="m-0 text-sm text-mebius-muted">{{ total }} records visible to this account.</p>
          </div>
        </div>
        <n-button :loading="loading" @click="load">
          <template #icon><n-icon><RefreshCw /></n-icon></template>
          Refresh
        </n-button>
      </div>

      <section class="mb-4 rounded border border-mebius-border bg-white p-4">
        <div class="grid gap-3 md:grid-cols-4">
          <n-input v-model:value="filters.action" placeholder="action" />
          <n-input v-model:value="filters.resourceType" placeholder="resource type" />
          <n-input v-model:value="filters.resourceId" placeholder="resource id" />
          <n-button type="primary" @click="load">Apply filters</n-button>
        </div>
      </section>

      <section class="rounded border border-mebius-border bg-white">
        <n-data-table
          :loading="loading"
          :columns="[
            { title: 'Time', key: 'createdAt' },
            { title: 'Action', key: 'action' },
            { title: 'Resource', key: 'resourceType' },
            { title: 'Resource ID', key: 'resourceId' },
            {
              title: 'Metadata',
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
