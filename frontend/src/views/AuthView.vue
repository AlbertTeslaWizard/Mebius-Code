<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useMessage } from 'naive-ui';
import { Code2 } from 'lucide-vue-next';
import { useAuthStore } from '../stores/auth';
import { useLocaleStore } from '../stores/locale';

const route = useRoute();
const message = useMessage();
const auth = useAuthStore();
const locale = useLocaleStore();
const isRegister = computed(() => route.name === 'register');
const error = ref('');
const form = reactive({
  email: '',
  name: '',
  password: '',
  adminInviteCode: '',
});

async function submit() {
  error.value = '';
  try {
    if (isRegister.value) {
      await auth.register({
        email: form.email,
        name: form.name,
        password: form.password,
        adminInviteCode: form.adminInviteCode || undefined,
      });
      message.success(locale.t('accountCreated'));
      return;
    }
    await auth.login(form.email, form.password);
    message.success(locale.t('signedIn'));
  } catch (err) {
    error.value = err instanceof Error ? err.message : locale.t('authFailed');
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-mebius-bg px-6">
    <section class="w-full max-w-[420px] rounded border border-mebius-border bg-white p-7 shadow-sm">
      <div class="mb-7 flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded bg-mebius-accent text-white">
          <n-icon size="22"><Code2 /></n-icon>
        </div>
        <div>
          <h1 class="m-0 text-xl font-semibold">Mebius Code</h1>
          <p class="m-0 text-sm text-mebius-muted">
            {{ isRegister ? locale.t('createWorkspaceAccount') : locale.t('signInWorkspace') }}
          </p>
        </div>
        <n-button class="ml-auto" size="small" quaternary @click="locale.toggleLocale">
          {{ locale.t('languageSwitch') }}
        </n-button>
      </div>

      <n-alert v-if="error" class="mb-4" type="error" :show-icon="false">
        {{ error }}
      </n-alert>

      <n-form label-placement="top" @submit.prevent="submit">
        <n-form-item v-if="isRegister" :label="locale.t('name')">
          <n-input v-model:value="form.name" :placeholder="locale.t('yourName')" autocomplete="name" />
        </n-form-item>
        <n-form-item :label="locale.t('email')">
          <n-input v-model:value="form.email" :placeholder="locale.t('emailPlaceholder')" autocomplete="email" />
        </n-form-item>
        <n-form-item :label="locale.t('password')">
          <n-input
            v-model:value="form.password"
            :placeholder="locale.t('password')"
            type="password"
            show-password-on="mousedown"
            autocomplete="current-password"
          />
        </n-form-item>
        <n-form-item v-if="isRegister" :label="locale.t('adminInviteCode')">
          <n-input v-model:value="form.adminInviteCode" :placeholder="locale.t('optional')" autocomplete="off" />
        </n-form-item>

        <n-button
          attr-type="submit"
          block
          type="primary"
          :loading="auth.loading"
          :disabled="!form.email || !form.password || (isRegister && !form.name)"
        >
          {{ isRegister ? locale.t('createAccount') : locale.t('signIn') }}
        </n-button>
      </n-form>

      <p class="mb-0 mt-5 text-center text-sm text-mebius-muted">
        <template v-if="isRegister">
          {{ locale.t('alreadyHaveAccount') }}
          <RouterLink class="text-mebius-accent" to="/login">{{ locale.t('signIn') }}</RouterLink>
        </template>
        <template v-else>
          {{ locale.t('needAccount') }}
          <RouterLink class="text-mebius-accent" to="/register">{{ locale.t('register') }}</RouterLink>
        </template>
      </p>
    </section>
  </main>
</template>
