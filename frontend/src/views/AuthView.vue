<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useMessage } from 'naive-ui';
import { sendRegisterVerificationCode } from '../api/http';
import MebiusBrand from '../components/MebiusBrand.vue';
import ThemeToggle from '../components/ThemeToggle.vue';
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
  nickname: '',
  password: '',
  verificationCode: '',
  adminInviteCode: '',
});
const codeSending = ref(false);
const resendAfter = ref(0);
let countdownTimer: ReturnType<typeof setInterval> | undefined;

const canSubmit = computed(
  () =>
    !!form.email &&
    !!form.password &&
    (!isRegister.value || (!!form.nickname && /^\d{6}$/.test(form.verificationCode))),
);
const canSendVerificationCode = computed(
  () => isRegister.value && !!form.email && !codeSending.value && resendAfter.value <= 0,
);

async function sendVerificationCode() {
  if (!canSendVerificationCode.value) return;

  error.value = '';
  codeSending.value = true;
  try {
    const result = await sendRegisterVerificationCode(form.email);
    startResendCountdown(result.resendAfterSeconds);
    message.success(locale.t('verificationCodeSent'));
  } catch (err) {
    error.value = err instanceof Error ? err.message : locale.t('authFailed');
  } finally {
    codeSending.value = false;
  }
}

async function submit() {
  error.value = '';
  try {
    if (isRegister.value) {
      await auth.register({
        email: form.email,
        nickname: form.nickname,
        password: form.password,
        verificationCode: form.verificationCode,
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

function startResendCountdown(seconds: number) {
  clearCountdown();
  resendAfter.value = seconds;
  countdownTimer = setInterval(() => {
    resendAfter.value -= 1;
    if (resendAfter.value <= 0) {
      clearCountdown();
    }
  }, 1000);
}

function clearCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = undefined;
  }
  if (resendAfter.value < 0) {
    resendAfter.value = 0;
  }
}

onUnmounted(clearCountdown);
</script>

<template>
  <main class="auth-shell mebius-app-bg flex min-h-screen items-center justify-center px-5 py-8">
    <section class="auth-card mebius-surface mebius-focus-ring w-full max-w-[440px] rounded-lg p-7">
      <div class="mb-7 flex items-start justify-between gap-3">
        <MebiusBrand
          class="min-w-0 flex-1"
          size="hero"
          :subtitle="isRegister ? locale.t('createWorkspaceAccount') : locale.t('signInWorkspace')"
        />
        <div class="flex shrink-0 items-center gap-1">
          <ThemeToggle />
          <n-button size="small" quaternary @click="locale.toggleLocale">
            {{ locale.t('languageSwitch') }}
          </n-button>
        </div>
      </div>

      <n-alert v-if="error" class="mb-4" type="error" :show-icon="false">
        {{ error }}
      </n-alert>

      <n-form label-placement="top" @submit.prevent="submit">
        <n-form-item v-if="isRegister" :label="locale.t('nickname')">
          <n-input v-model:value="form.nickname" :placeholder="locale.t('yourNickname')" autocomplete="nickname" />
        </n-form-item>
        <n-form-item :label="locale.t('email')">
          <div class="flex w-full gap-2">
            <n-input
              v-model:value="form.email"
              class="min-w-0 flex-1"
              :placeholder="locale.t('emailPlaceholder')"
              autocomplete="email"
            />
            <n-button
              v-if="isRegister"
              class="w-[132px] shrink-0"
              :loading="codeSending"
              :disabled="!canSendVerificationCode"
              @click="sendVerificationCode"
            >
              {{
                resendAfter > 0
                  ? locale.t('resendVerificationCodeIn', { seconds: resendAfter })
                  : locale.t('sendVerificationCode')
              }}
            </n-button>
          </div>
        </n-form-item>
        <n-form-item :label="locale.t('password')">
          <n-input
            v-model:value="form.password"
            :placeholder="locale.t('password')"
            type="password"
            show-password-on="mousedown"
            :autocomplete="isRegister ? 'new-password' : 'current-password'"
          />
        </n-form-item>
        <n-form-item v-if="isRegister" :label="locale.t('verificationCode')">
          <n-input
            v-model:value="form.verificationCode"
            :placeholder="locale.t('verificationCodePlaceholder')"
            autocomplete="one-time-code"
            :maxlength="6"
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
          :disabled="!canSubmit"
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

<style scoped>
.auth-shell {
  overflow: hidden;
  position: relative;
}

.auth-shell::before,
.auth-shell::after {
  content: "";
  pointer-events: none;
  position: absolute;
}

.auth-shell::before {
  background:
    linear-gradient(90deg, rgb(255 255 255 / 7%) 1px, transparent 1px),
    linear-gradient(0deg, rgb(255 255 255 / 5%) 1px, transparent 1px);
  inset: 0;
  mask-image: radial-gradient(circle at 50% 42%, black 0%, transparent 68%);
  opacity: 0.5;
  background-size: 44px 44px;
}

.auth-shell::after {
  background:
    radial-gradient(circle, rgb(255 159 67 / 28%), transparent 52%),
    radial-gradient(circle at 68% 42%, rgb(34 211 238 / 18%), transparent 48%);
  filter: blur(8px);
  height: min(68vw, 760px);
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(82vw, 940px);
}

.auth-card {
  position: relative;
  z-index: 1;
}

:global(:root[data-theme="light"]) .auth-shell::before {
  background:
    linear-gradient(90deg, rgb(15 118 110 / 9%) 1px, transparent 1px),
    linear-gradient(0deg, rgb(15 118 110 / 7%) 1px, transparent 1px);
}

:global(:root[data-theme="light"]) .auth-shell::after {
  background:
    radial-gradient(circle, rgb(15 118 110 / 14%), transparent 52%),
    radial-gradient(circle at 68% 42%, rgb(255 159 67 / 16%), transparent 48%);
}
</style>
