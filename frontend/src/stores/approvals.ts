import { defineStore } from 'pinia';
import { request } from '../api/http';
import type { Approval } from '../api/types';

interface ApprovalState {
  pending: Approval[];
  loading: boolean;
}

export const useApprovalStore = defineStore('approvals', {
  state: (): ApprovalState => ({
    pending: [],
    loading: false,
  }),
  actions: {
    async loadPending() {
      this.loading = true;
      try {
        this.pending = await request<Approval[]>('/approvals/pending');
      } finally {
        this.loading = false;
      }
    },
    async approve(id: string) {
      await request(`/approvals/${id}/approve`, { method: 'POST' });
      await this.loadPending();
    },
    async reject(id: string) {
      await request(`/approvals/${id}/reject`, { method: 'POST' });
      await this.loadPending();
    },
  },
});
