<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useMessage } from 'naive-ui';
import { Code2 } from 'lucide-vue-next';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const message = useMessage();
const auth = useAuthStore();
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
      message.success('Account created.');
      return;
    }
    await auth.login(form.email, form.password);
    message.success('Signed in.');
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Authentication failed.';
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
            {{ isRegister ? 'Create a workspace account' : 'Sign in to your workspace' }}
          </p>
        </div>
      </div>

      <n-alert v-if="error" class="mb-4" type="error" :show-icon="false">
        {{ error }}
      </n-alert>

      <n-form label-placement="top" @submit.prevent="submit">
        <n-form-item v-if="isRegister" label="Name">
          <n-input v-model:value="form.name" placeholder="Your name" />
        </n-form-item>
        <n-form-item label="Email">
          <n-input v-model:value="form.email" placeholder="you@example.com" />
        </n-form-item>
        <n-form-item label="Password">
          <n-input
            v-model:value="form.password"
            placeholder="Password"
            type="password"
            show-password-on="mousedown"
          />
        </n-form-item>
        <n-form-item v-if="isRegister" label="Admin invite code">
          <n-input v-model:value="form.adminInviteCode" placeholder="Optional" />
        </n-form-item>

        <n-button
          attr-type="submit"
          block
          type="primary"
          :loading="auth.loading"
          :disabled="!form.email || !form.password || (isRegister && !form.name)"
        >
          {{ isRegister ? 'Create account' : 'Sign in' }}
        </n-button>
      </n-form>

      <p class="mb-0 mt-5 text-center text-sm text-mebius-muted">
        <template v-if="isRegister">
          Already have an account?
          <RouterLink class="text-mebius-accent" to="/login">Sign in</RouterLink>
        </template>
        <template v-else>
          Need an account?
          <RouterLink class="text-mebius-accent" to="/register">Register</RouterLink>
        </template>
      </p>
    </section>
  </main>
</template>
