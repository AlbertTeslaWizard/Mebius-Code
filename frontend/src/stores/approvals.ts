import { defineStore } from 'pinia';
import { jsonBody, request } from '../api/http';
import type { Approval } from '../api/types';
import { useWorkspaceStore } from './workspace';

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
    async approve(id: string, mode: 'once' | 'project' = 'once') {
      const workspace = useWorkspaceStore();
      await request(`/approvals/${id}/approve`, { method: 'POST', body: jsonBody({ mode }) });
      await this.loadPending();
      if (workspace.currentSession) {
        await Promise.all([
          workspace.loadMessages(),
          workspace.refreshReviewData(),
          workspace.loadTree(),
          workspace.loadGitStatus(),
        ]);
      }
    },
    async reject(id: string) {
      const workspace = useWorkspaceStore();
      await request(`/approvals/${id}/reject`, { method: 'POST' });
      await this.loadPending();
      if (workspace.currentSession) {
        await Promise.all([workspace.loadMessages(), workspace.refreshReviewData()]);
      }
    },
  },
});
