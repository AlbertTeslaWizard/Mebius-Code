<script setup lang="ts">
import { computed, watchEffect } from 'vue';
import { darkTheme, dateEnUS, dateZhCN, enUS, lightTheme, zhCN } from 'naive-ui';
import type { GlobalThemeOverrides } from 'naive-ui';
import { useAuthStore } from './stores/auth';
import { useLocaleStore } from './stores/locale';

const locale = useLocaleStore();
const auth = useAuthStore();
const naiveLocale = computed(() => (locale.current === 'zh-CN' ? zhCN : enUS));
const naiveDateLocale = computed(() => (locale.current === 'zh-CN' ? dateZhCN : dateEnUS));
const naiveTheme = computed(() => (auth.themeMode === 'dark' ? darkTheme : lightTheme));
const themeOverrides = computed<GlobalThemeOverrides>(() =>
  auth.themeMode === 'dark'
    ? {
        common: {
          primaryColor: '#ff9f43',
          primaryColorHover: '#ffb86b',
          primaryColorPressed: '#e77817',
          primaryColorSuppl: '#14b8a6',
          bodyColor: '#070a12',
          cardColor: '#101722',
          modalColor: '#101722',
          popoverColor: '#121b28',
          tableColor: '#101722',
          borderColor: 'rgba(148, 163, 184, 0.24)',
          textColorBase: '#eef4ff',
          textColor1: '#eef4ff',
          textColor2: '#c7d2e1',
          textColor3: '#8ea0b7',
        },
        Button: {
          borderRadiusMedium: '8px',
          borderRadiusSmall: '7px',
          colorQuaternary: 'rgba(255, 255, 255, 0.03)',
          colorQuaternaryHover: 'rgba(255, 159, 67, 0.12)',
          textColorPrimary: '#171007',
        },
        Card: {
          borderRadius: '8px',
          color: '#101722',
        },
        Input: {
          borderRadius: '8px',
          color: 'rgba(10, 16, 26, 0.72)',
          colorFocus: 'rgba(13, 22, 36, 0.88)',
          border: '1px solid rgba(148, 163, 184, 0.28)',
          borderHover: '1px solid rgba(255, 159, 67, 0.58)',
          borderFocus: '1px solid rgba(255, 159, 67, 0.88)',
          boxShadowFocus: '0 0 0 3px rgba(255, 159, 67, 0.16)',
        },
      }
    : {
        common: {
          primaryColor: '#0f766e',
          primaryColorHover: '#11877d',
          primaryColorPressed: '#0a5d57',
          primaryColorSuppl: '#ff9f43',
          bodyColor: '#f8fafc',
          cardColor: '#ffffff',
          modalColor: '#ffffff',
          popoverColor: '#ffffff',
          tableColor: '#ffffff',
          tableHeaderColor: '#f3f4f6',
          borderColor: '#d1d5db',
          dividerColor: '#d1d5db',
          actionColor: '#f3f4f6',
          hoverColor: '#e5f3f1',
          pressedColor: '#d2eae5',
          inputColor: '#ffffff',
          codeColor: '#f3f4f6',
          tabColor: '#ffffff',
          textColorBase: '#111827',
          textColor1: '#111827',
          textColor2: '#4b5563',
          textColor3: '#6b7280',
          textColorDisabled: 'rgba(17, 24, 39, 0.65)',
          placeholderColor: '#6b7280',
          placeholderColorDisabled: 'rgba(107, 114, 128, 0.65)',
          iconColor: '#6b7280',
          iconColorHover: '#111827',
          iconColorPressed: '#0f766e',
          iconColorDisabled: 'rgba(107, 114, 128, 0.65)',
        },
        Button: {
          borderRadiusMedium: '8px',
          borderRadiusSmall: '7px',
          opacityDisabled: '0.72',
          colorQuaternary: 'rgba(15, 118, 110, 0.07)',
          colorQuaternaryHover: 'rgba(15, 118, 110, 0.14)',
          colorQuaternaryPressed: 'rgba(15, 118, 110, 0.2)',
          colorDisabled: '#f3f4f6',
          textColor: '#111827',
          textColorHover: '#111827',
          textColorPressed: '#0f766e',
          textColorFocus: '#111827',
          textColorDisabled: '#4b5563',
          textColorText: '#111827',
          textColorTextHover: '#111827',
          textColorTextPressed: '#0f766e',
          textColorTextDisabled: '#4b5563',
          textColorGhost: '#111827',
          textColorGhostHover: '#111827',
          textColorGhostPressed: '#0f766e',
          textColorGhostDisabled: '#4b5563',
          textColorPrimary: '#ffffff',
          textColorHoverPrimary: '#ffffff',
          textColorPressedPrimary: '#ffffff',
          textColorFocusPrimary: '#ffffff',
          textColorDisabledPrimary: '#ffffff',
          border: '1px solid #d1d5db',
          borderHover: '1px solid rgba(15, 118, 110, 0.46)',
          borderPressed: '1px solid rgba(15, 118, 110, 0.64)',
          borderFocus: '1px solid rgba(15, 118, 110, 0.64)',
          borderDisabled: '1px solid #d1d5db',
        },
        Card: {
          borderRadius: '8px',
          color: '#ffffff',
        },
        Input: {
          borderRadius: '8px',
          textColor: '#111827',
          textColorDisabled: 'rgba(17, 24, 39, 0.65)',
          placeholderColor: '#6b7280',
          placeholderColorDisabled: 'rgba(107, 114, 128, 0.65)',
          color: '#ffffff',
          colorDisabled: '#f3f4f6',
          colorFocus: '#ffffff',
          border: '1px solid #d1d5db',
          borderDisabled: '1px solid #d1d5db',
          borderHover: '1px solid rgba(15, 118, 110, 0.54)',
          borderFocus: '1px solid rgba(15, 118, 110, 0.84)',
          boxShadowFocus: '0 0 0 3px rgba(15, 118, 110, 0.15)',
          iconColor: '#6b7280',
          iconColorDisabled: 'rgba(107, 114, 128, 0.65)',
          suffixTextColor: '#4b5563',
        },
        InternalSelection: {
          textColor: '#111827',
          textColorDisabled: 'rgba(17, 24, 39, 0.65)',
          placeholderColor: '#6b7280',
          placeholderColorDisabled: 'rgba(107, 114, 128, 0.65)',
          color: '#ffffff',
          colorActive: '#ffffff',
          colorDisabled: '#f3f4f6',
          border: '1px solid #d1d5db',
          borderDisabled: '1px solid #d1d5db',
          borderHover: '1px solid rgba(15, 118, 110, 0.54)',
          borderActive: '1px solid rgba(15, 118, 110, 0.78)',
          borderFocus: '1px solid rgba(15, 118, 110, 0.78)',
          boxShadowFocus: '0 0 0 3px rgba(15, 118, 110, 0.15)',
          arrowColor: '#6b7280',
        },
        Tabs: {
          tabTextColorLine: '#4b5563',
          tabTextColorHoverLine: '#111827',
          tabTextColorActiveLine: '#0f766e',
          tabTextColorDisabledLine: 'rgba(107, 114, 128, 0.65)',
          barColor: '#0f766e',
          paneTextColor: '#111827',
        },
      },
);

watchEffect(() => {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = auth.themeMode;
  document.documentElement.style.colorScheme = auth.themeMode;
});
</script>

<template>
  <n-config-provider
    :locale="naiveLocale"
    :date-locale="naiveDateLocale"
    :theme="naiveTheme"
    :theme-overrides="themeOverrides"
  >
    <n-message-provider>
      <router-view />
    </n-message-provider>
  </n-config-provider>
</template>
