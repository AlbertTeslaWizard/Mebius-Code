import { createRouter, createWebHistory } from 'vue-router';
import { getAccessToken } from './api/http';
import AuthView from './views/AuthView.vue';
import AuditView from './views/AuditView.vue';
import CommandsView from './views/CommandsView.vue';
import ModelsView from './views/ModelsView.vue';
import WorkspaceView from './views/WorkspaceView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/app' },
    { path: '/login', name: 'login', component: AuthView },
    { path: '/register', name: 'register', component: AuthView },
    { path: '/app', name: 'app', component: WorkspaceView, meta: { requiresAuth: true } },
    {
      path: '/settings/models',
      name: 'models',
      component: ModelsView,
      meta: { requiresAuth: true },
    },
    {
      path: '/settings/commands',
      name: 'commands',
      component: CommandsView,
      meta: { requiresAuth: true },
    },
    {
      path: '/settings/audit',
      name: 'audit',
      component: AuditView,
      meta: { requiresAuth: true },
    },
  ],
});

router.beforeEach((to) => {
  if (to.meta.requiresAuth && !getAccessToken()) {
    return { name: 'login' };
  }
  if ((to.name === 'login' || to.name === 'register') && getAccessToken()) {
    return { name: 'app' };
  }
  return true;
});
