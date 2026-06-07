<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { ArrowLeft, Check, RefreshCw, Save, ShieldCheck, Terminal } from 'lucide-vue-next';
import { jsonBody, request } from '../api/http';
import type { CommandPolicy } from '../api/types';
import MebiusBrand from '../components/MebiusBrand.vue';
import { useLocaleStore } from '../stores/locale';

const locale = useLocaleStore();
const policy = ref<CommandPolicy | null>(null);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const saved = ref(false);
const enabledPresets = ref<string[]>([]);
const customCommandsText = ref('');

const customCommands = computed(() =>
  customCommandsText.value
    .split(/\r?\n/)
    .map((command) => command.trim())
    .filter(Boolean),
);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    policy.value = await request<CommandPolicy>('/command-policy');
    enabledPresets.value = [...policy.value.enabledPresets];
    customCommandsText.value = policy.value.customCommands.join('\n');
  } catch (err) {
    error.value = err instanceof Error ? err.message : locale.t('operationFailed');
  } finally {
    loading.value = false;
  }
}

function togglePreset(id: string, enabled: boolean) {
  enabledPresets.value = enabled
    ? [...new Set([...enabledPresets.value, id])]
    : enabledPresets.value.filter((item) => item !== id);
}

async function save() {
  if (!policy.value?.canManage) return;
  saving.value = true;
  saved.value = false;
  error.value = '';
  try {
    policy.value = await request<CommandPolicy>('/command-policy', {
      method: 'PATCH',
      body: jsonBody({
        enabledPresets: enabledPresets.value,
        customCommands: customCommands.value,
      }),
    });
    enabledPresets.value = [...policy.value.enabledPresets];
    customCommandsText.value = policy.value.customCommands.join('\n');
    saved.value = true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : locale.t('operationFailed');
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <main class="min-h-screen bg-mebius-bg p-4 md:p-6">
    <div class="mx-auto max-w-6xl">
      <header class="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <RouterLink to="/app">
            <n-button quaternary circle :title="locale.t('backToWorkspace')">
              <template #icon><n-icon><ArrowLeft /></n-icon></template>
            </n-button>
          </RouterLink>
          <MebiusBrand size="compact" :text="false" />
          <div class="min-w-0">
            <h1 class="m-0 text-xl font-semibold">{{ locale.t('commandPolicy') }}</h1>
            <p class="m-0 text-sm text-mebius-muted">{{ locale.t('commandPolicyHint') }}</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <n-button size="small" quaternary @click="locale.toggleLocale">
            {{ locale.t('languageSwitch') }}
          </n-button>
          <n-button :loading="loading" @click="load">
            <template #icon><n-icon><RefreshCw /></n-icon></template>
            {{ locale.t('refresh') }}
          </n-button>
          <n-button
            v-if="policy?.canManage"
            type="primary"
            :loading="saving"
            @click="save"
          >
            <template #icon><n-icon><Save /></n-icon></template>
            {{ locale.t('save') }}
          </n-button>
        </div>
      </header>

      <n-alert v-if="error" class="mb-4" type="error" :show-icon="false">{{ error }}</n-alert>
      <n-alert v-else-if="saved" class="mb-4" type="success" :show-icon="false">
        {{ locale.t('commandPolicySaved') }}
      </n-alert>
      <n-alert v-if="policy && !policy.canManage" class="mb-4" type="info" :show-icon="false">
        {{ locale.t('commandPolicyReadOnly') }}
      </n-alert>

      <div v-if="policy" class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div class="space-y-4">
          <section class="border border-mebius-border bg-white">
            <header class="flex items-center gap-3 border-b border-mebius-border px-4 py-3">
              <n-icon class="text-emerald-600"><ShieldCheck /></n-icon>
              <div>
                <h2 class="m-0 text-sm font-semibold">{{ locale.t('commandPresets') }}</h2>
                <p class="m-0 text-xs text-mebius-muted">{{ locale.t('commandPresetsHint') }}</p>
              </div>
            </header>
            <div class="divide-y divide-mebius-border">
              <div
                v-for="preset in policy.presets"
                :key="preset.id"
                class="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div class="min-w-0">
                  <div class="mb-1 flex items-center gap-2">
                    <strong class="text-sm">{{ preset.label }}</strong>
                    <n-tag v-if="enabledPresets.includes(preset.id)" size="small" type="success">
                      {{ locale.t('enabled') }}
                    </n-tag>
                  </div>
                  <p class="m-0 mb-3 text-xs leading-5 text-mebius-muted">{{ preset.description }}</p>
                  <div class="flex flex-wrap gap-1.5">
                    <code
                      v-for="command in preset.commands"
                      :key="command"
                      class="border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700"
                    >
                      {{ command }}
                    </code>
                  </div>
                </div>
                <n-switch
                  :value="enabledPresets.includes(preset.id)"
                  :disabled="!policy.canManage"
                  @update:value="(value: boolean) => togglePreset(preset.id, value)"
                />
              </div>
            </div>
          </section>

          <section class="border border-mebius-border bg-white p-4">
            <div class="mb-3 flex items-center gap-3">
              <n-icon class="text-slate-600"><Terminal /></n-icon>
              <div>
                <h2 class="m-0 text-sm font-semibold">{{ locale.t('customCommands') }}</h2>
                <p class="m-0 text-xs text-mebius-muted">{{ locale.t('customCommandsHint') }}</p>
              </div>
            </div>
            <n-input
              v-model:value="customCommandsText"
              type="textarea"
              :rows="8"
              :disabled="!policy.canManage"
              :placeholder="locale.t('customCommandsPlaceholder')"
            />
          </section>
        </div>

        <aside class="border border-mebius-border bg-white">
          <header class="border-b border-mebius-border px-4 py-3">
            <h2 class="m-0 text-sm font-semibold">{{ locale.t('effectiveCommands') }}</h2>
            <p class="m-0 text-xs text-mebius-muted">
              {{ locale.t('effectiveCommandsCount', { count: policy.effectiveCommands.length }) }}
            </p>
          </header>
          <div class="max-h-[680px] divide-y divide-mebius-border overflow-auto">
            <div
              v-for="command in policy.effectiveCommands"
              :key="command"
              class="flex items-start gap-2 px-4 py-2.5"
            >
              <n-icon class="mt-0.5 shrink-0 text-emerald-600"><Check /></n-icon>
              <code class="min-w-0 break-all text-xs text-slate-700">{{ command }}</code>
            </div>
          </div>
        </aside>
      </div>
    </div>
  </main>
</template>
