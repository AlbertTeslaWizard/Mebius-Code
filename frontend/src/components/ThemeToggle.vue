<script setup lang="ts">
import { computed } from 'vue';
import { Moon, Sun } from 'lucide-vue-next';
import { useAuthStore } from '../stores/auth';
import { useLocaleStore } from '../stores/locale';

withDefaults(
  defineProps<{
    size?: 'tiny' | 'small' | 'medium' | 'large';
    text?: boolean;
  }>(),
  {
    size: 'small',
    text: false,
  },
);

const auth = useAuthStore();
const locale = useLocaleStore();
const nextThemeLabel = computed(() =>
  auth.themeMode === 'dark' ? locale.t('themeLight') : locale.t('themeDark'),
);
const title = computed(() => `${locale.t('toggleTheme')}: ${nextThemeLabel.value}`);
const icon = computed(() => (auth.themeMode === 'dark' ? Sun : Moon));
</script>

<template>
  <n-button
    :size="size"
    :circle="!text"
    quaternary
    :title="title"
    :aria-label="title"
    @click="auth.toggleTheme"
  >
    <template #icon>
      <n-icon><component :is="icon" /></n-icon>
    </template>
    <template v-if="text">{{ nextThemeLabel }}</template>
  </n-button>
</template>
