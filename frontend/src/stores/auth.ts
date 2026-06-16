import { defineStore } from 'pinia';
import {
  clearAccessToken,
  getAccessToken,
  jsonBody,
  login,
  register,
  request,
  setAccessToken,
} from '../api/http';
import type { ThemeMode, User, UserPreferences, UserPreferencesPatch } from '../api/types';
import { router } from '../router';

interface AuthState {
  user: User | null;
  token: string | null;
  themeMode: ThemeMode;
  loading: boolean;
}

const themeKey = 'mebius.theme';

export const defaultUserPreferences: UserPreferences = {
  layout: {
    leftSidebarCollapsed: false,
    rightSidebarCollapsed: false,
    sessionPaneCollapsed: false,
    leftSidebarWidth: 280,
    rightSidebarWidth: 420,
  },
  theme: {
    mode: 'dark',
  },
};

const layoutWidthLimits = {
  leftSidebarWidth: { min: 220, max: 420, defaultValue: 280 },
  rightSidebarWidth: { min: 320, max: 820, defaultValue: 420 },
} as const;

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    token: getAccessToken(),
    themeMode: readThemeMode(),
    loading: false,
  }),
  actions: {
    async login(email: string, password: string) {
      this.loading = true;
      try {
        const result = await login(email, password);
        this.user = normalizeUser(result.user);
        this.applyUserTheme();
        this.token = result.accessToken;
        setAccessToken(result.accessToken);
        await router.push({ name: 'app' });
      } finally {
        this.loading = false;
      }
    },
    async register(input: {
      email: string;
      nickname: string;
      password: string;
      verificationCode: string;
      adminInviteCode?: string;
    }) {
      this.loading = true;
      try {
        const result = await register(input);
        this.user = normalizeUser(result.user);
        this.applyUserTheme();
        this.token = result.accessToken;
        setAccessToken(result.accessToken);
        await router.push({ name: 'app' });
      } finally {
        this.loading = false;
      }
    },
    async fetchMe() {
      if (!getAccessToken()) return;
      this.user = normalizeUser(await request<User>('/auth/me'));
      this.applyUserTheme();
    },
    async updatePreferences(patch: UserPreferencesPatch) {
      if (!this.user) return null;

      const previous = this.user;
      this.user = {
        ...this.user,
        preferences: mergePreferences(this.user.preferences, patch),
      };

      try {
        const updated = await request<User>('/auth/me/preferences', {
          method: 'PATCH',
          body: jsonBody(patch),
        });
        this.user = normalizeUser(updated);
        this.applyUserTheme();
        return this.user;
      } catch (error) {
        this.user = previous;
        this.applyUserTheme();
        throw error;
      }
    },
    async setThemeMode(mode: ThemeMode) {
      const previous = this.themeMode;
      this.themeMode = mode;
      saveThemeMode(mode);

      if (!this.user) return;

      try {
        await this.updatePreferences({ theme: { mode } });
      } catch (error) {
        this.themeMode = previous;
        saveThemeMode(previous);
        throw error;
      }
    },
    async toggleTheme() {
      await this.setThemeMode(this.themeMode === 'dark' ? 'light' : 'dark');
    },
    applyUserTheme() {
      const mode = this.user?.preferences.theme.mode ?? this.themeMode;
      this.themeMode = mode;
      saveThemeMode(mode);
    },
    async logout() {
      this.user = null;
      this.token = null;
      clearAccessToken();
      await router.push({ name: 'login' });
    },
  },
});

function normalizeUser(user: User): User {
  return {
    ...user,
    preferences: normalizePreferences(user.preferences),
  };
}

function normalizePreferences(value: unknown): UserPreferences {
  const source = isRecord(value) ? value : {};
  const layout = isRecord(source.layout) ? source.layout : {};

  return {
    layout: {
      leftSidebarCollapsed: layout.leftSidebarCollapsed === true,
      rightSidebarCollapsed: layout.rightSidebarCollapsed === true,
      sessionPaneCollapsed: layout.sessionPaneCollapsed === true,
      leftSidebarWidth: normalizeLayoutWidth(layout.leftSidebarWidth, layoutWidthLimits.leftSidebarWidth),
      rightSidebarWidth: normalizeLayoutWidth(layout.rightSidebarWidth, layoutWidthLimits.rightSidebarWidth),
    },
    theme: {
      mode: normalizeThemeMode(source.theme),
    },
  };
}

function mergePreferences(current: UserPreferences, patch: UserPreferencesPatch): UserPreferences {
  return {
    layout: {
      ...current.layout,
      ...pickBooleanLayout(patch),
    },
    theme: {
      ...current.theme,
      ...pickTheme(patch),
    },
  };
}

function pickBooleanLayout(patch: UserPreferencesPatch): Partial<UserPreferences['layout']> {
  const layout: Partial<UserPreferences['layout']> = {};
  if (typeof patch.layout?.leftSidebarCollapsed === 'boolean') {
    layout.leftSidebarCollapsed = patch.layout.leftSidebarCollapsed;
  }
  if (typeof patch.layout?.rightSidebarCollapsed === 'boolean') {
    layout.rightSidebarCollapsed = patch.layout.rightSidebarCollapsed;
  }
  if (typeof patch.layout?.sessionPaneCollapsed === 'boolean') {
    layout.sessionPaneCollapsed = patch.layout.sessionPaneCollapsed;
  }
  if (typeof patch.layout?.leftSidebarWidth === 'number') {
    layout.leftSidebarWidth = normalizeLayoutWidth(
      patch.layout.leftSidebarWidth,
      layoutWidthLimits.leftSidebarWidth,
    );
  }
  if (typeof patch.layout?.rightSidebarWidth === 'number') {
    layout.rightSidebarWidth = normalizeLayoutWidth(
      patch.layout.rightSidebarWidth,
      layoutWidthLimits.rightSidebarWidth,
    );
  }
  return layout;
}

function pickTheme(patch: UserPreferencesPatch): Partial<UserPreferences['theme']> {
  if (patch.theme?.mode === 'dark' || patch.theme?.mode === 'light') {
    return { mode: patch.theme.mode };
  }
  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeLayoutWidth(
  value: unknown,
  limits: { min: number; max: number; defaultValue: number },
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return limits.defaultValue;
  }
  return Math.min(limits.max, Math.max(limits.min, Math.round(value)));
}

function normalizeThemeMode(value: unknown): ThemeMode {
  if (isRecord(value) && value.mode === 'light') return 'light';
  return 'dark';
}

function readThemeMode(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'dark';
  return localStorage.getItem(themeKey) === 'light' ? 'light' : 'dark';
}

function saveThemeMode(mode: ThemeMode) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(themeKey, mode);
}
