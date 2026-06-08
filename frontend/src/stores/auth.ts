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
import type { User, UserPreferences, UserPreferencesPatch } from '../api/types';
import { router } from '../router';

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
}

export const defaultUserPreferences: UserPreferences = {
  layout: {
    leftSidebarCollapsed: false,
    rightSidebarCollapsed: false,
    leftSidebarWidth: 280,
    rightSidebarWidth: 420,
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
    loading: false,
  }),
  actions: {
    async login(email: string, password: string) {
      this.loading = true;
      try {
        const result = await login(email, password);
        this.user = normalizeUser(result.user);
        this.token = result.accessToken;
        setAccessToken(result.accessToken);
        await router.push({ name: 'app' });
      } finally {
        this.loading = false;
      }
    },
    async register(input: {
      email: string;
      name: string;
      password: string;
      verificationCode: string;
      adminInviteCode?: string;
    }) {
      this.loading = true;
      try {
        const result = await register(input);
        this.user = normalizeUser(result.user);
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
        return this.user;
      } catch (error) {
        this.user = previous;
        throw error;
      }
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
      leftSidebarWidth: normalizeLayoutWidth(layout.leftSidebarWidth, layoutWidthLimits.leftSidebarWidth),
      rightSidebarWidth: normalizeLayoutWidth(layout.rightSidebarWidth, layoutWidthLimits.rightSidebarWidth),
    },
  };
}

function mergePreferences(current: UserPreferences, patch: UserPreferencesPatch): UserPreferences {
  return {
    layout: {
      ...current.layout,
      ...pickBooleanLayout(patch),
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
