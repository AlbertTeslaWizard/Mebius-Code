import { defineStore } from 'pinia';
import { clearAccessToken, getAccessToken, login, register, request, setAccessToken } from '../api/http';
import type { User } from '../api/types';
import { router } from '../router';

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
}

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
        this.user = result.user;
        this.token = result.accessToken;
        setAccessToken(result.accessToken);
        await router.push({ name: 'app' });
      } finally {
        this.loading = false;
      }
    },
    async register(input: { email: string; name: string; password: string; adminInviteCode?: string }) {
      this.loading = true;
      try {
        const result = await register(input);
        this.user = result.user;
        this.token = result.accessToken;
        setAccessToken(result.accessToken);
        await router.push({ name: 'app' });
      } finally {
        this.loading = false;
      }
    },
    async fetchMe() {
      if (!getAccessToken()) return;
      this.user = await request<User>('/auth/me');
    },
    async logout() {
      this.user = null;
      this.token = null;
      clearAccessToken();
      await router.push({ name: 'login' });
    },
  },
});
