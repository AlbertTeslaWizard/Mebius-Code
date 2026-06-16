<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { ArrowLeft, KeyRound, Save } from 'lucide-vue-next';
import { useMessage } from 'naive-ui';
import { jsonBody, request } from '../api/http';
import MebiusBrand from '../components/MebiusBrand.vue';
import ThemeToggle from '../components/ThemeToggle.vue';
import { useAuthStore } from '../stores/auth';
import { useLocaleStore } from '../stores/locale';

const auth = useAuthStore();
const locale = useLocaleStore();
const message = useMessage();
const saving = ref(false);
const error = ref('');
const saved = ref(false);
const form = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
});

const canSubmit = computed(
  () =>
    form.currentPassword.length >= 6 &&
    form.newPassword.length >= 6 &&
    form.confirmPassword.length >= 6 &&
    form.newPassword === form.confirmPassword &&
    form.currentPassword !== form.newPassword,
);

async function changePassword() {
  saved.value = false;
  error.value = '';
  if (form.newPassword !== form.confirmPassword) {
    error.value = locale.t('passwordMismatch');
    return;
  }
  if (form.currentPassword === form.newPassword) {
    error.value = locale.t('passwordUnchanged');
    return;
  }

  saving.value = true;
  try {
    await request<{ changed: true }>('/auth/me/password', {
      method: 'PATCH',
      body: jsonBody({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      }),
    });
    form.currentPassword = '';
    form.newPassword = '';
    form.confirmPassword = '';
    saved.value = true;
    message.success(locale.t('passwordChanged'));
  } catch (err) {
    error.value = err instanceof Error ? err.message : locale.t('operationFailed');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <main class="settings-shell min-h-screen p-4 md:p-6">
    <div class="settings-frame mx-auto max-w-3xl">
      <header class="settings-header mb-5 flex flex-wrap items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <RouterLink to="/app">
            <n-button quaternary circle :title="locale.t('backToWorkspace')">
              <template #icon><n-icon><ArrowLeft /></n-icon></template>
            </n-button>
          </RouterLink>
          <MebiusBrand size="compact" :text="false" />
          <div class="min-w-0">
            <h1 class="settings-title m-0 text-xl font-semibold">{{ locale.t('accountSecurity') }}</h1>
            <p class="m-0 text-sm text-mebius-muted">{{ locale.t('accountSecurityHint') }}</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <ThemeToggle />
          <n-button size="small" quaternary @click="locale.toggleLocale">
            {{ locale.t('languageSwitch') }}
          </n-button>
        </div>
      </header>

      <n-alert v-if="error" class="mb-4" type="error" :show-icon="false">{{ error }}</n-alert>
      <n-alert v-else-if="saved" class="mb-4" type="success" :show-icon="false">
        {{ locale.t('passwordChanged') }}
      </n-alert>

      <section class="settings-panel settings-panel--padded">
        <div class="mb-5 flex items-start gap-3">
          <n-icon class="mt-1 text-emerald-500"><KeyRound /></n-icon>
          <div>
            <h2 class="m-0 text-base font-semibold">{{ locale.t('changePassword') }}</h2>
            <p class="m-0 text-sm text-mebius-muted">
              {{ auth.user?.nickname || auth.user?.email }}
            </p>
          </div>
        </div>

        <n-form label-placement="top" autocomplete="off" @submit.prevent="changePassword">
          <n-form-item :label="locale.t('currentPassword')">
            <n-input
              v-model:value="form.currentPassword"
              type="password"
              show-password-on="mousedown"
              autocomplete="current-password"
            />
          </n-form-item>
          <n-form-item :label="locale.t('newPassword')">
            <n-input
              v-model:value="form.newPassword"
              type="password"
              show-password-on="mousedown"
              autocomplete="new-password"
            />
          </n-form-item>
          <n-form-item :label="locale.t('confirmNewPassword')">
            <n-input
              v-model:value="form.confirmPassword"
              type="password"
              show-password-on="mousedown"
              autocomplete="new-password"
            />
          </n-form-item>
          <n-button
            attr-type="submit"
            type="primary"
            :loading="saving"
            :disabled="!canSubmit"
          >
            <template #icon><n-icon><Save /></n-icon></template>
            {{ locale.t('changePassword') }}
          </n-button>
        </n-form>
      </section>
    </div>
  </main>
</template>
