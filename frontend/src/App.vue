<script setup lang="ts">
import { computed } from 'vue';
import { dateEnUS, dateZhCN, enUS, zhCN } from 'naive-ui';
import { useLocaleStore } from './stores/locale';

const locale = useLocaleStore();
const naiveLocale = computed(() => (locale.current === 'zh-CN' ? zhCN : enUS));
const naiveDateLocale = computed(() => (locale.current === 'zh-CN' ? dateZhCN : dateEnUS));
</script>

<template>
  <n-config-provider :locale="naiveLocale" :date-locale="naiveDateLocale">
    <n-message-provider>
      <router-view />
    </n-message-provider>
  </n-config-provider>
</template>
