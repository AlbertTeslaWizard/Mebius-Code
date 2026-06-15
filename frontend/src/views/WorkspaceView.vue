<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import {
  Activity,
  AlertCircle,
  Cable,
  Check,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  CircleDot,
  Clock3,
  Clipboard,
  Eye,
  FilePlus,
  FileText,
  Folder,
  FolderTree,
  GitBranch,
  Info,
  ListFilter,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  Pencil,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  Terminal,
  Trash2,
  Wrench,
  X,
} from 'lucide-vue-next';
import type {
  Approval,
  ConnectField,
  ConnectProvider,
  GitStatusFile,
  LayoutPreferences,
  SsePayload,
  TreeNode,
} from '../api/types';
import CodePreview from '../components/CodePreview.vue';
import CodeEditor from '../components/CodeEditor.vue';
import DiffPreview from '../components/DiffPreview.vue';
import MebiusBrand from '../components/MebiusBrand.vue';
import MessageContent from '../components/MessageContent.vue';
import ThemeToggle from '../components/ThemeToggle.vue';
import WorkspaceFileTree from '../components/WorkspaceFileTree.vue';
import { getAccessToken } from '../api/http';
import { useApprovalStore } from '../stores/approvals';
import { defaultUserPreferences, useAuthStore } from '../stores/auth';
import { useLocaleStore } from '../stores/locale';
import { useWorkspaceStore } from '../stores/workspace';

type ComposerMode = 'build' | 'plan';
type SidebarSide = 'left' | 'right';
type WorkspaceResizeTarget = 'sessions' | 'file-tree';
type FilePaneMode = 'preview' | 'editor';
type EventFilter = 'all' | 'model' | 'tools' | 'commands' | 'messages';
type ImportMode = 'git' | 'archive';
type WorkbenchTab = 'files' | 'review' | 'runs' | 'events';

const mainWorkspaceMinWidth = 360;
const sidebarResizeStep = 16;
const chatFollowThreshold = 96;
const sidebarWidthLimits = {
  left: { min: 240, max: 560, defaultValue: 320 },
  right: { min: 360, max: 1200, defaultValue: 560 },
};
const sessionPaneWidthLimits = { min: 160, max: 420, defaultValue: 240 };
const fileTreeHeightLimits = { min: 150, defaultValue: 300 };

const auth = useAuthStore();
const workspace = useWorkspaceStore();
const approvals = useApprovalStore();
const locale = useLocaleStore();
const router = useRouter();

const projectForm = reactive({ name: '', description: '' });
const importForm = reactive({ gitUrl: '', branch: '' });
const importMode = ref<ImportMode>('git');
const projectImportOpen = ref(false);
const gitPublishOpen = ref(false);
const archiveFile = ref<File | null>(null);
const archiveFileInput = ref<HTMLInputElement | null>(null);
const gitCommitMessage = ref('');
const sessionTitle = ref('');
const sessionRenameTitle = ref('');
const composer = ref('');
const composerMode = ref<ComposerMode>('build');
const activeWorkbenchTab = ref<WorkbenchTab>('files');
const manualCommand = ref('');
const manualCommandCwd = ref('');
const selectedFilePath = ref('');
const newFileModal = ref(false);
const newFilePath = ref('');
const newFileError = ref('');
const newFileLoading = ref(false);
const renameFileModal = ref(false);
const renameFileSourcePath = ref('');
const renameFilePath = ref('');
const renameFileError = ref('');
const renameFileLoading = ref(false);
const filePaneMode = ref<FilePaneMode>('preview');
const editorContent = ref('');
const fileSaveLoading = ref(false);
const fileSaveError = ref('');
const expandedFilePaths = ref<string[]>([]);
const filePreviewLoading = ref(false);
const fileTreeRefreshing = ref(false);
const filePreviewError = ref('');
const connectModal = ref(false);
const connectQuery = ref('');
const connectProviders = ref<ConnectProvider[]>([]);
const connectSelected = ref<ConnectProvider | null>(null);
const connectFields = ref<ConnectField[]>([]);
const connectForm = reactive<Record<string, string>>({});
const lastConnectCommandQuery = ref<string | null>(null);
const leftSidebarBody = ref<HTMLElement | null>(null);
const chatScrollContainer = ref<HTMLElement | null>(null);
const shouldFollowChat = ref(true);
const isCompactViewport = ref(false);
const leftOverlayOpen = ref(false);
const rightOverlayOpen = ref(false);
const sessionRenameModal = ref(false);
const sessionRenameTargetId = ref('');
const sessionRenameTargetName = ref('');
const busy = ref(false);
const error = ref('');
const viewportWidth = ref(typeof window === 'undefined' ? 1440 : window.innerWidth);
const expandedCommandRunIds = ref<string[]>([]);
const copiedCommandRunId = ref('');
const eventFilter = ref<EventFilter>('all');
const liveLeftSidebarWidth = ref<number>(sidebarWidthLimits.left.defaultValue);
const liveRightSidebarWidth = ref<number>(sidebarWidthLimits.right.defaultValue);
const liveSessionPaneWidth = ref<number>(sessionPaneWidthLimits.defaultValue);
const liveFileTreeHeight = ref<number>(fileTreeHeightLimits.defaultValue);
const activeResizeSide = ref<SidebarSide | null>(null);
const activeWorkspaceResizeTarget = ref<WorkspaceResizeTarget | null>(null);
let compactViewportQuery: MediaQueryList | null = null;
let filePreviewRequest = 0;
let chatScrollQueued = false;
let chatScrollFrame: number | null = null;
let sidebarResizeState: { side: SidebarSide; startX: number; startWidth: number } | null = null;
let sessionResizeState: { startX: number; startWidth: number } | null = null;
let fileTreeResizeState: { startY: number; startHeight: number } | null = null;

const canChat = computed(() => Boolean(workspace.currentSession));
const fileTreeStats = computed(() => countTree(workspace.fileTree));
const activeModelLabel = computed(
  () =>
    workspace.currentSession?.activeModelConfig?.displayName ||
    workspace.currentSession?.activeModelConfig?.modelName ||
    locale.t('currentModelFallback'),
);
const modelOptions = computed(() =>
  workspace.modelConfigs.map((config) => ({
    label: `${config.displayName} · ${config.modelName}`,
    value: config.id,
  })),
);
const canSubmitComposer = computed(
  () =>
    canChat.value &&
    Boolean(composer.value.trim()) &&
    !busy.value &&
    workspace.agentActivity?.status !== 'waiting_for_approval',
);
const canExecutePlan = computed(() => workspace.activePlan?.plan.status === 'approved' && canChat.value && !busy.value);
const commandRunStats = computed(() => {
  const stats = { total: workspace.commandRuns.length, succeeded: 0, failed: 0, running: 0 };
  workspace.commandRuns.forEach((run) => {
    if (run.status === 'succeeded') stats.succeeded += 1;
    if (run.status === 'failed') stats.failed += 1;
    if (run.status === 'running' || run.status === 'pending') stats.running += 1;
  });
  return stats;
});
const commandOptions = computed(() =>
  workspace.allowedCommands.map((command) => ({
    label: command,
    value: command,
  })),
);
const hasSessionCommandAutoRun = computed(() => workspace.commandAuthorization?.shellAutoRun === true);
const commandDirectoryOptions = computed(() => [
  { label: locale.t('commandCwdRoot'), value: '' },
  ...collectDirectoryOptions(workspace.fileTree),
]);
const canSubmitManualCommand = computed(
  () =>
    Boolean(workspace.currentSession) &&
    Boolean(manualCommand.value.trim()) &&
    !busy.value &&
    !workspace.allowedCommandsLoading &&
    !workspace.commandAuthorizationLoading,
);
const normalizedSessionRenameTitle = computed(() => sessionRenameTitle.value.trim());
const canSubmitSessionRename = computed(
  () =>
    normalizedSessionRenameTitle.value.length >= 2 &&
    normalizedSessionRenameTitle.value.length <= 120 &&
    normalizedSessionRenameTitle.value !== sessionRenameTargetName.value,
);
const showNoAllowedCommands = computed(
  () =>
    Boolean(workspace.currentSession) &&
    !hasSessionCommandAutoRun.value &&
    !workspace.allowedCommandsLoading &&
    workspace.allowedCommands.length === 0,
);
const noAllowedCommandsHint = computed(() =>
  auth.user?.role === 'admin' ? locale.t('noAllowedCommandsAdmin') : locale.t('noAllowedCommandsUser'),
);
const composerModeOptions = computed<Array<{ label: string; value: ComposerMode }>>(() => [
  { label: locale.t('build'), value: 'build' },
  { label: locale.t('plan'), value: 'plan' },
]);
const filePaneModeOptions = computed<Array<{ label: string; value: FilePaneMode }>>(() => [
  { label: locale.t('preview'), value: 'preview' },
  { label: locale.t('editor'), value: 'editor' },
]);
const eventFilterOptions = computed<Array<{ label: string; value: EventFilter }>>(() => [
  { label: locale.t('eventFilterAll'), value: 'all' },
  { label: locale.t('eventFilterModel'), value: 'model' },
  { label: locale.t('eventFilterTools'), value: 'tools' },
  { label: locale.t('eventFilterGit'), value: 'commands' },
  { label: locale.t('eventFilterMessages'), value: 'messages' },
]);
const settingsOptions = computed(() => [
  { label: locale.t('modelConfigs'), key: 'models' },
  ...(auth.user?.role === 'admin' ? [{ label: locale.t('commandPolicy'), key: 'commands' }] : []),
  { label: locale.t('auditLogs'), key: 'audit' },
  { label: locale.t('signOut'), key: 'logout' },
]);
const connectReady = computed(() =>
  connectFields.value.every((field) => !field.required || Boolean(connectForm[field.name]?.trim())),
);
const layoutPreferences = computed(() => auth.user?.preferences ?? defaultUserPreferences);
const leftSidebarCollapsed = computed(() => layoutPreferences.value.layout.leftSidebarCollapsed);
const rightSidebarCollapsed = computed(() => layoutPreferences.value.layout.rightSidebarCollapsed);
const sessionPaneCollapsed = computed(() => layoutPreferences.value.layout.sessionPaneCollapsed);
const resolvedSidebarWidths = computed(() =>
  resolveSidebarWidths(
    leftSidebarCollapsed.value ? 0 : liveLeftSidebarWidth.value,
    rightSidebarCollapsed.value ? 0 : liveRightSidebarWidth.value,
    activeResizeSide.value,
  ),
);
const effectiveLeftSidebarWidth = computed(() => resolvedSidebarWidths.value.left);
const effectiveRightSidebarWidth = computed(() => resolvedSidebarWidths.value.right);
const leftSidebarInert = computed(() =>
  isCompactViewport.value ? !leftOverlayOpen.value : leftSidebarCollapsed.value,
);
const rightSidebarInert = computed(() =>
  isCompactViewport.value ? !rightOverlayOpen.value : rightSidebarCollapsed.value,
);
const hasOverlayOpen = computed(() => leftOverlayOpen.value || rightOverlayOpen.value);
const workspaceGridStyle = computed<Record<string, string>>(() => ({
  '--left-sidebar-width': `${effectiveLeftSidebarWidth.value}px`,
  '--right-sidebar-width': `${effectiveRightSidebarWidth.value}px`,
}));
const workspaceContentStyle = computed<Record<string, string>>(() => ({
  '--session-pane-width': `${sessionPaneCollapsed.value ? 0 : liveSessionPaneWidth.value}px`,
}));
const fileWorkbenchStyle = computed<Record<string, string>>(() => ({
  '--file-tree-pane-height': `${liveFileTreeHeight.value}px`,
}));
const leftSidebarToggleLabel = computed(() => {
  if (isCompactViewport.value) {
    return leftOverlayOpen.value ? locale.t('closeSidebar') : locale.t('openLeftSidebar');
  }
  return leftSidebarCollapsed.value ? locale.t('expandLeftSidebar') : locale.t('collapseLeftSidebar');
});
const rightSidebarToggleLabel = computed(() => {
  if (isCompactViewport.value) {
    return rightOverlayOpen.value ? locale.t('closeSidebar') : locale.t('openRightSidebar');
  }
  return rightSidebarCollapsed.value ? locale.t('expandRightSidebar') : locale.t('collapseRightSidebar');
});
const sessionPaneToggleLabel = computed(() =>
  sessionPaneCollapsed.value ? locale.t('expandSessionPane') : locale.t('collapseSessionPane'),
);
const leftSidebarToggleIcon = computed(() =>
  isCompactViewport.value
    ? leftOverlayOpen.value
      ? PanelLeftClose
      : PanelLeftOpen
    : leftSidebarCollapsed.value
      ? PanelLeftOpen
      : PanelLeftClose,
);
const rightSidebarToggleIcon = computed(() =>
  isCompactViewport.value
    ? rightOverlayOpen.value
      ? PanelRightClose
      : PanelRightOpen
    : rightSidebarCollapsed.value
      ? PanelRightOpen
      : PanelRightClose,
);
const sessionPaneToggleIcon = computed(() => (sessionPaneCollapsed.value ? PanelLeftOpen : PanelLeftClose));
const isImportingProject = computed(() => workspace.gitImportStatus === 'running');
const isLoadingGitStatus = computed(() => workspace.gitStatusLoading);
const isPublishingGit = computed(() => workspace.gitPublishStatus === 'running');
const gitStatus = computed(() => workspace.gitStatus);
const pushableGitCommits = computed(() => gitStatus.value?.pushableCommits ?? 0);
const projectWorkspaceHasContent = computed(() => fileTreeStats.value.files + fileTreeStats.value.directories > 0);
const archiveFileName = computed(() => archiveFile.value?.name ?? locale.t('noArchiveFileSelected'));
const projectImportFeedback = computed(() => {
  const isArchiveImport = importMode.value === 'archive';
  if (workspace.gitImportStatus === 'running') {
    return isArchiveImport ? locale.t('archiveImportRunning') : locale.t('gitImportRunning');
  }
  if (workspace.gitImportStatus === 'success') {
    return isArchiveImport ? locale.t('archiveImportComplete') : locale.t('gitImportComplete');
  }
  if (workspace.gitImportStatus === 'error') {
    return workspace.gitImportError || (isArchiveImport ? locale.t('archiveImportFailed') : locale.t('gitImportFailed'));
  }
  return '';
});
const gitPublishFeedback = computed(() => workspace.gitPublishMessage);
const projectImportFeedbackClass = computed(() => {
  if (workspace.gitImportStatus === 'error') return 'text-red-600';
  if (workspace.gitImportStatus === 'success') return 'text-mebius-accent';
  return 'text-mebius-muted';
});
const gitPublishFeedbackClass = computed(() => {
  if (workspace.gitPublishStatus === 'error') return 'text-red-600';
  if (workspace.gitPublishStatus === 'success') return 'text-mebius-accent';
  return 'text-mebius-muted';
});
const canCommitGit = computed(
  () =>
    Boolean(workspace.currentProject) &&
    gitStatus.value?.isGitRepo === true &&
    (gitStatus.value?.counts.staged ?? 0) > 0 &&
    Boolean(gitCommitMessage.value.trim()) &&
    !busy.value &&
    !isPublishingGit.value,
);
const canPushGit = computed(
  () =>
    Boolean(workspace.currentProject) &&
    gitStatus.value?.isGitRepo === true &&
    gitStatus.value.hasRemote &&
    pushableGitCommits.value > 0 &&
    !busy.value &&
    !isPublishingGit.value,
);
const pushStatusHint = computed(() => {
  if (gitStatus.value?.isGitRepo !== true) return '';
  if (isPublishingGit.value || busy.value) return locale.t('gitPushBusy');
  if (!gitStatus.value.hasRemote) return locale.t('gitRequiresRemote');
  if (pushableGitCommits.value > 0) {
    return locale.t('gitReadyToPush', { count: String(pushableGitCommits.value) });
  }
  return locale.t('gitNoCommitsToPush');
});
const canStageAllGit = computed(
  () =>
    Boolean(workspace.currentProject) &&
    gitStatus.value?.isGitRepo === true &&
    gitStatus.value.files.some((file) => canStageFile(file)) &&
    !busy.value &&
    !isPublishingGit.value,
);
const canUnstageAllGit = computed(
  () =>
    Boolean(workspace.currentProject) &&
    gitStatus.value?.isGitRepo === true &&
    gitStatus.value.files.some((file) => canUnstageFile(file)) &&
    !busy.value &&
    !isPublishingGit.value,
);
const agentActivityText = computed(() => {
  const activity = workspace.agentActivity;
  if (!activity) return '';
  if (activity.message) return activity.message;
  if (activity.status === 'failed') return locale.t('agentFailed');
  if (activity.toolName === 'create_patch') {
    const target = formatActivityTarget(activity.targetPaths);
    if (activity.status === 'waiting_for_approval') {
      return locale.t('agentWaitingPatchApproval', { target });
    }
    if (activity.activity === 'preparing_patch') {
      return locale.t('agentPreparingPatch', { target });
    }
    if (activity.activity === 'patch_applied') {
      return locale.t('agentPatchApplied', { target });
    }
    return locale.t('agentApplyingPatch', { target });
  }
  if (activity.toolName === 'run_command' && activity.command) {
    return locale.t('agentRunningCommand', { command: truncate(activity.command, 64) });
  }
  if (activity.status === 'thinking') return locale.t('agentThinking');
  if (activity.activity === 'stream_fallback') return locale.t('agentStreamFallback');
  if (activity.status === 'responding') return locale.t('agentResponding');
  if (activity.status === 'using_tools') {
    return activity.toolName
      ? locale.t('agentUsingTool', { tool: activity.toolName })
      : locale.t('agentUsingTools');
  }
  if (activity.status === 'waiting_for_approval') {
    return activity.toolName
      ? locale.t('agentWaitingToolApproval', { tool: activity.toolName })
      : locale.t('agentWaitingApproval');
  }
  return activity.message || locale.t('agentFailed');
});
const agentActivityIcon = computed(() => {
  const activity = workspace.agentActivity;
  if (!activity) return RefreshCw;
  if (activity.status === 'failed') return AlertCircle;
  if (activity.status === 'waiting_for_approval' || activity.status === 'needs_continuation') return Clock3;
  if (activity.toolName === 'create_patch') return FileText;
  if (activity.toolName === 'run_command') return Terminal;
  if (activity.status === 'using_tools') return Wrench;
  return RefreshCw;
});
const agentActivitySpins = computed(
  () => {
    const activity = workspace.agentActivity;
    return (
      activity?.status === 'thinking' ||
      activity?.status === 'responding' ||
      (activity?.status === 'using_tools' && !activity.toolName)
    );
  },
);
const agentActivityToneClass = computed(() => {
  if (workspace.agentActivity?.status === 'failed') return 'border-red-200 bg-red-50 text-red-700';
  if (
    workspace.agentActivity?.status === 'waiting_for_approval' ||
    workspace.agentActivity?.status === 'needs_continuation'
  ) {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  return 'border-mebius-border bg-white text-mebius-muted';
});
const isCurrentFileDirty = computed(
  () => Boolean(workspace.currentFile) && editorContent.value !== (workspace.currentFile?.content ?? ''),
);
const filteredEventLog = computed(() =>
  workspace.eventLog.filter((event) => eventMatchesFilter(event.type, eventFilter.value)),
);
const modelDiagnosticSummary = computed(() => {
  const diagnostic = workspace.latestModelDiagnostic;
  if (!diagnostic) return locale.t('modelDiagnosticsIdle');
  return locale.t('modelDiagnosticsSummary', {
    status: diagnostic.status,
    model: diagnostic.modelName || diagnostic.displayName || locale.t('currentModelFallback'),
  });
});

onMounted(async () => {
  setupCompactViewportQuery();
  window.addEventListener('resize', handleWindowResize);
  window.addEventListener('beforeunload', handleBeforeUnload);
  try {
    await Promise.all([auth.fetchMe(), approvals.loadPending()]);
    await workspace.bootstrap();
  } catch (err) {
    error.value = err instanceof Error ? err.message : locale.t('operationFailed');
    if (!getAccessToken()) {
      await router.replace({ name: 'login' });
    }
  }
});

onBeforeUnmount(() => {
  cancelScheduledChatScroll();
  cancelSidebarResize();
  cancelSessionResize();
  cancelFileTreeResize();
  window.removeEventListener('resize', handleWindowResize);
  window.removeEventListener('beforeunload', handleBeforeUnload);
  workspace.disconnectEvents();
  compactViewportQuery?.removeEventListener('change', handleCompactViewportChange);
});

watch(
  () => layoutPreferences.value.layout.leftSidebarWidth,
  (width) => {
    if (activeResizeSide.value !== 'left') {
      liveLeftSidebarWidth.value = normalizeSidebarWidth('left', width);
    }
  },
  { immediate: true },
);

watch(
  () => layoutPreferences.value.layout.rightSidebarWidth,
  (width) => {
    if (activeResizeSide.value !== 'right') {
      liveRightSidebarWidth.value = normalizeSidebarWidth('right', width);
    }
  },
  { immediate: true },
);

watch(composer, (value) => {
  const query = parseConnectCommand(value);
  if (query === null) {
    lastConnectCommandQuery.value = null;
    return;
  }
  if (!canChat.value) return;
  if (connectModal.value && lastConnectCommandQuery.value === query) return;
  lastConnectCommandQuery.value = query;
  void openConnect(query);
});

watch(
  () => workspace.currentSession?.id,
  () => {
    shouldFollowChat.value = true;
    scheduleChatScrollToBottom();
  },
);

watch(
  () => {
    const lastMessage = workspace.messages[workspace.messages.length - 1];
    return [
      workspace.currentSession?.id ?? '',
      workspace.messages.length,
      lastMessage?.id ?? '',
      lastMessage?.content.length ?? 0,
      lastMessage?.streaming === true,
      agentActivityText.value,
    ] as const;
  },
  () => {
    if (!shouldFollowChat.value && isChatNearBottom()) {
      shouldFollowChat.value = true;
    }
    scheduleChatScrollToBottom();
  },
  { flush: 'post' },
);

watch(
  () => workspace.currentProject?.id,
  () => {
    selectedFilePath.value = '';
    editorContent.value = '';
    fileSaveError.value = '';
    expandedFilePaths.value = [];
    filePreviewError.value = '';
    filePreviewLoading.value = false;
  },
);

watch(
  () => workspace.currentFile?.path,
  () => {
    editorContent.value = workspace.currentFile?.content ?? '';
    fileSaveError.value = '';
  },
);

watch(
  () => workspace.fileTree,
  (nodes) => {
    const existing = new Set(expandedFilePaths.value);
    const next = new Set<string>(collectInitialDirectoryPaths(nodes));
    existing.forEach((path) => {
      if (findTreeNode(nodes, path)?.type === 'directory') {
        next.add(path);
      }
    });
    expandedFilePaths.value = Array.from(next);
    if (manualCommandCwd.value && findTreeNode(nodes, manualCommandCwd.value)?.type !== 'directory') {
      manualCommandCwd.value = '';
    }
  },
  { deep: true },
);

watch(
  () => workspace.allowedCommands,
  (commands) => {
    if (hasSessionCommandAutoRun.value) return;
    if (manualCommand.value && !commands.includes(manualCommand.value)) {
      manualCommand.value = '';
    }
  },
  { deep: true },
);

watch(
  () => workspace.commandRuns[0]?.id,
  (id) => {
    if (id && !expandedCommandRunIds.value.includes(id)) {
      expandedCommandRunIds.value = [id, ...expandedCommandRunIds.value];
    }
  },
);

watch(
  () => workspace.eventLog[0]?.time,
  () => {
    const latestEvent = workspace.eventLog[0];
    if (!latestEvent) return;
    if (['tool_call_requested', 'tool_call_result', 'done'].includes(latestEvent.type)) {
      void approvals.loadPending();
    }
  },
);

watch(importMode, () => {
  workspace.resetGitImportStatus();
});

async function runTask(action: () => Promise<unknown>) {
  busy.value = true;
  error.value = '';
  try {
    await action();
  } catch (err) {
    error.value = err instanceof Error ? err.message : locale.t('operationFailed');
  } finally {
    busy.value = false;
  }
}

async function updateLayoutPreferences(layout: Partial<LayoutPreferences>) {
  error.value = '';
  try {
    await auth.updatePreferences({ layout });
  } catch (err) {
    error.value = err instanceof Error ? err.message : locale.t('operationFailed');
  }
}

function toggleLeftSidebar() {
  if (isCompactViewport.value) {
    leftOverlayOpen.value = !leftOverlayOpen.value;
    rightOverlayOpen.value = false;
    return;
  }

  void updateLayoutPreferences({
    leftSidebarCollapsed: !leftSidebarCollapsed.value,
  });
}

function toggleRightSidebar() {
  if (isCompactViewport.value) {
    rightOverlayOpen.value = !rightOverlayOpen.value;
    leftOverlayOpen.value = false;
    return;
  }

  void updateLayoutPreferences({
    rightSidebarCollapsed: !rightSidebarCollapsed.value,
  });
}

function toggleSessionPane() {
  if (isCompactViewport.value) return;

  cancelSessionResize();
  void updateLayoutPreferences({
    sessionPaneCollapsed: !sessionPaneCollapsed.value,
  });
}

function handleLeftSidebarResizeWheel(event: WheelEvent) {
  const container = leftSidebarBody.value;
  if (!container || leftSidebarCollapsed.value || isCompactViewport.value) return;

  const previousScrollTop = container.scrollTop;
  container.scrollTop += event.deltaY;
  if (container.scrollTop !== previousScrollTop) {
    event.preventDefault();
  }
}

function startSidebarResize(side: SidebarSide, event: PointerEvent) {
  if (isCompactViewport.value || isSidebarCollapsed(side)) return;

  const target = event.currentTarget;
  if (target instanceof HTMLElement) {
    target.setPointerCapture(event.pointerId);
  }

  sidebarResizeState = {
    side,
    startX: event.clientX,
    startWidth: getSidebarWidth(side),
  };
  activeResizeSide.value = side;
  window.addEventListener('pointermove', handleSidebarResizeMove);
  window.addEventListener('pointerup', finishSidebarResize);
  window.addEventListener('pointercancel', finishSidebarResize);
  event.preventDefault();
}

function handleSidebarResizeMove(event: PointerEvent) {
  if (!sidebarResizeState) return;

  const delta = event.clientX - sidebarResizeState.startX;
  const nextWidth =
    sidebarResizeState.side === 'left'
      ? sidebarResizeState.startWidth + delta
      : sidebarResizeState.startWidth - delta;
  setSidebarWidth(sidebarResizeState.side, nextWidth);
}

function finishSidebarResize() {
  const state = sidebarResizeState;
  cancelSidebarResize();
  if (!state) return;

  void persistSidebarWidth(state.side);
}

function cancelSidebarResize() {
  sidebarResizeState = null;
  activeResizeSide.value = null;
  window.removeEventListener('pointermove', handleSidebarResizeMove);
  window.removeEventListener('pointerup', finishSidebarResize);
  window.removeEventListener('pointercancel', finishSidebarResize);
}

function startSessionResize(event: PointerEvent) {
  if (isCompactViewport.value || sessionPaneCollapsed.value) return;

  const target = event.currentTarget;
  if (target instanceof HTMLElement) {
    target.setPointerCapture(event.pointerId);
  }

  sessionResizeState = {
    startX: event.clientX,
    startWidth: liveSessionPaneWidth.value,
  };
  activeWorkspaceResizeTarget.value = 'sessions';
  window.addEventListener('pointermove', handleSessionResizeMove);
  window.addEventListener('pointerup', finishSessionResize);
  window.addEventListener('pointercancel', finishSessionResize);
  event.preventDefault();
}

function handleSessionResizeMove(event: PointerEvent) {
  if (!sessionResizeState) return;
  liveSessionPaneWidth.value = normalizeSessionPaneWidth(
    sessionResizeState.startWidth + event.clientX - sessionResizeState.startX,
  );
}

function finishSessionResize() {
  cancelSessionResize();
}

function cancelSessionResize() {
  sessionResizeState = null;
  if (activeWorkspaceResizeTarget.value === 'sessions') {
    activeWorkspaceResizeTarget.value = null;
  }
  window.removeEventListener('pointermove', handleSessionResizeMove);
  window.removeEventListener('pointerup', finishSessionResize);
  window.removeEventListener('pointercancel', finishSessionResize);
}

function handleSessionResizeKeydown(event: KeyboardEvent) {
  if (isCompactViewport.value || sessionPaneCollapsed.value) return;

  let nextWidth = liveSessionPaneWidth.value;
  if (event.key === 'ArrowRight') {
    nextWidth += sidebarResizeStep;
  } else if (event.key === 'ArrowLeft') {
    nextWidth -= sidebarResizeStep;
  } else if (event.key === 'Home') {
    nextWidth = sessionPaneWidthLimits.min;
  } else if (event.key === 'End') {
    nextWidth = sessionPaneWidthLimits.max;
  } else {
    return;
  }

  event.preventDefault();
  liveSessionPaneWidth.value = normalizeSessionPaneWidth(nextWidth);
}

function normalizeSessionPaneWidth(width: unknown): number {
  if (typeof width !== 'number' || !Number.isFinite(width)) {
    return sessionPaneWidthLimits.defaultValue;
  }
  return Math.min(sessionPaneWidthLimits.max, Math.max(sessionPaneWidthLimits.min, Math.round(width)));
}

function startFileTreeResize(event: PointerEvent) {
  const target = event.currentTarget;
  if (target instanceof HTMLElement) {
    target.setPointerCapture(event.pointerId);
  }

  fileTreeResizeState = {
    startY: event.clientY,
    startHeight: liveFileTreeHeight.value,
  };
  activeWorkspaceResizeTarget.value = 'file-tree';
  window.addEventListener('pointermove', handleFileTreeResizeMove);
  window.addEventListener('pointerup', finishFileTreeResize);
  window.addEventListener('pointercancel', finishFileTreeResize);
  event.preventDefault();
}

function handleFileTreeResizeMove(event: PointerEvent) {
  if (!fileTreeResizeState) return;
  liveFileTreeHeight.value = normalizeFileTreeHeight(
    fileTreeResizeState.startHeight + event.clientY - fileTreeResizeState.startY,
  );
}

function finishFileTreeResize() {
  cancelFileTreeResize();
}

function cancelFileTreeResize() {
  fileTreeResizeState = null;
  if (activeWorkspaceResizeTarget.value === 'file-tree') {
    activeWorkspaceResizeTarget.value = null;
  }
  window.removeEventListener('pointermove', handleFileTreeResizeMove);
  window.removeEventListener('pointerup', finishFileTreeResize);
  window.removeEventListener('pointercancel', finishFileTreeResize);
}

function handleFileTreeResizeKeydown(event: KeyboardEvent) {
  let nextHeight = liveFileTreeHeight.value;
  if (event.key === 'ArrowDown') {
    nextHeight += sidebarResizeStep;
  } else if (event.key === 'ArrowUp') {
    nextHeight -= sidebarResizeStep;
  } else if (event.key === 'Home') {
    nextHeight = fileTreeHeightLimits.min;
  } else if (event.key === 'End') {
    nextHeight = getFileTreeMaxHeight();
  } else {
    return;
  }

  event.preventDefault();
  liveFileTreeHeight.value = normalizeFileTreeHeight(nextHeight);
}

function normalizeFileTreeHeight(height: unknown): number {
  if (typeof height !== 'number' || !Number.isFinite(height)) {
    return fileTreeHeightLimits.defaultValue;
  }
  return Math.min(getFileTreeMaxHeight(), Math.max(fileTreeHeightLimits.min, Math.round(height)));
}

function getFileTreeMaxHeight() {
  return Math.max(fileTreeHeightLimits.min, window.innerHeight - 360);
}

function handleSidebarResizeKeydown(side: SidebarSide, event: KeyboardEvent) {
  if (isCompactViewport.value || isSidebarCollapsed(side)) return;

  const direction = side === 'left' ? 1 : -1;
  let nextWidth = getSidebarWidth(side);

  if (event.key === 'ArrowRight') {
    nextWidth += sidebarResizeStep * direction;
  } else if (event.key === 'ArrowLeft') {
    nextWidth -= sidebarResizeStep * direction;
  } else if (event.key === 'Home') {
    nextWidth = sidebarWidthLimits[side].min;
  } else if (event.key === 'End') {
    nextWidth = sidebarWidthLimits[side].max;
  } else {
    return;
  }

  event.preventDefault();
  activeResizeSide.value = side;
  setSidebarWidth(side, nextWidth);
  void persistSidebarWidth(side).finally(() => {
    if (!sidebarResizeState && activeResizeSide.value === side) {
      activeResizeSide.value = null;
    }
  });
}

function getSidebarWidth(side: SidebarSide): number {
  return side === 'left' ? liveLeftSidebarWidth.value : liveRightSidebarWidth.value;
}

function setSidebarWidth(side: SidebarSide, width: number) {
  const normalized = normalizeSidebarWidth(side, width);
  if (side === 'left') {
    liveLeftSidebarWidth.value = normalized;
  } else {
    liveRightSidebarWidth.value = normalized;
  }
}

async function persistSidebarWidth(side: SidebarSide) {
  if (side === 'left') {
    await updateLayoutPreferences({ leftSidebarWidth: liveLeftSidebarWidth.value });
    return;
  }
  await updateLayoutPreferences({ rightSidebarWidth: liveRightSidebarWidth.value });
}

function isSidebarCollapsed(side: SidebarSide) {
  return side === 'left' ? leftSidebarCollapsed.value : rightSidebarCollapsed.value;
}

function normalizeSidebarWidth(side: SidebarSide, width: unknown): number {
  const limits = sidebarWidthLimits[side];
  if (typeof width !== 'number' || !Number.isFinite(width)) {
    return limits.defaultValue;
  }
  return Math.min(limits.max, Math.max(limits.min, Math.round(width)));
}

function resolveSidebarWidths(left: number, right: number, priority: SidebarSide | null) {
  const next = { left, right };
  const available = Math.max(0, viewportWidth.value - mainWorkspaceMinWidth);
  let overflow = next.left + next.right - available;

  if (overflow <= 0) {
    return next;
  }

  const reductionOrder: SidebarSide[] = priority === 'left' ? ['right', 'left'] : ['left', 'right'];
  reductionOrder.forEach((side) => {
    if (overflow <= 0 || next[side] <= 0) return;
    const minWidth = sidebarWidthLimits[side].min;
    const reduction = Math.min(Math.max(0, next[side] - minWidth), overflow);
    next[side] -= reduction;
    overflow -= reduction;
  });

  reductionOrder.forEach((side) => {
    if (overflow <= 0 || next[side] <= 0) return;
    const reduction = Math.min(next[side], overflow);
    next[side] -= reduction;
    overflow -= reduction;
  });

  return next;
}

function closeSidebars() {
  leftOverlayOpen.value = false;
  rightOverlayOpen.value = false;
}

function handleWindowResize() {
  viewportWidth.value = window.innerWidth;
  liveFileTreeHeight.value = normalizeFileTreeHeight(liveFileTreeHeight.value);
}

function setupCompactViewportQuery() {
  compactViewportQuery = window.matchMedia('(max-width: 1023px)');
  isCompactViewport.value = compactViewportQuery.matches;
  compactViewportQuery.addEventListener('change', handleCompactViewportChange);
}

function handleCompactViewportChange(event: MediaQueryListEvent) {
  isCompactViewport.value = event.matches;
  if (!event.matches) {
    closeSidebars();
  }
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!isCurrentFileDirty.value) return;
  event.preventDefault();
  event.returnValue = '';
}

function gitStateLabel(state: string) {
  switch (state) {
    case 'untracked':
      return locale.t('gitStateUntracked');
    case 'staged':
      return locale.t('gitStateStaged');
    case 'modified':
      return locale.t('gitStateModified');
    case 'deleted':
      return locale.t('gitStateDeleted');
    case 'renamed':
      return locale.t('gitStateRenamed');
    case 'conflicted':
      return locale.t('gitStateConflicted');
    default:
      return locale.t('gitStateUnknown');
  }
}

function canStageFile(file: GitStatusFile) {
  return file.workTreeStatus !== ' ' || file.state === 'untracked';
}

function canUnstageFile(file: GitStatusFile) {
  return file.indexStatus !== ' ' && file.indexStatus !== '?';
}

function handleChatScroll() {
  shouldFollowChat.value = isChatNearBottom();
}

function isChatNearBottom() {
  const container = chatScrollContainer.value;
  if (!container) return true;
  const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
  return distanceFromBottom <= chatFollowThreshold;
}

function scheduleChatScrollToBottom() {
  if (!shouldFollowChat.value || chatScrollQueued) return;
  chatScrollQueued = true;
  void nextTick(() => {
    if (!chatScrollQueued) return;
    if (typeof window === 'undefined') {
      runScheduledChatScroll();
      return;
    }
    chatScrollFrame = window.requestAnimationFrame(runScheduledChatScroll);
  });
}

function runScheduledChatScroll() {
  chatScrollQueued = false;
  chatScrollFrame = null;
  if (!shouldFollowChat.value) return;
  const container = chatScrollContainer.value;
  if (!container) return;
  container.scrollTop = container.scrollHeight;
}

function cancelScheduledChatScroll() {
  if (chatScrollFrame !== null && typeof window !== 'undefined') {
    window.cancelAnimationFrame(chatScrollFrame);
  }
  chatScrollQueued = false;
  chatScrollFrame = null;
}

async function createProject() {
  await runTask(async () => {
    await workspace.createProject({
      name: projectForm.name,
      description: projectForm.description || undefined,
    });
    projectForm.name = '';
    projectForm.description = '';
  });
}

async function deleteProject(projectId: string) {
  await runTask(() => workspace.deleteProject(projectId));
}

async function importGit() {
  await runTask(async () => {
    await workspace.importGit({
      gitUrl: importForm.gitUrl,
      branch: importForm.branch || undefined,
    });
    importForm.gitUrl = '';
    importForm.branch = '';
  });
}

function selectArchiveFile(event: Event) {
  const input = event.target as HTMLInputElement;
  archiveFile.value = input.files?.[0] ?? null;
  workspace.resetGitImportStatus();
}

async function importArchive() {
  if (!archiveFile.value) return;
  await runTask(async () => {
    await workspace.importArchive(archiveFile.value as File);
    archiveFile.value = null;
    if (archiveFileInput.value) {
      archiveFileInput.value.value = '';
    }
  });
}

async function refreshGitStatus() {
  await runTask(async () => {
    await workspace.loadGitStatus();
  });
}

async function commitGit() {
  await runTask(async () => {
    await workspace.commitGit(gitCommitMessage.value);
    gitCommitMessage.value = '';
  });
}

async function stageGitFile(path: string) {
  await runTask(async () => {
    await workspace.stageGitFile(path);
  });
}

async function unstageGitFile(path: string) {
  await runTask(async () => {
    await workspace.unstageGitFile(path);
  });
}

async function stageAllGit() {
  await runTask(async () => {
    await workspace.stageAllGit();
  });
}

async function unstageAllGit() {
  await runTask(async () => {
    await workspace.unstageAllGit();
  });
}

async function pushGit() {
  await runTask(async () => {
    await workspace.pushGit();
  });
}

async function createSession() {
  await runTask(async () => {
    await workspace.createSession(sessionTitle.value || undefined);
    sessionTitle.value = '';
  });
}

function openSessionRename(session: { id: string; title: string }) {
  sessionRenameTargetId.value = session.id;
  sessionRenameTargetName.value = session.title;
  sessionRenameTitle.value = session.title;
  sessionRenameModal.value = true;
}

function closeSessionRename() {
  sessionRenameModal.value = false;
  sessionRenameTargetId.value = '';
  sessionRenameTargetName.value = '';
  sessionRenameTitle.value = '';
}

async function submitSessionRename() {
  if (!sessionRenameTargetId.value || !canSubmitSessionRename.value) return;
  const title = normalizedSessionRenameTitle.value;
  await runTask(async () => {
    await workspace.updateSessionTitle(sessionRenameTargetId.value, title);
    closeSessionRename();
  });
}

async function deleteSession(sessionId: string) {
  await runTask(() => workspace.deleteSession(sessionId));
}

async function switchModel(modelConfigId: string | null) {
  if (!modelConfigId) return;
  await runTask(() => workspace.switchSessionModel(modelConfigId));
}

async function submitComposer() {
  const value = composer.value.trim();
  if (!value) return;
  const connectCommandQuery = parseConnectCommand(value);
  if (connectCommandQuery !== null) {
    await openConnect(connectCommandQuery);
    return;
  }
  composer.value = '';
  shouldFollowChat.value = true;
  scheduleChatScrollToBottom();
  await runTask(() =>
    composerMode.value === 'plan' ? workspace.createPlan(value) : workspace.submitText(value),
  );
}

async function handleComposerKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing) return;

  if (event.ctrlKey && !event.altKey && !event.metaKey) {
    event.preventDefault();
    const target = event.target instanceof HTMLTextAreaElement ? event.target : null;
    if (!target) {
      composer.value += '\n';
      return;
    }
    const start = target.selectionStart;
    const end = target.selectionEnd;
    composer.value = `${composer.value.slice(0, start)}\n${composer.value.slice(end)}`;
    await nextTick();
    target.setSelectionRange(start + 1, start + 1);
    return;
  }

  if (event.shiftKey || event.altKey || event.metaKey) return;

  event.preventDefault();
  if (canSubmitComposer.value) {
    await submitComposer();
  }
}

async function approveActivePlan() {
  await runTask(() => workspace.approvePlan());
}

async function executeActivePlan() {
  const bundle = workspace.activePlan;
  if (!bundle || bundle.plan.status !== 'approved') return;
  const steps = bundle.steps.map((step) => `${step.order}. ${step.title}${step.detail ? ` - ${step.detail}` : ''}`);
  const request = [
    'Execute the approved plan for this session.',
    '',
    `Plan summary: ${bundle.plan.summary}`,
    '',
    'Steps:',
    ...steps,
  ].join('\n');
  await runTask(() => workspace.submitText(request, { approvedPlanId: bundle.plan.id }));
}

async function submitManualCommand() {
  const command = manualCommand.value.trim();
  if (!command || !canSubmitManualCommand.value) return;
  await runTask(async () => {
    const result = await workspace.requestCommand({
      command,
      ...(manualCommandCwd.value.trim() ? { cwd: manualCommandCwd.value.trim() } : {}),
    });
    manualCommand.value = '';
    await approvals.loadPending();
    activeWorkbenchTab.value = isPlanPendingApproval(result?.status) ? 'review' : 'runs';
  });
}

async function revokeCommandAuthorization() {
  await runTask(async () => {
    await workspace.revokeCommandAuthorization();
    await workspace.refreshReviewData();
  });
}

function openSettings(key: string) {
  if (key === 'logout') {
    auth.logout();
    return;
  }
  const routes: Record<string, string> = {
    models: '/settings/models',
    commands: '/settings/commands',
    audit: '/settings/audit',
  };
  const path = routes[key];
  if (path) {
    void router.push(path);
  }
}

async function revertPatch(patchId: string) {
  await runTask(() => workspace.revertPatch(patchId));
}

async function refreshReviewPanel() {
  await Promise.all([approvals.loadPending(), workspace.refreshReviewData()]);
}

async function refreshRunsPanel() {
  await Promise.all([workspace.loadCommandRuns(), workspace.loadAllowedCommands()]);
}

async function openConnect(initialQuery = '') {
  connectModal.value = true;
  connectQuery.value = initialQuery;
  connectSelected.value = null;
  connectFields.value = [];
  clearConnectForm();
  await searchProviders();
}

async function searchProviders() {
  const result = await workspace.searchConnectProviders(connectQuery.value);
  if (result?.type === 'connect.providers') {
    connectProviders.value = result.providers;
  }
}

async function chooseProvider(provider: ConnectProvider) {
  connectSelected.value = provider;
  clearConnectForm();
  const result = await workspace.connectProvider({ providerId: provider.id });
  if (result?.type === 'connect.form') {
    connectFields.value = result.fields;
    result.fields.forEach((field) => {
      connectForm[field.name] = '';
    });
  }
}

async function submitConnect() {
  if (!connectSelected.value) return;
  await runTask(async () => {
    await workspace.connectProvider({
      providerId: connectSelected.value?.id ?? '',
      apiKey: connectForm.apiKey,
      modelName: connectForm.modelName || undefined,
      displayName: connectForm.displayName || undefined,
      baseUrl: connectForm.baseUrl || undefined,
    });
    connectModal.value = false;
    if (parseConnectCommand(composer.value) !== null) {
      composer.value = '';
    }
    clearConnectForm();
  });
}

function clearConnectForm() {
  Object.keys(connectForm).forEach((key) => {
    delete connectForm[key];
  });
}

function parseConnectCommand(value: string): string | null {
  const match = value.trim().match(/^\/connect(?:\s+(.*))?$/);
  return match ? (match[1]?.trim() ?? '') : null;
}

function connectFieldLabel(field: ConnectField): string {
  if (field.name === 'apiKey') return locale.t('apiKey');
  if (field.name === 'modelName') return locale.t('modelName');
  if (field.name === 'displayName') return locale.t('displayName');
  if (field.name === 'baseUrl') return locale.t('baseUrl');
  return field.label;
}

function connectFieldPlaceholder(field: ConnectField): string {
  if (field.name === 'apiKey') return locale.t('apiKeyPlaceholder');
  if (field.name === 'modelName') return locale.t('modelNamePlaceholder');
  if (field.name === 'displayName') return locale.t('displayNamePlaceholder');
  if (field.name === 'baseUrl') return locale.t('baseUrlPlaceholder');
  return '';
}

function connectInputProps(field: ConnectField) {
  const providerId = connectSelected.value?.id ?? 'provider';
  return {
    id: `mebius-connect-${providerId}-${field.name}`,
    name: `mebius-connect-${providerId}-${field.name}`,
    autocomplete: field.name === 'apiKey' ? 'new-password' : 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
  };
}

function providerDescription(provider: ConnectProvider): string {
  if (provider.id === 'openai') return locale.t('providerOpenaiDescription');
  if (provider.id === 'openrouter') return locale.t('providerOpenrouterDescription');
  if (provider.id === 'deepseek') return locale.t('providerDeepseekDescription');
  if (provider.id === 'moonshot') return locale.t('providerMoonshotDescription');
  if (provider.id === 'dashscope') return locale.t('providerDashscopeDescription');
  if (provider.id === 'siliconflow') return locale.t('providerSiliconflowDescription');
  if (provider.id === 'custom') return locale.t('providerCustomDescription');
  return provider.description;
}

async function refreshFileTree() {
  fileTreeRefreshing.value = true;
  filePreviewError.value = '';
  try {
    await workspace.loadTree();
  } catch (err) {
    filePreviewError.value = err instanceof Error ? err.message : locale.t('operationFailed');
  } finally {
    fileTreeRefreshing.value = false;
  }
}

function openNewFileModal() {
  if (!workspace.currentProject) return;
  if (!confirmDiscardUnsavedChanges()) return;
  newFilePath.value = '';
  newFileError.value = '';
  newFileModal.value = true;
}

async function submitNewFile() {
  const path = newFilePath.value.trim();
  if (!path) return;
  newFileLoading.value = true;
  newFileError.value = '';
  try {
    const file = await workspace.createFile(path, '');
    if (!file) return;
    selectedFilePath.value = file.path;
    editorContent.value = file.content;
    filePaneMode.value = 'editor';
    expandParentDirectories(file.path);
    newFileModal.value = false;
  } catch (err) {
    newFileError.value = err instanceof Error ? err.message : locale.t('fileCreateFailed');
  } finally {
    newFileLoading.value = false;
  }
}

function openRenameFileModal(node: TreeNode) {
  if (node.type !== 'file') return;
  if (!confirmDiscardUnsavedChanges()) return;
  renameFileSourcePath.value = node.path;
  renameFilePath.value = node.path;
  renameFileError.value = '';
  renameFileModal.value = true;
}

async function submitRenameFile() {
  const sourcePath = renameFileSourcePath.value;
  const nextPath = renameFilePath.value.trim();
  if (!sourcePath || !nextPath || sourcePath === nextPath) return;
  renameFileLoading.value = true;
  renameFileError.value = '';
  try {
    const file = await workspace.renameFile(sourcePath, nextPath);
    if (!file) return;
    if (selectedFilePath.value === sourcePath) {
      selectedFilePath.value = file.path;
      editorContent.value = file.content;
    }
    expandParentDirectories(file.path);
    renameFileModal.value = false;
  } catch (err) {
    renameFileError.value = err instanceof Error ? err.message : locale.t('fileRenameFailed');
  } finally {
    renameFileLoading.value = false;
  }
}

function expandParentDirectories(path: string) {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 1) return;
  const expanded = new Set(expandedFilePaths.value);
  for (let index = 1; index < parts.length; index += 1) {
    expanded.add(parts.slice(0, index).join('/'));
  }
  expandedFilePaths.value = Array.from(expanded);
}

function toggleFileDirectory(path: string) {
  const expanded = new Set(expandedFilePaths.value);
  if (expanded.has(path)) {
    expanded.delete(path);
  } else {
    expanded.add(path);
  }
  expandedFilePaths.value = Array.from(expanded);
}

async function onFileSelect(node: TreeNode) {
  if (node.type !== 'file') return;
  if (!confirmDiscardUnsavedChanges()) return;
  selectedFilePath.value = node.path;
  filePreviewError.value = '';
  fileSaveError.value = '';
  filePreviewLoading.value = true;
  const requestId = ++filePreviewRequest;

  try {
    await workspace.loadFile(node.path);
  } catch (err) {
    if (requestId === filePreviewRequest) {
      filePreviewError.value = err instanceof Error ? err.message : locale.t('operationFailed');
    }
  } finally {
    if (requestId === filePreviewRequest) {
      filePreviewLoading.value = false;
    }
  }
}

async function onFileRename(node: TreeNode) {
  openRenameFileModal(node);
}

async function onFileDelete(node: TreeNode) {
  if (node.type !== 'file') return;
  if (!confirmDiscardUnsavedChanges()) return;
  if (!window.confirm(locale.t('confirmDeleteFile', { path: node.path }))) return;
  await runTask(async () => {
    await workspace.deleteFile(node.path);
    if (selectedFilePath.value === node.path) {
      selectedFilePath.value = '';
      editorContent.value = '';
      fileSaveError.value = '';
      filePreviewError.value = '';
      filePreviewLoading.value = false;
    }
  });
}

function confirmDiscardUnsavedChanges() {
  if (!isCurrentFileDirty.value) return true;
  return window.confirm(
    locale.t('discardUnsavedChanges', { path: workspace.currentFile?.path ?? selectedFilePath.value }),
  );
}

async function saveCurrentFile() {
  if (!workspace.currentFile || !isCurrentFileDirty.value) return;
  fileSaveLoading.value = true;
  fileSaveError.value = '';
  try {
    await workspace.saveFile(workspace.currentFile.path, editorContent.value);
  } catch (err) {
    fileSaveError.value = err instanceof Error ? err.message : locale.t('fileSaveFailed');
  } finally {
    fileSaveLoading.value = false;
  }
}

function revertCurrentFile() {
  editorContent.value = workspace.currentFile?.content ?? '';
  fileSaveError.value = '';
}

function countTree(nodes: TreeNode[]) {
  return nodes.reduce(
    (stats, node) => {
      if (node.type === 'directory') {
        stats.directories += 1;
        const childStats = countTree(node.children ?? []);
        stats.files += childStats.files;
        stats.directories += childStats.directories;
      } else {
        stats.files += 1;
      }
      return stats;
    },
    { files: 0, directories: 0 },
  );
}

function collectDirectoryOptions(nodes: TreeNode[]): Array<{ label: string; value: string }> {
  return nodes.flatMap((node) => {
    if (node.type !== 'directory') return [];
    return [
      { label: node.path, value: node.path },
      ...collectDirectoryOptions(node.children ?? []),
    ];
  });
}

function collectInitialDirectoryPaths(nodes: TreeNode[], depth = 0): string[] {
  return nodes.flatMap((node) => {
    if (node.type !== 'directory') return [];
    const children = depth < 1 ? collectInitialDirectoryPaths(node.children ?? [], depth + 1) : [];
    return [node.path, ...children];
  });
}

function findTreeNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    const found = node.children ? findTreeNode(node.children, path) : null;
    if (found) return found;
  }
  return null;
}

function approvalArguments(approval: Approval) {
  return JSON.stringify(approval.toolCall.arguments, null, 2);
}

function approvalPreviewTitle(approval: Approval) {
  if (approval.preview?.kind === 'patch') return approval.preview.path;
  if (approval.preview?.kind === 'patch_set') {
    return locale.t('multiFilePatch', { count: approval.preview.files.length });
  }
  if (approval.preview?.kind === 'command') return approval.preview.command;
  return approval.toolCall.name;
}

function isCommandRunExpanded(id: string) {
  return expandedCommandRunIds.value.includes(id);
}

function toggleCommandRun(id: string) {
  if (isCommandRunExpanded(id)) {
    expandedCommandRunIds.value = expandedCommandRunIds.value.filter((item) => item !== id);
    return;
  }
  expandedCommandRunIds.value = [id, ...expandedCommandRunIds.value];
}

async function copyCommandRunOutput(runId: string, stdout: string, stderr: string) {
  await navigator.clipboard.writeText([stdout, stderr].filter(Boolean).join('\n'));
  copiedCommandRunId.value = runId;
  window.setTimeout(() => {
    if (copiedCommandRunId.value === runId) {
      copiedCommandRunId.value = '';
    }
  }, 1400);
}

function commandRunToneClass(status: string) {
  if (status === 'succeeded') return 'is-success';
  if (status === 'failed') return 'is-danger';
  if (status === 'running' || status === 'pending') return 'is-warning';
  return '';
}

function commandRunExitLabel(exitCode?: number) {
  return typeof exitCode === 'number' ? `exit ${exitCode}` : 'running';
}

function approvalContext(approval: Approval) {
  return approval.toolCall.session?.project?.name ?? locale.t('workspace');
}

function isPatchApproval(approval: Approval) {
  return approval.toolCall.name === 'create_patch';
}

function approvalApproveLabel(approval: Approval) {
  return isPatchApproval(approval) ? locale.t('applyPatchApproval') : locale.t('approve');
}

function canEnableProjectCommand(approval: Approval) {
  return (
    approval.toolCall.name === 'run_command' &&
    approval.preview?.kind === 'command' &&
    approval.preview.executionMode !== 'shell' &&
    !approval.preview.policyAllowed
  );
}

function canGrantSessionCommandAutoRun(approval: Approval) {
  return (
    approval.toolCall.name === 'run_command' &&
    approval.preview?.kind === 'command' &&
    approval.preview.canGrantSessionAutoRun &&
    !approval.preview.sessionAutoRunActive
  );
}

function isPlanPendingApproval(status: string | undefined) {
  return status === 'pending_approval' || status === 'plan_ready_pending_approval' || status === 'plan_review';
}

function commandPolicyText(approval: Approval) {
  const preview = approval.preview;
  if (preview?.kind !== 'command') return '';
  if (preview.sessionAutoRunActive) return locale.t('commandSessionAutoRunActive');
  if (preview.executionMode === 'shell') {
    return locale.t('commandShellAuthorizationRequired', {
      tokens: preview.shellTokens.join(' '),
    });
  }
  return preview.policyAllowed ? locale.t('commandPolicyAllowed') : locale.t('commandPolicyNeedsAuthorization');
}

function commandExecutionModeLabel(approval: Approval) {
  const preview = approval.preview;
  if (preview?.kind !== 'command') return '';
  return preview.executionMode === 'shell' ? locale.t('commandExecutionShell') : locale.t('commandExecutionArgv');
}

function eventToneClass(type: string) {
  const normalized = type.toLowerCase();
  if (normalized.includes('model_call_completed')) return 'is-success';
  if (normalized.includes('model_call_failed')) return 'is-danger';
  if (normalized.includes('model_call')) return 'is-warning';
  if (normalized.includes('error') || normalized.includes('failed')) return 'is-danger';
  if (normalized.includes('approval') || normalized.includes('requested')) return 'is-warning';
  if (normalized.includes('done') || normalized.includes('created') || normalized.includes('result')) {
    return 'is-success';
  }
  return 'is-info';
}

function eventToneIcon(type: string) {
  const normalized = type.toLowerCase();
  if (normalized.includes('model_call')) return Cable;
  if (normalized.includes('error') || normalized.includes('failed')) return AlertCircle;
  if (normalized.includes('done') || normalized.includes('created') || normalized.includes('result')) {
    return CheckCircle2;
  }
  if (normalized.includes('approval') || normalized.includes('requested')) return Clock3;
  return Info;
}

function eventTitle(type: string, data: SsePayload) {
  const toolName = eventToolName(data);
  if (type === 'agent_status') return locale.t('eventTitleAgentStatus');
  if (type === 'tool_call_requested' && toolName === 'create_patch') {
    return locale.t('eventTitlePatchApproval');
  }
  if (type === 'patch_created') return locale.t('eventTitlePatchWritten');
  if (type === 'tool_call_result') return locale.t('eventTitleToolResult');
  if (type === 'command_started') return locale.t('eventTitleCommandStarted');
  if (type === 'command_output') return locale.t('eventTitleCommandOutput');
  return type
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function eventSummary(type: string, data: SsePayload) {
  const toolName = eventToolName(data);
  const targetPaths = extractEventTargetPaths(data);
  if (toolName === 'create_patch' || type === 'patch_created') {
    const target = formatActivityTarget(targetPaths);
    const activity = typeof data.activity === 'string' ? data.activity : '';
    if (type === 'tool_call_requested' || data.status === 'waiting_for_approval') {
      return locale.t('agentWaitingPatchApproval', { target });
    }
    if (type === 'patch_created' || activity === 'patch_applied') {
      return locale.t('eventPatchCreatedSummary', { target });
    }
    if (activity === 'preparing_patch') {
      return locale.t('agentPreparingPatch', { target });
    }
    if (activity === 'applying_patch') {
      return locale.t('agentApplyingPatch', { target });
    }
  }
  if ((type === 'command_started' || type === 'command_output') && typeof data.command === 'string') {
    return locale.t('agentRunningCommand', { command: truncate(data.command, 64) });
  }
  if (typeof data.modelName === 'string') {
    const duration = typeof data.durationMs === 'number' ? ` · ${data.durationMs} ms` : '';
    return `${data.modelName}${duration}`;
  }
  const keys = ['message', 'summary', 'name', 'toolName', 'status', 'command', 'path', 'content'];
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) {
      return truncate(value.trim(), 92);
    }
  }
  return locale.t('eventPayload');
}

function eventToolName(data: SsePayload) {
  if (typeof data.toolName === 'string') return data.toolName;
  if (typeof data.name === 'string') return data.name;
  return undefined;
}

function extractEventTargetPaths(data: SsePayload): string[] {
  if (Array.isArray(data.targetPaths)) {
    return data.targetPaths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  if (typeof data.path === 'string' && data.path.trim()) {
    return [data.path.trim()];
  }
  return extractPatchTargetPaths(data.arguments);
}

function extractPatchTargetPaths(args: unknown): string[] {
  if (!args || typeof args !== 'object') return [];
  const record = args as Record<string, unknown>;
  const rawPaths = Array.isArray(record.files)
    ? record.files.map((item) =>
        item && typeof item === 'object' ? (item as Record<string, unknown>).path : undefined,
      )
    : [record.path];
  return rawPaths
    .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
    .map((path) => path.trim().replaceAll('\\', '/'));
}

function formatActivityTarget(paths: string[] | undefined) {
  if (!paths || paths.length === 0) return locale.t('agentPatchTargetFallback');
  if (paths.length === 1) return paths[0];
  if (paths.length === 2) return paths.join(', ');
  return locale.t('agentPatchTargetCount', { count: paths.length });
}

function eventMatchesFilter(type: string, filter: EventFilter) {
  if (filter === 'all') return true;
  if (filter === 'model') return type.startsWith('model_call');
  if (filter === 'commands') return type.startsWith('command_');
  if (filter === 'messages') return type === 'message_created' || type === 'token' || type === 'done';
  return [
    'tool_call_requested',
    'tool_call_result',
    'patch_created',
    'patch_reverted',
    'plan_updated',
    'agent_status',
  ].includes(type);
}

function eventFilterIcon(filter: EventFilter) {
  if (filter === 'model') return Cable;
  if (filter === 'tools') return Wrench;
  if (filter === 'commands') return Terminal;
  if (filter === 'messages') return MessageSquare;
  return ListFilter;
}

function formatEventTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString(locale.current, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function stringifyPayload(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}...`;
}

function projectDescription(project: { description?: string; sourceType: string; workspaceMode?: string }) {
  const mode = project.sourceType === 'local' || project.workspaceMode === 'attached'
    ? 'server local workspace'
    : project.sourceType;
  return [project.description, mode].filter(Boolean).join(' · ');
}
</script>

<template>
  <main class="workspace-root mebius-app-bg h-screen overflow-hidden text-mebius-ink">
    <div
      class="workspace-shell"
      :class="{
        'is-resizing-sidebar': activeResizeSide,
        'is-resizing-session-pane': activeWorkspaceResizeTarget === 'sessions',
        'is-resizing-file-pane': activeWorkspaceResizeTarget === 'file-tree',
      }"
      :style="workspaceGridStyle"
    >
      <button
        v-if="isCompactViewport && hasOverlayOpen"
        class="fixed inset-0 z-20 bg-slate-950/20 lg:hidden"
        type="button"
        :title="locale.t('closeSidebar')"
        :aria-label="locale.t('closeSidebar')"
        @click="closeSidebars"
      />

      <aside
        class="workspace-side-panel workspace-side-panel--left flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-mebius-border bg-white"
        :class="{ 'is-collapsed': leftSidebarCollapsed, 'is-overlay-open': leftOverlayOpen }"
        :inert="leftSidebarInert"
        :aria-hidden="leftSidebarInert"
      >
        <header class="workspace-panel-header border-b border-mebius-border p-4">
          <div class="mb-3 flex items-center justify-between">
            <MebiusBrand class="min-w-0" :subtitle="auth.user?.email ?? locale.t('workspace')" />
            <div class="flex items-center gap-1">
              <n-dropdown
                trigger="click"
                :options="settingsOptions"
                @select="openSettings"
              >
                <n-button circle quaternary :title="locale.t('settings')">
                  <template #icon><n-icon><Settings /></n-icon></template>
                </n-button>
              </n-dropdown>
              <n-button
                v-if="isCompactViewport"
                circle
                quaternary
                :title="locale.t('closeSidebar')"
                :aria-label="locale.t('closeSidebar')"
                @click="closeSidebars"
              >
                <template #icon><n-icon><X /></n-icon></template>
              </n-button>
            </div>
          </div>
          <n-alert v-if="error" type="error" :show-icon="false" closable @close="error = ''">
            {{ error }}
          </n-alert>
        </header>

        <div ref="leftSidebarBody" class="left-sidebar-body scrollbar-thin">
        <section class="left-sidebar-card left-sidebar-card--fixed border-b border-mebius-border p-3">
          <div class="mb-2 flex items-center gap-2 text-sm font-medium">
            <n-icon><Folder /></n-icon>
            {{ locale.t('projects') }}
          </div>
          <div class="space-y-2">
            <n-input v-model:value="projectForm.name" size="small" :placeholder="locale.t('projectName')" />
            <n-input
              v-model:value="projectForm.description"
              size="small"
              :placeholder="locale.t('description')"
            />
            <n-button size="small" block type="primary" :disabled="!projectForm.name" @click="createProject">
              <template #icon><n-icon><Plus /></n-icon></template>
              {{ locale.t('createProject') }}
            </n-button>
          </div>
        </section>

        <section class="left-sidebar-card left-sidebar-card--projects p-3">
          <n-list hoverable clickable>
            <n-list-item
              v-for="project in workspace.projects"
              :key="project.id"
              :class="project.id === workspace.currentProject?.id ? 'bg-slate-100' : ''"
              @click="workspace.selectProject(project)"
            >
              <div class="flex items-center justify-between gap-2">
                <n-thing class="min-w-0" :title="project.name" :description="projectDescription(project)" />
                <n-popconfirm @positive-click="deleteProject(project.id)">
                  <template #trigger>
                    <n-button
                      circle
                      quaternary
                      size="small"
                      :disabled="busy"
                      :title="locale.t('deleteProject')"
                      @click.stop
                    >
                      <template #icon><n-icon><Trash2 /></n-icon></template>
                    </n-button>
                  </template>
                  {{ locale.t('confirmDeleteProject', { name: project.name }) }}
                </n-popconfirm>
              </div>
            </n-list-item>
          </n-list>
        </section>

        <section class="left-sidebar-card border-t border-mebius-border">
          <button
            type="button"
            class="left-sidebar-disclosure"
            :aria-expanded="projectImportOpen"
            @click="projectImportOpen = !projectImportOpen"
          >
            <span class="left-sidebar-disclosure__title">
              <n-icon><FolderTree /></n-icon>
              {{ locale.t('projectImport') }}
            </span>
            <n-icon class="left-sidebar-disclosure__chevron">
              <ChevronDown v-if="projectImportOpen" />
              <ChevronRight v-else />
            </n-icon>
          </button>
          <div v-if="projectImportOpen" class="p-3 pt-0">
            <n-radio-group v-model:value="importMode" class="mb-2 w-full" size="small" :disabled="isImportingProject">
              <n-radio-button value="git">{{ locale.t('gitRepository') }}</n-radio-button>
              <n-radio-button value="archive">{{ locale.t('localArchive') }}</n-radio-button>
            </n-radio-group>
            <p class="m-0 mb-2 text-xs leading-5 text-mebius-muted">{{ locale.t('projectImportScopeHint') }}</p>
            <p
              v-if="projectWorkspaceHasContent"
              class="m-0 mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs leading-5 text-amber-700"
            >
              {{ locale.t('projectImportRequiresEmptyWorkspace') }}
            </p>

            <template v-if="importMode === 'git'">
              <n-input
                v-model:value="importForm.gitUrl"
                class="mb-2"
                size="small"
                :disabled="isImportingProject"
                :placeholder="locale.t('repositoryUrl')"
              />
              <n-input
                v-model:value="importForm.branch"
                class="mb-2"
                size="small"
                :disabled="isImportingProject"
                :placeholder="locale.t('branch')"
              />
              <n-button
                size="small"
                block
                :loading="isImportingProject"
                :disabled="
                  !workspace.currentProject ||
                  !importForm.gitUrl ||
                  isImportingProject ||
                  projectWorkspaceHasContent
                "
                @click="importGit"
              >
                {{ locale.t('importIntoCurrentProject') }}
              </n-button>
            </template>

            <template v-else>
              <label
                class="mb-2 block cursor-pointer rounded-lg border border-dashed border-mebius-border bg-white/70 px-3 py-2 text-xs leading-5 transition hover:border-mebius-accent"
                :class="{ 'cursor-not-allowed opacity-70': isImportingProject }"
              >
                <input
                  ref="archiveFileInput"
                  class="hidden"
                  type="file"
                  accept=".zip,application/zip,application/x-zip-compressed"
                  :disabled="isImportingProject"
                  @change="selectArchiveFile"
                />
                <span class="block text-mebius-muted">{{ locale.t('archiveFile') }}</span>
                <span class="block truncate text-slate-800">{{ archiveFileName }}</span>
              </label>
              <p class="m-0 mb-2 text-xs leading-5 text-mebius-muted">{{ locale.t('archiveImportHint') }}</p>
              <n-button
                size="small"
                block
                :loading="isImportingProject"
                :disabled="
                  !workspace.currentProject || !archiveFile || isImportingProject || projectWorkspaceHasContent
                "
                @click="importArchive"
              >
                {{ locale.t('importArchiveIntoCurrentProject') }}
              </n-button>
            </template>

            <p v-if="projectImportFeedback" class="m-0 mt-2 text-xs leading-5" :class="projectImportFeedbackClass">
              {{ projectImportFeedback }}
            </p>
          </div>
        </section>

        <section class="left-sidebar-card border-t border-mebius-border">
          <button
            type="button"
            class="left-sidebar-disclosure"
            :aria-expanded="gitPublishOpen"
            @click="gitPublishOpen = !gitPublishOpen"
          >
            <span class="left-sidebar-disclosure__title">
              <n-icon><GitBranch /></n-icon>
              {{ locale.t('gitPublish') }}
            </span>
            <n-icon class="left-sidebar-disclosure__chevron">
              <ChevronDown v-if="gitPublishOpen" />
              <ChevronRight v-else />
            </n-icon>
          </button>
          <div v-if="gitPublishOpen" class="p-3 pt-0">
            <div class="mb-2 flex items-center justify-end gap-2">
              <n-button
                quaternary
                size="small"
                :loading="isLoadingGitStatus"
                :disabled="!workspace.currentProject || isLoadingGitStatus || busy"
                @click="refreshGitStatus"
              >
                <template #icon><n-icon><RefreshCw /></n-icon></template>
                {{ locale.t('gitRefreshStatus') }}
              </n-button>
            </div>

            <p v-if="workspace.gitStatusError" class="m-0 mb-2 text-xs leading-5 text-red-600">
              {{ workspace.gitStatusError || locale.t('gitStatusFailed') }}
            </p>
            <p v-else-if="isLoadingGitStatus" class="m-0 mb-2 text-xs leading-5 text-mebius-muted">
              {{ locale.t('gitStatusLoading') }}
            </p>
            <template v-else-if="gitStatus">
              <p v-if="!gitStatus.isGitRepo" class="m-0 mb-2 text-xs leading-5 text-mebius-muted">
                {{ locale.t('gitStatusUnavailable') }}
              </p>
              <template v-else>
                <div class="mb-2 rounded-xl border border-mebius-border/80 bg-slate-50 p-2 text-xs text-mebius-muted">
                  <p class="m-0">{{ locale.t('gitCurrentBranch', { branch: gitStatus.branch ?? 'HEAD' }) }}</p>
                  <p v-if="gitStatus.tracking" class="m-0 mt-1">
                    {{ locale.t('gitTrackingBranch', { tracking: gitStatus.tracking }) }}
                  </p>
                  <p class="m-0 mt-1">{{ locale.t('gitRemoteCount', { count: gitStatus.remotes.length }) }}</p>
                  <p class="m-0 mt-1">{{ locale.t('gitAheadCount', { count: String(gitStatus.ahead) }) }}</p>
                  <p class="m-0 mt-1">{{ locale.t('gitBehindCount', { count: String(gitStatus.behind) }) }}</p>
                  <p class="m-0 mt-1">
                    staged {{ gitStatus.counts.staged }} · unstaged {{ gitStatus.counts.unstaged }} · untracked
                    {{ gitStatus.counts.untracked }}
                  </p>
                </div>

                <n-input
                  v-model:value="gitCommitMessage"
                  class="mb-2"
                  size="small"
                  :disabled="isPublishingGit || busy"
                  :placeholder="locale.t('gitCommitPlaceholder')"
                />
                <div class="grid grid-cols-2 gap-2">
                  <n-button size="small" :disabled="!canCommitGit" :loading="isPublishingGit && busy" @click="commitGit">
                    {{ locale.t('gitCommit') }}
                  </n-button>
                  <n-button size="small" secondary :disabled="!canPushGit" :loading="isPublishingGit && busy" @click="pushGit">
                    {{ locale.t('gitPush') }}
                  </n-button>
                </div>

                <p class="m-0 mt-2 text-xs leading-5 text-mebius-muted">
                  {{ pushStatusHint }}
                </p>
                <p v-if="gitStatus.hasRemote" class="m-0 mt-1 text-xs leading-5 text-mebius-muted">
                  {{ locale.t('gitRequiresRemote') }}
                </p>

                <div class="mt-3">
                  <div class="mb-1 flex items-center justify-between gap-2">
                    <div class="text-xs font-medium text-mebius-muted">{{ locale.t('gitChangedFiles') }}</div>
                    <div class="flex items-center gap-2">
                      <n-button
                        size="tiny"
                        quaternary
                        :disabled="!canStageAllGit"
                        @click="stageAllGit"
                      >
                        {{ locale.t('gitStageAll') }}
                      </n-button>
                      <n-button
                        size="tiny"
                        quaternary
                        :disabled="!canUnstageAllGit"
                        @click="unstageAllGit"
                      >
                        {{ locale.t('gitUnstageAll') }}
                      </n-button>
                    </div>
                  </div>
                  <div
                    v-if="gitStatus.files.length"
                    class="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-mebius-border/80 bg-slate-50 p-2"
                  >
                    <div
                      v-for="file in gitStatus.files"
                      :key="file.path"
                      class="flex items-center justify-between gap-2 text-xs"
                    >
                      <div class="min-w-0 flex-1">
                        <div class="truncate">{{ file.path }}</div>
                        <div class="text-[11px] text-mebius-muted">{{ gitStateLabel(file.state) }}</div>
                      </div>
                      <div class="flex shrink-0 items-center gap-2">
                        <n-button
                          v-if="canStageFile(file)"
                          size="tiny"
                          quaternary
                          :disabled="busy || isPublishingGit"
                          @click="stageGitFile(file.path)"
                        >
                          {{ locale.t('gitStage') }}
                        </n-button>
                        <n-button
                          v-if="canUnstageFile(file)"
                          size="tiny"
                          quaternary
                          :disabled="busy || isPublishingGit"
                          @click="unstageGitFile(file.path)"
                        >
                          {{ locale.t('gitUnstage') }}
                        </n-button>
                      </div>
                    </div>
                  </div>
                  <p v-else class="m-0 text-xs leading-5 text-mebius-muted">
                    {{ locale.t('gitNoChanges') }}
                  </p>
                </div>
              </template>
            </template>

            <p v-if="gitPublishFeedback" class="m-0 mt-2 text-xs leading-5" :class="gitPublishFeedbackClass">
              {{ gitPublishFeedback }}
            </p>
          </div>
        </section>
        </div>

        <div
          v-if="!isCompactViewport && !leftSidebarCollapsed"
          class="sidebar-resize-handle sidebar-resize-handle--left"
          :class="{ 'is-active': activeResizeSide === 'left' }"
          role="separator"
          aria-orientation="vertical"
          :aria-label="locale.t('resizeLeftSidebar')"
          :aria-valuemin="sidebarWidthLimits.left.min"
          :aria-valuemax="sidebarWidthLimits.left.max"
          :aria-valuenow="effectiveLeftSidebarWidth"
          tabindex="0"
          @pointerdown="startSidebarResize('left', $event)"
          @wheel="handleLeftSidebarResizeWheel"
          @keydown="handleSidebarResizeKeydown('left', $event)"
        />
      </aside>

      <section class="workspace-main flex min-h-0 min-w-0 flex-col">
        <header class="workspace-topbar flex items-center justify-between border-b border-mebius-border bg-white px-4 py-3">
          <div class="flex min-w-0 items-center gap-2">
            <n-button
              circle
              quaternary
              size="small"
              :title="leftSidebarToggleLabel"
              :aria-label="leftSidebarToggleLabel"
              @click="toggleLeftSidebar"
            >
              <template #icon><n-icon><component :is="leftSidebarToggleIcon" /></n-icon></template>
            </n-button>
            <n-button
              v-if="!isCompactViewport"
              circle
              quaternary
              size="small"
              :title="sessionPaneToggleLabel"
              :aria-label="sessionPaneToggleLabel"
              @click="toggleSessionPane"
            >
              <template #icon><n-icon><component :is="sessionPaneToggleIcon" /></n-icon></template>
            </n-button>
            <div class="min-w-0">
              <button
                class="session-title-button"
                type="button"
                :disabled="!workspace.currentSession"
                :title="workspace.currentSession ? locale.t('renameSession') : undefined"
                @click="workspace.currentSession && openSessionRename(workspace.currentSession)"
              >
                {{ workspace.currentSession?.title ?? locale.t('noSessionSelected') }}
              </button>
              <p class="m-0 truncate text-xs text-mebius-muted">
                {{ workspace.currentProject?.name ?? locale.t('createOrSelectProject') }}
                · SSE {{ workspace.eventStatus }}
              </p>
            </div>
          </div>
          <n-space>
            <n-button size="small" @click="openConnect('')" :disabled="!workspace.currentSession">
              <template #icon><n-icon><Cable /></n-icon></template>
              {{ locale.t('connect') }}
            </n-button>
            <ThemeToggle />
            <n-button size="small" quaternary @click="locale.toggleLocale">
              {{ locale.t('languageSwitch') }}
            </n-button>
            <n-button size="small" @click="approvals.loadPending">
              <template #icon><n-icon><RefreshCw /></n-icon></template>
              {{ locale.t('sync') }}
            </n-button>
            <n-button
              circle
              quaternary
              size="small"
              :title="rightSidebarToggleLabel"
              :aria-label="rightSidebarToggleLabel"
              @click="toggleRightSidebar"
            >
              <template #icon><n-icon><component :is="rightSidebarToggleIcon" /></n-icon></template>
            </n-button>
          </n-space>
        </header>

        <div
          class="workspace-content-grid"
          :class="{ 'is-session-pane-collapsed': sessionPaneCollapsed }"
          :style="workspaceContentStyle"
        >
          <aside v-if="!sessionPaneCollapsed" class="session-pane min-h-0 border-r border-mebius-border bg-white p-3">
            <div class="mb-3 flex items-center justify-between">
              <span class="text-sm font-medium">{{ locale.t('sessions') }}</span>
              <n-button circle quaternary size="small" :title="locale.t('newSession')" @click="createSession">
                <template #icon><n-icon><Plus /></n-icon></template>
              </n-button>
            </div>
            <n-input v-model:value="sessionTitle" class="mb-2" size="small" :placeholder="locale.t('sessionTitle')" />
            <div class="session-list scrollbar-thin">
              <n-list hoverable clickable>
                <n-list-item
                  v-for="session in workspace.sessions"
                  :key="session.id"
                  :class="session.id === workspace.currentSession?.id ? 'bg-slate-100' : ''"
                  @click="workspace.selectSession(session)"
                >
                  <div class="flex items-center justify-between gap-2">
                    <n-thing
                      class="min-w-0"
                      :title="session.title"
                      :description="session.activeModelConfig?.modelName || session.status"
                    />
                    <n-button
                      circle
                      quaternary
                      size="small"
                      :disabled="busy"
                      :title="locale.t('renameSession')"
                      @click.stop="openSessionRename(session)"
                    >
                      <template #icon><n-icon><Pencil /></n-icon></template>
                    </n-button>
                    <n-popconfirm @positive-click="deleteSession(session.id)">
                      <template #trigger>
                        <n-button
                          circle
                          quaternary
                          size="small"
                          :disabled="busy"
                          :title="locale.t('deleteSession')"
                          @click.stop
                        >
                          <template #icon><n-icon><Trash2 /></n-icon></template>
                        </n-button>
                      </template>
                      {{ locale.t('confirmDeleteSession', { name: session.title }) }}
                    </n-popconfirm>
                  </div>
                </n-list-item>
              </n-list>
            </div>
          </aside>
          <div
            v-if="!isCompactViewport && !sessionPaneCollapsed"
            class="workspace-content-resize-handle"
            :class="{ 'is-active': activeWorkspaceResizeTarget === 'sessions' }"
            role="separator"
            aria-orientation="vertical"
            :aria-label="locale.t('resizeSessionPane')"
            :aria-valuemin="sessionPaneWidthLimits.min"
            :aria-valuemax="sessionPaneWidthLimits.max"
            :aria-valuenow="liveSessionPaneWidth"
            tabindex="0"
            @pointerdown="startSessionResize"
            @keydown="handleSessionResizeKeydown"
          />

          <div class="flex min-h-0 flex-col">
            <div
              ref="chatScrollContainer"
              class="chat-scroll min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin"
              @scroll="handleChatScroll"
            >
              <div class="chat-thread">
                <div v-if="workspace.messages.length === 0" class="chat-empty-state">
                  <MebiusBrand class="chat-empty-state__brand" size="hero" :text="false" />
                  <p>{{ locale.t('createSessionHint') }}</p>
                </div>
                <div
                  v-for="message in workspace.messages"
                  :key="message.id"
                  class="chat-message rounded border border-mebius-border bg-white p-3"
                  :class="`chat-message--${message.role}`"
                >
                  <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-mebius-muted">
                    {{ message.role }}
                  </div>
                  <MessageContent :role="message.role" :content="message.content" :metadata="message.metadata" />
                </div>

                <div
                  v-if="agentActivityText"
                  class="chat-activity rounded border p-3"
                  :class="agentActivityToneClass"
                  role="status"
                  aria-live="polite"
                >
                  <div class="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                    <n-icon class="shrink-0" :class="{ 'animate-spin': agentActivitySpins }">
                      <component :is="agentActivityIcon" />
                    </n-icon>
                    <span>{{ locale.t('agentStatusLabel') }}</span>
                  </div>
                  <p class="m-0 text-sm leading-6">{{ agentActivityText }}</p>
                </div>
              </div>
            </div>

            <footer class="composer-footer border-t border-mebius-border bg-white p-3">
              <div class="composer-shell rounded-2xl border border-mebius-border bg-white shadow-sm">
                <n-input
                  v-model:value="composer"
                  type="textarea"
                  :bordered="false"
                  :autosize="{ minRows: 2, maxRows: 5 }"
                  :placeholder="locale.t('askPlaceholder')"
                  @keydown="handleComposerKeydown"
                />
                <div class="flex flex-wrap items-center justify-between gap-2 border-t border-mebius-border px-3 py-2">
                  <div class="flex min-w-0 flex-wrap items-center gap-2">
                    <n-segmented
                      v-model:value="composerMode"
                      size="small"
                      :options="composerModeOptions"
                    />
                    <n-select
                      size="small"
                      class="w-[260px] max-w-full"
                      :value="workspace.currentSession?.activeModelConfig?.id ?? null"
                      :options="modelOptions"
                      :placeholder="activeModelLabel"
                      :disabled="!workspace.currentSession || modelOptions.length === 0 || busy"
                      :consistent-menu-width="false"
                      @update:value="switchModel"
                    />
                  </div>
                  <n-button
                    circle
                    :disabled="!canSubmitComposer"
                    :loading="busy"
                    type="primary"
                    :title="locale.t('send')"
                    @click="submitComposer"
                  >
                    <template #icon><n-icon><Send /></n-icon></template>
                  </n-button>
                </div>
              </div>
            </footer>
          </div>
        </div>
      </section>

      <aside
        class="workspace-side-panel workspace-side-panel--right relative flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-mebius-border bg-white"
        :class="{ 'is-collapsed': rightSidebarCollapsed, 'is-overlay-open': rightOverlayOpen }"
        :inert="rightSidebarInert"
        :aria-hidden="rightSidebarInert"
      >
        <div
          v-if="!isCompactViewport && !rightSidebarCollapsed"
          class="sidebar-resize-handle sidebar-resize-handle--right"
          :class="{ 'is-active': activeResizeSide === 'right' }"
          role="separator"
          aria-orientation="vertical"
          :aria-label="locale.t('resizeRightSidebar')"
          :aria-valuemin="sidebarWidthLimits.right.min"
          :aria-valuemax="sidebarWidthLimits.right.max"
          :aria-valuenow="effectiveRightSidebarWidth"
          tabindex="0"
          @pointerdown="startSidebarResize('right', $event)"
          @keydown="handleSidebarResizeKeydown('right', $event)"
        />
        <n-button
          v-if="isCompactViewport"
          class="absolute right-2 top-2 z-10"
          circle
          quaternary
          :title="locale.t('closeSidebar')"
          :aria-label="locale.t('closeSidebar')"
          @click="closeSidebars"
        >
          <template #icon><n-icon><X /></n-icon></template>
        </n-button>
        <n-tabs
          v-model:value="activeWorkbenchTab"
          type="line"
          class="workbench-tabs min-h-0 flex-1"
          pane-class="workbench-tabs__pane"
        >
          <n-tab-pane name="files" :tab="locale.t('files')">
            <div class="workbench-pane workbench-pane--files" :style="fileWorkbenchStyle">
              <section class="workbench-section workbench-section--tree">
                <header class="workbench-section__header">
                  <div class="min-w-0">
                    <div class="workbench-section__title">
                      <n-icon><FolderTree /></n-icon>
                      <span>{{ locale.t('fileTree') }}</span>
                    </div>
                    <p class="workbench-section__subtitle">
                      {{ locale.t('fileTreeSummary', { files: fileTreeStats.files, directories: fileTreeStats.directories }) }}
                    </p>
                    <p class="workbench-section__subtitle">
                      {{
                        locale.t('fileTreeProjectScopeHint', {
                          project: workspace.currentProject?.name ?? locale.t('workspace'),
                        })
                      }}
                    </p>
                  </div>
                  <div class="flex shrink-0 items-center gap-2">
                    <n-button
                      circle
                      secondary
                      size="small"
                      :disabled="!workspace.currentProject"
                      :title="locale.t('newFile')"
                      @click="openNewFileModal"
                    >
                      <template #icon><n-icon><FilePlus /></n-icon></template>
                    </n-button>
                    <n-button
                      circle
                      secondary
                      size="small"
                      :loading="fileTreeRefreshing"
                      :title="locale.t('refresh')"
                      @click="refreshFileTree"
                    >
                      <template #icon><n-icon><RefreshCw /></n-icon></template>
                    </n-button>
                  </div>
                </header>
                <div class="workbench-tree-shell scrollbar-thin">
                  <WorkspaceFileTree
                    :nodes="workspace.fileTree"
                    :selected-path="selectedFilePath"
                    :expanded-paths="expandedFilePaths"
                    :empty-label="locale.t('emptyFileTree')"
                    :rename-label="locale.t('renameFile')"
                    :delete-label="locale.t('deleteFile')"
                    @select="onFileSelect"
                    @toggle="toggleFileDirectory"
                    @rename="onFileRename"
                    @delete="onFileDelete"
                  />
                </div>
              </section>
              <div
                class="file-pane-resize-handle"
                :class="{ 'is-active': activeWorkspaceResizeTarget === 'file-tree' }"
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize file tree"
                :aria-valuemin="fileTreeHeightLimits.min"
                :aria-valuemax="getFileTreeMaxHeight()"
                :aria-valuenow="liveFileTreeHeight"
                tabindex="0"
                @pointerdown="startFileTreeResize"
                @keydown="handleFileTreeResizeKeydown"
              />

              <section class="workbench-section workbench-section--preview">
                <div v-if="workspace.currentFile || filePreviewLoading || filePreviewError" class="file-workbench">
                  <div class="file-workbench__toolbar">
                    <n-radio-group v-model:value="filePaneMode" size="small">
                      <n-radio-button
                        v-for="option in filePaneModeOptions"
                        :key="option.value"
                        :value="option.value"
                      >
                        <span class="inline-flex items-center gap-1">
                          <n-icon>
                            <Eye v-if="option.value === 'preview'" />
                            <Pencil v-else />
                          </n-icon>
                          {{ option.label }}
                        </span>
                      </n-radio-button>
                    </n-radio-group>
                  </div>
                  <CodePreview
                    v-if="filePaneMode === 'preview'"
                    :path="workspace.currentFile?.path ?? selectedFilePath"
                    :content="workspace.currentFile?.content ?? ''"
                    :size="workspace.currentFile?.size ?? 0"
                    :loading="filePreviewLoading"
                    :error="filePreviewError"
                    :copy-label="locale.t('copyFileContent')"
                    :copied-label="locale.t('copied')"
                    :loading-label="locale.t('loadingFilePreview')"
                    :line-label="locale.t('lines')"
                    :bytes-label="locale.t('bytes')"
                  />
                  <CodeEditor
                    v-else-if="workspace.currentFile && !filePreviewLoading && !filePreviewError"
                    v-model:content="editorContent"
                    :path="workspace.currentFile.path"
                    :dirty="isCurrentFileDirty"
                    :saving="fileSaveLoading"
                    :error="fileSaveError"
                    :save-label="locale.t('saveFile')"
                    :revert-label="locale.t('revertFile')"
                    :unsaved-label="locale.t('fileUnsaved')"
                    :saved-label="locale.t('fileSaved')"
                    :line-label="locale.t('lines')"
                    :bytes-label="locale.t('bytes')"
                    @save="saveCurrentFile"
                    @revert="revertCurrentFile"
                  />
                </div>
                <div v-else class="workbench-empty-state">
                  <n-icon><FileText /></n-icon>
                  <span>{{ locale.t('selectFilePreview') }}</span>
                </div>
              </section>
            </div>
          </n-tab-pane>

          <n-tab-pane name="review" :tab="locale.t('review')">
            <div class="workbench-pane workbench-pane--stack-scroll scrollbar-thin">
              <section class="workbench-section review-section">
                <header class="workbench-section__header">
                  <div class="min-w-0">
                    <div class="workbench-section__title">
                      <n-icon><ShieldCheck /></n-icon>
                      <span>{{ locale.t('review') }}</span>
                    </div>
                    <p class="workbench-section__subtitle">
                      {{ locale.t('reviewSummary', { approvals: approvals.pending.length, patches: workspace.filePatches.length }) }}
                    </p>
                  </div>
                  <n-button
                    circle
                    secondary
                    size="small"
                    :loading="approvals.loading"
                    :title="locale.t('refresh')"
                    @click="refreshReviewPanel"
                  >
                    <template #icon><n-icon><RefreshCw /></n-icon></template>
                  </n-button>
                </header>

                <div class="workbench-list review-list scrollbar-thin">
                  <article class="review-card">
                    <header class="review-card__header">
                      <div>
                        <div class="review-card__title">{{ locale.t('planWorkbench') }}</div>
                        <div v-if="workspace.activePlan" class="review-card__meta">
                          {{ locale.t('planStatus', { status: workspace.activePlan.plan.status }) }}
                        </div>
                      </div>
                      <div v-if="workspace.activePlan" class="flex shrink-0 gap-2">
                        <n-button
                          size="small"
                          type="primary"
                          :disabled="!isPlanPendingApproval(workspace.activePlan.plan.status) || busy"
                          :loading="busy"
                          @click="approveActivePlan"
                        >
                          <template #icon><n-icon><Check /></n-icon></template>
                          {{ locale.t('approve') }}
                        </n-button>
                        <n-button
                          size="small"
                          secondary
                          :disabled="!canExecutePlan"
                          :loading="busy"
                          @click="executeActivePlan"
                        >
                          <template #icon><n-icon><Play /></n-icon></template>
                          {{ locale.t('executePlan') }}
                        </n-button>
                      </div>
                    </header>
                    <div v-if="workspace.activePlan" class="review-card__body">
                      <p class="review-plan-summary">{{ workspace.activePlan.plan.summary }}</p>
                      <ol class="review-plan-steps">
                        <li v-for="step in workspace.activePlan.steps" :key="step.id">
                          <span class="review-plan-steps__title">{{ step.title }}</span>
                          <span v-if="step.detail" class="review-plan-steps__detail">{{ step.detail }}</span>
                          <span class="review-plan-steps__status">{{ step.status }}</span>
                        </li>
                      </ol>
                    </div>
                    <div v-else class="workbench-empty-state">
                      <n-icon><Clock3 /></n-icon>
                      <span>{{ locale.t('noActivePlan') }}</span>
                    </div>
                  </article>

                  <div class="review-block-title">{{ locale.t('pendingApprovals') }}</div>
                  <div v-if="approvals.pending.length === 0" class="workbench-empty-state">
                    <n-icon><CheckCircle2 /></n-icon>
                    <span>{{ locale.t('noPendingApprovals') }}</span>
                  </div>
                  <article
                    v-for="approval in approvals.pending"
                    v-else
                    :key="approval.id"
                    class="approval-card"
                  >
                    <header class="approval-card__header">
                      <div class="min-w-0">
                        <div class="approval-card__title">{{ approval.toolCall.name }}</div>
                        <div class="approval-card__meta">
                          {{ approvalPreviewTitle(approval) }} · {{ approvalContext(approval) }} · {{ formatEventTime(approval.createdAt) }}
                        </div>
                      </div>
                      <div class="approval-card__header-actions">
                        <span class="approval-card__status">{{ approval.status }}</span>
                        <div class="approval-card__actions approval-card__actions--header">
                          <n-button
                            v-if="approval.toolCall.name !== 'run_command'"
                            size="small"
                            type="primary"
                            @click="approvals.approve(approval.id)"
                          >
                            <template #icon><n-icon><Check /></n-icon></template>
                            {{ approvalApproveLabel(approval) }}
                          </n-button>
                          <n-button
                            v-else
                            size="small"
                            type="primary"
                            @click="approvals.approve(approval.id, 'once')"
                          >
                            <template #icon><n-icon><Play /></n-icon></template>
                            {{ locale.t('runOnce') }}
                          </n-button>
                          <n-button
                            v-if="canGrantSessionCommandAutoRun(approval)"
                            size="small"
                            secondary
                            @click="approvals.approve(approval.id, 'session_auto')"
                          >
                            <template #icon><n-icon><ShieldCheck /></n-icon></template>
                            {{ locale.t('trustSessionCommands') }}
                          </n-button>
                          <n-button
                            v-if="canEnableProjectCommand(approval)"
                            size="small"
                            secondary
                            @click="approvals.approve(approval.id, 'project')"
                          >
                            <template #icon><n-icon><ShieldCheck /></n-icon></template>
                            {{ locale.t('allowForProject') }}
                          </n-button>
                          <n-button size="small" secondary @click="approvals.reject(approval.id)">
                            <template #icon><n-icon><X /></n-icon></template>
                            {{ locale.t('reject') }}
                          </n-button>
                        </div>
                      </div>
                    </header>
                    <div v-if="approval.preview?.kind === 'patch'" class="approval-card__preview">
                      <DiffPreview
                        :path="approval.preview.path"
                        :diff-text="approval.preview.diffText"
                        :empty-label="locale.t('eventPayload')"
                      />
                      <p v-if="approval.preview.truncated" class="approval-card__hint">
                        {{ locale.t('diffPreviewTruncated') }}
                      </p>
                    </div>
                    <div v-else-if="approval.preview?.kind === 'patch_set'" class="approval-card__preview">
                      <div class="patch-set-preview">
                        <DiffPreview
                          v-for="file in approval.preview.files"
                          :key="file.path"
                          :path="file.path"
                          :diff-text="file.diffText"
                          :empty-label="locale.t('eventPayload')"
                        />
                      </div>
                      <p v-if="approval.preview.truncated" class="approval-card__hint">
                        {{ locale.t('diffPreviewTruncated') }}
                      </p>
                    </div>
                    <div v-else-if="approval.preview?.kind === 'command'" class="approval-card__preview">
                      <div class="command-preview">
                        <div class="command-preview__label">{{ locale.t('commandPreview') }}</div>
                        <code>{{ approval.preview.command }}</code>
                        <span v-if="approval.preview.cwd">{{ approval.preview.cwd }}</span>
                        <span class="command-preview__mode">{{ commandExecutionModeLabel(approval) }}</span>
                        <span
                          class="command-preview__policy"
                          :class="{ 'is-warning': !approval.preview.policyAllowed || approval.preview.executionMode === 'shell' }"
                        >
                          {{ commandPolicyText(approval) }}
                        </span>
                      </div>
                    </div>
                    <pre v-else class="approval-card__payload scrollbar-thin">{{ approvalArguments(approval) }}</pre>
                  </article>

                  <div class="review-block-title">{{ locale.t('patchHistory') }}</div>
                  <div v-if="workspace.filePatches.length === 0" class="workbench-empty-state">
                    <n-icon><FileText /></n-icon>
                    <span>{{ locale.t('noPatchHistory') }}</span>
                  </div>
                  <article
                    v-for="patch in workspace.filePatches"
                    v-else
                    :key="patch.id"
                    class="approval-card"
                  >
                    <header class="approval-card__header">
                      <div class="min-w-0">
                        <div class="approval-card__title">{{ patch.relativePath }}</div>
                        <div class="approval-card__meta">
                          {{ patch.toolCall?.status ?? patch.status }} · {{ formatEventTime(patch.createdAt) }}
                        </div>
                      </div>
                      <span class="approval-card__status">{{ patch.status }}</span>
                    </header>
                    <div class="approval-card__preview">
                      <DiffPreview :path="patch.relativePath" :diff-text="patch.diffText" />
                      <p v-if="patch.status === 'proposed'" class="approval-card__hint">
                        {{ locale.t('proposedPatchApprovalHint') }}
                      </p>
                    </div>
                    <div v-if="patch.status === 'applied'" class="approval-card__actions">
                      <n-button size="small" secondary @click="revertPatch(patch.id)">
                        {{ locale.t('revertPatch') }}
                      </n-button>
                    </div>
                  </article>
                </div>
              </section>
            </div>
          </n-tab-pane>

          <n-tab-pane name="runs" :tab="locale.t('runs')">
            <div class="workbench-pane workbench-pane--stack-scroll scrollbar-thin">
              <section class="workbench-section">
                <header class="workbench-section__header">
                  <div class="min-w-0">
                    <div class="workbench-section__title">
                      <n-icon><Terminal /></n-icon>
                      <span>{{ locale.t('runs') }}</span>
                    </div>
                    <p class="workbench-section__subtitle">
                      {{ locale.t('runsSummary', commandRunStats) }}
                    </p>
                  </div>
                  <n-button
                    circle
                    secondary
                    size="small"
                    :title="locale.t('refresh')"
                    @click="refreshRunsPanel"
                  >
                    <template #icon><n-icon><RefreshCw /></n-icon></template>
                  </n-button>
                </header>

                <div class="command-request">
                  <div class="command-request__main">
                    <n-input
                      v-if="hasSessionCommandAutoRun"
                      v-model:value="manualCommand"
                      class="command-request__select"
                      :placeholder="locale.t('shellCommandInputPlaceholder')"
                      :disabled="!workspace.currentSession || busy"
                    />
                    <n-select
                      v-else
                      v-model:value="manualCommand"
                      class="command-request__select"
                      :options="commandOptions"
                      :placeholder="locale.t('commandInputPlaceholder')"
                      :disabled="!workspace.currentSession || busy || commandOptions.length === 0"
                      :loading="workspace.allowedCommandsLoading"
                      filterable
                      :consistent-menu-width="false"
                    />
                    <n-select
                      v-model:value="manualCommandCwd"
                      class="command-request__cwd"
                      :options="commandDirectoryOptions"
                      :placeholder="locale.t('commandCwdPlaceholder')"
                      :disabled="!workspace.currentSession || busy"
                      filterable
                      :consistent-menu-width="false"
                    />
                  </div>
                  <div class="command-request__actions">
                    <n-button
                      v-if="hasSessionCommandAutoRun"
                      secondary
                      :loading="workspace.commandAuthorizationLoading"
                      @click="revokeCommandAuthorization"
                    >
                      <template #icon><n-icon><X /></n-icon></template>
                      {{ locale.t('revokeSessionCommandTrust') }}
                    </n-button>
                    <n-button
                      v-if="showNoAllowedCommands && auth.user?.role === 'admin'"
                      secondary
                      @click="openSettings('commands')"
                    >
                      <template #icon><n-icon><Settings /></n-icon></template>
                      {{ locale.t('commandPolicy') }}
                    </n-button>
                    <n-button
                      type="primary"
                      :loading="busy"
                      :disabled="!canSubmitManualCommand"
                      @click="submitManualCommand"
                    >
                      <template #icon><n-icon><Send /></n-icon></template>
                      {{ locale.t('requestRun') }}
                    </n-button>
                  </div>
                  <div v-if="hasSessionCommandAutoRun" class="command-request__notice is-trusted">
                    <n-icon><ShieldCheck /></n-icon>
                    <span>{{ locale.t('sessionCommandTrustActive') }}</span>
                  </div>
                  <div v-else-if="showNoAllowedCommands" class="command-request__notice">
                    <n-icon><Info /></n-icon>
                    <span>{{ noAllowedCommandsHint }}</span>
                  </div>
                </div>

                <div class="workbench-list runs-list scrollbar-thin">
                  <div v-if="workspace.commandRuns.length === 0" class="workbench-empty-state">
                    <n-icon><Terminal /></n-icon>
                    <span>{{ locale.t('noCommandRuns') }}</span>
                  </div>
                  <article
                    v-for="run in workspace.commandRuns"
                    v-else
                    :key="run.id"
                    class="run-card"
                    :class="commandRunToneClass(run.status)"
                  >
                    <button class="run-card__header" type="button" @click="toggleCommandRun(run.id)">
                      <span class="run-card__toggle">
                        <n-icon>
                          <ChevronDown v-if="isCommandRunExpanded(run.id)" />
                          <ChevronRight v-else />
                        </n-icon>
                      </span>
                      <span class="run-card__main">
                        <span class="run-card__command">{{ run.command }}</span>
                        <span class="run-card__meta">
                          {{ run.status }} · {{ commandRunExitLabel(run.exitCode) }} · {{ formatEventTime(run.createdAt) }}
                        </span>
                      </span>
                      <span class="run-card__status">{{ run.status }}</span>
                    </button>

                    <div v-if="isCommandRunExpanded(run.id)" class="run-card__body">
                      <div v-if="run.cwd" class="run-card__cwd">{{ run.cwd }}</div>
                      <div class="run-output-grid">
                        <section class="run-output">
                          <header>
                            <span>{{ locale.t('stdout') }}</span>
                            <n-button
                              circle
                              quaternary
                              size="tiny"
                              :disabled="!run.stdout && !run.stderr"
                              :title="locale.t('copyOutput')"
                              @click="copyCommandRunOutput(run.id, run.stdout, run.stderr)"
                            >
                              <template #icon>
                                <n-icon>
                                  <Check v-if="copiedCommandRunId === run.id" />
                                  <Clipboard v-else />
                                </n-icon>
                              </template>
                            </n-button>
                          </header>
                          <pre class="scrollbar-thin">{{ run.stdout || locale.t('noOutput') }}</pre>
                        </section>
                        <section class="run-output run-output--stderr">
                          <header>
                            <span>{{ locale.t('stderr') }}</span>
                          </header>
                          <pre class="scrollbar-thin">{{ run.stderr || locale.t('noOutput') }}</pre>
                        </section>
                      </div>
                    </div>
                  </article>
                </div>
              </section>
            </div>
          </n-tab-pane>

          <n-tab-pane name="events" :tab="locale.t('events')">
            <div class="workbench-pane workbench-pane--events">
              <section class="workbench-section">
                <header class="workbench-section__header">
                  <div class="min-w-0">
                    <div class="workbench-section__title">
                      <n-icon><Activity /></n-icon>
                      <span>{{ locale.t('events') }}</span>
                    </div>
                    <p class="workbench-section__subtitle">
                      {{ locale.t('eventSummary', { count: workspace.eventLog.length, status: workspace.eventStatus }) }}
                    </p>
                  </div>
                  <span class="event-status" :class="`is-${workspace.eventStatus}`">
                    <n-icon><CircleDot /></n-icon>
                    {{ workspace.eventStatus }}
                  </span>
                </header>

                <div class="diagnostics-strip">
                  <section class="diagnostics-card">
                    <div class="diagnostics-card__icon">
                      <n-icon><Cable /></n-icon>
                    </div>
                    <div class="min-w-0">
                      <div class="diagnostics-card__title">{{ locale.t('modelDiagnostics') }}</div>
                      <div class="diagnostics-card__summary">{{ modelDiagnosticSummary }}</div>
                      <div v-if="workspace.latestModelDiagnostic?.baseUrl" class="diagnostics-card__meta">
                        {{ workspace.latestModelDiagnostic.baseUrl }}
                      </div>
                      <div v-if="workspace.latestModelDiagnostic?.durationMs !== undefined" class="diagnostics-card__meta">
                        {{ locale.t('modelDiagnosticsDuration', { duration: workspace.latestModelDiagnostic.durationMs }) }}
                      </div>
                      <div v-if="workspace.latestModelDiagnostic?.message" class="diagnostics-card__error">
                        {{ workspace.latestModelDiagnostic.message }}
                      </div>
                    </div>
                  </section>
                  <n-radio-group v-model:value="eventFilter" size="small">
                    <n-radio-button
                      v-for="option in eventFilterOptions"
                      :key="option.value"
                      :value="option.value"
                    >
                      <span class="inline-flex items-center gap-1">
                        <n-icon><component :is="eventFilterIcon(option.value)" /></n-icon>
                        {{ option.label }}
                      </span>
                    </n-radio-button>
                  </n-radio-group>
                </div>

                <div class="event-timeline scrollbar-thin">
                  <div v-if="filteredEventLog.length === 0" class="workbench-empty-state">
                    <n-icon><Clock3 /></n-icon>
                    <span>{{ locale.t('noEvents') }}</span>
                  </div>
                  <article
                    v-for="event in filteredEventLog"
                    v-else
                    :key="`${event.time}-${event.type}`"
                    class="event-item"
                    :class="eventToneClass(event.type)"
                  >
                    <div class="event-item__rail">
                      <span class="event-item__dot">
                        <n-icon><component :is="eventToneIcon(event.type)" /></n-icon>
                      </span>
                    </div>
                    <div class="event-item__body">
                      <header class="event-item__header">
                        <span class="event-item__type">{{ eventTitle(event.type, event.data) }}</span>
                        <time class="event-item__time">{{ formatEventTime(event.time) }}</time>
                      </header>
                      <p class="event-item__summary">{{ eventSummary(event.type, event.data) }}</p>
                      <pre class="event-item__payload scrollbar-thin">{{ stringifyPayload(event.data) }}</pre>
                    </div>
                  </article>
                </div>
              </section>
            </div>
          </n-tab-pane>
        </n-tabs>
      </aside>
    </div>

    <n-modal v-model:show="sessionRenameModal" preset="card" :title="locale.t('renameSession')" class="max-w-[520px]">
      <n-form label-placement="top" @submit.prevent="submitSessionRename">
        <n-form-item :label="locale.t('sessionTitle')">
          <n-input
            v-model:value="sessionRenameTitle"
            maxlength="120"
            show-count
            :placeholder="locale.t('sessionTitle')"
            @keyup.enter="submitSessionRename"
          />
        </n-form-item>
        <div class="flex justify-end gap-2">
          <n-button secondary :disabled="busy" @click="closeSessionRename">
            {{ locale.t('cancel') }}
          </n-button>
          <n-button type="primary" :loading="busy" :disabled="!canSubmitSessionRename" @click="submitSessionRename">
            {{ locale.t('save') }}
          </n-button>
        </div>
      </n-form>
    </n-modal>

    <n-modal v-model:show="newFileModal" preset="card" :title="locale.t('newFile')" class="max-w-[520px]">
      <n-form label-placement="top" @submit.prevent="submitNewFile">
        <n-form-item :label="locale.t('newFilePath')">
          <n-input
            v-model:value="newFilePath"
            :placeholder="locale.t('newFilePlaceholder')"
            :input-props="{
              autocomplete: 'off',
              autocapitalize: 'off',
              spellcheck: 'false',
            }"
            @keyup.enter="submitNewFile"
          />
        </n-form-item>
        <p v-if="newFileError" class="m-0 mb-3 text-xs leading-5 text-red-600">{{ newFileError }}</p>
        <div class="flex justify-end gap-2">
          <n-button secondary :disabled="newFileLoading" @click="newFileModal = false">
            {{ locale.t('cancel') }}
          </n-button>
          <n-button
            type="primary"
            :disabled="!newFilePath.trim()"
            :loading="newFileLoading"
            @click="submitNewFile"
          >
            <template #icon><n-icon><FilePlus /></n-icon></template>
            {{ locale.t('createFile') }}
          </n-button>
        </div>
      </n-form>
    </n-modal>

    <n-modal v-model:show="renameFileModal" preset="card" :title="locale.t('renameFile')" class="max-w-[520px]">
      <n-form label-placement="top" @submit.prevent="submitRenameFile">
        <n-form-item :label="locale.t('filePath')">
          <n-input
            v-model:value="renameFilePath"
            :placeholder="locale.t('newFilePlaceholder')"
            :input-props="{
              autocomplete: 'off',
              autocapitalize: 'off',
              spellcheck: 'false',
            }"
            @keyup.enter="submitRenameFile"
          />
        </n-form-item>
        <p v-if="renameFileError" class="m-0 mb-3 text-xs leading-5 text-red-600">{{ renameFileError }}</p>
        <div class="flex justify-end gap-2">
          <n-button secondary :disabled="renameFileLoading" @click="renameFileModal = false">
            {{ locale.t('cancel') }}
          </n-button>
          <n-button
            type="primary"
            :disabled="!renameFilePath.trim() || renameFilePath.trim() === renameFileSourcePath"
            :loading="renameFileLoading"
            @click="submitRenameFile"
          >
            {{ locale.t('renameFile') }}
          </n-button>
        </div>
      </n-form>
    </n-modal>

    <n-modal v-model:show="connectModal" preset="card" :title="locale.t('connectModelProvider')" class="max-w-[720px]">
      <div class="grid gap-4 md:grid-cols-[260px_1fr]">
        <section>
          <n-input
            v-model:value="connectQuery"
            class="mb-3"
            :placeholder="locale.t('searchProvidersPlaceholder')"
            @update:value="() => searchProviders()"
            @keyup.enter="searchProviders"
          />
          <div class="space-y-2">
            <button
              v-for="provider in connectProviders"
              :key="provider.id"
              class="connect-provider-card w-full rounded border border-mebius-border p-3 text-left hover:bg-slate-50"
              :class="{ 'is-selected border-mebius-accent bg-teal-50': connectSelected?.id === provider.id }"
              @click="chooseProvider(provider)"
            >
              <div class="font-medium">{{ provider.displayName }}</div>
              <div class="text-xs text-mebius-muted">{{ providerDescription(provider) }}</div>
            </button>
          </div>
        </section>
        <section>
          <n-empty v-if="!connectSelected" :description="locale.t('selectProvider')" />
          <div v-else>
            <h3 class="m-0 mb-1 text-base font-semibold">{{ connectSelected.displayName }}</h3>
            <p class="m-0 text-sm text-mebius-muted">{{ connectSelected.baseUrl || locale.t('customEndpoint') }}</p>
            <p v-if="connectSelected.recommendedModels.length" class="m-0 mb-4 text-xs text-mebius-muted">
              {{ locale.t('recommendedModels', { models: connectSelected.recommendedModels.join(', ') }) }}
            </p>
            <div v-else class="mb-4"></div>
            <n-form label-placement="top" autocomplete="off">
              <input class="pointer-events-none fixed h-px w-px opacity-0" style="left: -1000px; top: -1000px;" type="text" name="mebius-connect-username-decoy" autocomplete="username" tabindex="-1" aria-hidden="true" />
              <input class="pointer-events-none fixed h-px w-px opacity-0" style="left: -1000px; top: -1000px;" type="password" name="mebius-connect-password-decoy" autocomplete="current-password" tabindex="-1" aria-hidden="true" />
              <n-form-item v-for="field in connectFields" :key="field.name" :label="connectFieldLabel(field)">
                <n-input
                  v-model:value="connectForm[field.name]"
                  :type="field.type === 'password' ? 'password' : 'text'"
                  :placeholder="connectFieldPlaceholder(field)"
                  :input-props="connectInputProps(field)"
                  show-password-on="mousedown"
                />
              </n-form-item>
              <n-button type="primary" :loading="busy" :disabled="!connectReady" @click="submitConnect">
                <template #icon><n-icon><Play /></n-icon></template>
                {{ locale.t('validateAndConnect') }}
              </n-button>
            </n-form>
          </div>
        </section>
      </div>
    </n-modal>
  </main>
</template>

<style scoped>
.workspace-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.workspace-side-panel {
  min-height: 0;
  min-width: 0;
}

.workspace-main {
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.session-title-button {
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  display: block;
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0;
  line-height: 1.5rem;
  margin: 0;
  max-width: 100%;
  overflow: hidden;
  padding: 0;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-title-button:hover,
.session-title-button:focus-visible {
  color: var(--mebius-accent);
  outline: none;
}

.session-title-button:disabled {
  color: inherit;
  cursor: default;
}

.workspace-side-panel--right {
  background: #f8fafc;
}

.left-sidebar-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.left-sidebar-card {
  flex-shrink: 0;
}

.left-sidebar-card--projects {
  max-height: 34vh;
  min-height: 140px;
  overflow-y: auto;
}

.left-sidebar-disclosure {
  align-items: center;
  background: #ffffff;
  border: 0;
  color: #0f172a;
  cursor: pointer;
  display: flex;
  font-size: 14px;
  font-weight: 600;
  justify-content: space-between;
  letter-spacing: 0;
  min-height: 42px;
  outline: none;
  padding: 0.65rem 0.75rem;
  text-align: left;
  width: 100%;
}

.left-sidebar-disclosure:hover,
.left-sidebar-disclosure:focus-visible {
  background: #f8fafc;
}

.left-sidebar-disclosure__title {
  align-items: center;
  display: inline-flex;
  gap: 0.5rem;
  min-width: 0;
}

.left-sidebar-disclosure__chevron {
  color: #64748b;
  flex-shrink: 0;
}

.workspace-content-grid {
  display: grid;
  flex: 1;
  grid-template-columns: var(--session-pane-width) 10px minmax(0, 1fr);
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.workspace-content-grid.is-session-pane-collapsed {
  grid-template-columns: minmax(0, 1fr);
}

.session-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.session-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.chat-thread {
  align-items: flex-start;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin: 0 auto;
  max-width: 1120px;
  min-width: 0;
  width: 100%;
}

.chat-empty-state {
  align-items: center;
  background:
    linear-gradient(180deg, #ffffff 0%, #fffaf2 100%),
    linear-gradient(90deg, rgb(255 180 71 / 8%) 1px, transparent 1px) 0 0 / 28px 100%;
  border: 1px dashed #d9dee7;
  border-radius: 8px;
  color: #667085;
  display: flex;
  flex-direction: column;
  font-size: 14px;
  gap: 0.9rem;
  justify-content: center;
  min-height: 220px;
  overflow: hidden;
  padding: 2rem;
  text-align: center;
}

.chat-empty-state__brand {
  filter: saturate(0.92);
  opacity: 0.78;
}

.chat-empty-state p {
  line-height: 1.6;
  margin: 0;
  max-width: 420px;
}

.workspace-content-resize-handle {
  cursor: col-resize;
  min-height: 0;
  outline: none;
  position: relative;
  touch-action: none;
  width: 10px;
}

.workspace-content-resize-handle::before,
.workspace-content-resize-handle::after {
  content: "";
  left: 50%;
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  transition:
    background-color 140ms ease,
    box-shadow 140ms ease,
    opacity 140ms ease;
}

.workspace-content-resize-handle::before {
  background: #e2e8f0;
  bottom: 0;
  width: 1px;
}

.workspace-content-resize-handle::after {
  background: #0f766e;
  border-radius: 999px;
  box-shadow: 0 0 0 3px rgb(15 118 110 / 12%);
  height: 40px;
  opacity: 0;
  top: 50%;
  width: 3px;
}

.workspace-content-resize-handle:hover::before,
.workspace-content-resize-handle:focus-visible::before,
.workspace-content-resize-handle.is-active::before {
  background: #99f6e4;
}

.workspace-content-resize-handle:hover::after,
.workspace-content-resize-handle:focus-visible::after,
.workspace-content-resize-handle.is-active::after {
  opacity: 1;
}

.sidebar-resize-handle {
  background: transparent;
  bottom: 0;
  cursor: col-resize;
  display: none;
  outline: none;
  position: absolute;
  top: 0;
  touch-action: pan-y;
  width: 8px;
  z-index: 20;
}

.sidebar-resize-handle--left {
  right: 0;
}

.sidebar-resize-handle--right {
  left: 0;
}

.sidebar-resize-handle::before,
.sidebar-resize-handle::after {
  content: "";
  left: 50%;
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  transition:
    background-color 140ms ease,
    box-shadow 140ms ease,
    opacity 140ms ease;
}

.sidebar-resize-handle::before {
  background: transparent;
  bottom: 0;
  width: 1px;
}

.sidebar-resize-handle::after {
  background: #0f766e;
  border-radius: 999px;
  box-shadow: 0 0 0 3px rgb(15 118 110 / 12%);
  height: 44px;
  opacity: 0;
  top: 50%;
  width: 3px;
}

.sidebar-resize-handle:hover::before,
.sidebar-resize-handle:focus-visible::before,
.sidebar-resize-handle.is-active::before {
  background: #99f6e4;
}

.sidebar-resize-handle:hover::after,
.sidebar-resize-handle:focus-visible::after,
.sidebar-resize-handle.is-active::after {
  opacity: 1;
}

.workbench-tabs {
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.workbench-tabs :deep(.n-tabs-nav) {
  background: #ffffff;
  border-bottom: 1px solid #d9dee7;
  flex-shrink: 0;
  padding: 0 0.75rem;
}

.workbench-tabs :deep(.n-tabs-tab) {
  letter-spacing: 0;
}

.workbench-tabs :deep(.n-tabs-pane-wrapper) {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.workbench-tabs :deep(.n-tab-pane),
.workbench-tabs :deep(.workbench-tabs__pane) {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  height: auto;
  min-height: 0;
  overflow: hidden;
}

.workbench-pane {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  padding: 0.75rem;
}

.workbench-pane > .workbench-section {
  flex: 1 1 0;
  min-height: 0;
}

.workbench-pane--stack-scroll {
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.workbench-pane--stack-scroll > .workbench-section {
  flex: 0 0 auto;
  min-height: 100%;
  overflow: visible;
}

.workbench-pane--stack-scroll .workbench-list {
  flex: 0 0 auto;
  min-height: auto;
  overflow: visible;
}

.workbench-pane--files {
  display: grid;
  gap: 0;
  grid-template-rows: minmax(150px, var(--file-tree-pane-height)) 12px minmax(160px, 1fr);
}

.file-pane-resize-handle {
  cursor: row-resize;
  min-height: 12px;
  outline: none;
  position: relative;
  touch-action: none;
}

.file-pane-resize-handle::before,
.file-pane-resize-handle::after {
  content: "";
  left: 50%;
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  transition:
    background-color 140ms ease,
    box-shadow 140ms ease,
    opacity 140ms ease;
}

.file-pane-resize-handle::before {
  background: #dbe3ee;
  height: 1px;
  width: 100%;
}

.file-pane-resize-handle::after {
  background: #0f766e;
  border-radius: 999px;
  box-shadow: 0 0 0 3px rgb(15 118 110 / 12%);
  height: 3px;
  opacity: 0;
  width: 44px;
}

.file-pane-resize-handle:hover::before,
.file-pane-resize-handle:focus-visible::before,
.file-pane-resize-handle.is-active::before {
  background: #99f6e4;
}

.file-pane-resize-handle:hover::after,
.file-pane-resize-handle:focus-visible::after,
.file-pane-resize-handle.is-active::after {
  opacity: 1;
}

.workbench-pane--events {
  display: flex;
}

.workbench-pane--events > .workbench-section {
  flex: 1;
}

.workbench-section {
  background:
    linear-gradient(180deg, #ffffff 0%, #fbfcfe 100%),
    radial-gradient(circle at top right, rgb(20 184 166 / 10%), transparent 42%);
  border: 1px solid #d9dee7;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.workbench-section--preview {
  background: transparent;
  border: 0;
  box-shadow: none;
}

.file-workbench {
  display: grid;
  gap: 0.5rem;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
}

.file-workbench__toolbar {
  align-items: center;
  display: flex;
  justify-content: flex-end;
  min-height: 32px;
}

.workbench-section__header {
  align-items: center;
  border-bottom: 1px solid #e3e8ef;
  display: flex;
  flex-shrink: 0;
  gap: 0.75rem;
  justify-content: space-between;
  min-height: 58px;
  padding: 0.65rem 0.75rem;
}

.workbench-section__title {
  align-items: center;
  color: #0f172a;
  display: flex;
  font-size: 13px;
  font-weight: 700;
  gap: 0.45rem;
  letter-spacing: 0;
  line-height: 1.2;
}

.workbench-section__title .n-icon {
  color: #0f766e;
}

.workbench-section__subtitle {
  color: #64748b;
  font-size: 11px;
  line-height: 1.35;
  margin: 0.2rem 0 0;
}

.workbench-tree-shell,
.workbench-list,
.event-timeline {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
}

.workbench-tree-shell {
  background:
    linear-gradient(90deg, rgb(226 232 240 / 55%) 1px, transparent 1px) 18px 0 / 18px 100%,
    #ffffff;
  padding: 0.25rem;
}

.workbench-list {
  padding: 0.75rem;
}

.review-section {
  flex: 1 1 0;
  min-height: 0;
}

.review-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  overflow-x: hidden;
  overflow-y: scroll;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.review-list > * {
  flex-shrink: 0;
}

.review-card {
  background: #ffffff;
  border: 1px solid #d9dee7;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
  overflow: hidden;
}

.review-card__header {
  align-items: flex-start;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  padding: 0.75rem;
}

.review-card__title {
  color: #0f172a;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.35;
}

.review-card__meta {
  color: #64748b;
  font-size: 11px;
  line-height: 1.4;
  margin-top: 0.15rem;
}

.review-card__body {
  padding: 0.75rem;
}

.review-plan-summary {
  color: #334155;
  font-size: 12px;
  line-height: 1.55;
  margin: 0 0 0.75rem;
}

.review-plan-steps {
  display: grid;
  gap: 0.5rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.review-plan-steps li {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  display: grid;
  gap: 0.2rem;
  padding: 0.55rem 0.65rem;
}

.review-plan-steps__title {
  color: #0f172a;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.35;
}

.review-plan-steps__detail,
.review-plan-steps__status {
  color: #64748b;
  font-size: 11px;
  line-height: 1.4;
}

.review-plan-steps__status {
  text-transform: uppercase;
}

.review-block-title {
  color: #475569;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0;
  line-height: 1;
  padding: 0.25rem 0.1rem 0;
  text-transform: uppercase;
}

.workbench-empty-state {
  align-items: center;
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  color: #64748b;
  display: flex;
  flex-direction: column;
  font-size: 13px;
  gap: 0.5rem;
  justify-content: center;
  min-height: 160px;
  padding: 1.25rem;
  text-align: center;
}

.workbench-empty-state .n-icon {
  color: #94a3b8;
  font-size: 22px;
}

.approval-card {
  background: #ffffff;
  border: 1px solid #d9dee7;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
  margin-bottom: 0.75rem;
  overflow: hidden;
}

.approval-card__header {
  align-items: flex-start;
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  justify-content: space-between;
  padding: 0.75rem 0.75rem 0.5rem;
}

.approval-card__header > .min-w-0 {
  flex: 1 1 180px;
}

.approval-card__header-actions {
  align-items: flex-end;
  display: flex;
  flex: 0 1 auto;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

.approval-card__title {
  color: #0f172a;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.approval-card__meta {
  color: #64748b;
  font-size: 11px;
  line-height: 1.4;
  margin-top: 0.15rem;
}

.approval-card__status {
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 999px;
  color: #c2410c;
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  padding: 0.3rem 0.45rem;
  text-transform: uppercase;
}

.approval-card__payload {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-left: 0;
  border-right: 0;
  color: #334155;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  line-height: 1.55;
  margin: 0;
  max-height: 150px;
  overflow: auto;
  padding: 0.65rem 0.75rem;
}

.approval-card__preview {
  padding: 0 0.75rem 0.75rem;
}

.patch-set-preview {
  display: grid;
  gap: 0.75rem;
}

.approval-card__hint {
  color: #b45309;
  font-size: 11px;
  line-height: 1.4;
  margin: 0.45rem 0 0;
}

.command-preview {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  display: grid;
  gap: 0.35rem;
  padding: 0.65rem;
}

.command-preview__label {
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
}

.command-preview code {
  color: #0f172a;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.command-preview span {
  color: #64748b;
  font-size: 11px;
}

.command-preview__mode {
  font-weight: 700;
}

.command-preview__policy {
  border-left: 3px solid #10b981;
  padding-left: 0.5rem;
}

.command-preview__policy.is-warning {
  border-left-color: #f59e0b;
  color: #92400e;
}

.command-request {
  align-items: flex-start;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding: 0.75rem;
}

.command-request__main {
  display: grid;
  flex: 1 1 auto;
  gap: 0.5rem;
  grid-template-columns: minmax(0, 1fr) minmax(140px, 0.35fr);
  min-width: 0;
}

.command-request__select,
.command-request__cwd {
  min-width: 0;
}

.command-request__actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.command-request__notice {
  align-items: center;
  color: #92400e;
  display: flex;
  flex: 1 1 100%;
  font-size: 12px;
  gap: 0.4rem;
  line-height: 1.4;
  min-width: 0;
}

.command-request__notice .n-icon {
  flex: 0 0 auto;
}

.command-request__notice.is-trusted {
  color: #047857;
}

.runs-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

@media (max-width: 760px) {
  .command-request {
    align-items: stretch;
    flex-direction: column;
  }

  .command-request__main {
    grid-template-columns: minmax(0, 1fr);
  }

  .command-request__actions {
    justify-content: flex-end;
  }
}

.run-card {
  background: #ffffff;
  border: 1px solid #d9dee7;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
  overflow: hidden;
}

.run-card__header {
  align-items: center;
  background: #ffffff;
  border: 0;
  cursor: pointer;
  display: grid;
  gap: 0.55rem;
  grid-template-columns: 1.25rem minmax(0, 1fr) auto;
  padding: 0.72rem 0.75rem;
  text-align: left;
  width: 100%;
}

.run-card__header:hover {
  background: #f8fafc;
}

.run-card__toggle {
  color: #64748b;
  display: inline-flex;
}

.run-card__main {
  display: grid;
  min-width: 0;
}

.run-card__command {
  color: #0f172a;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-card__meta,
.run-card__cwd {
  color: #64748b;
  font-size: 11px;
  line-height: 1.4;
}

.run-card__status {
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  color: #64748b;
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
  padding: 0.32rem 0.5rem;
  text-transform: uppercase;
}

.run-card.is-success .run-card__status {
  background: #ecfdf3;
  border-color: #bbf7d0;
  color: #15803d;
}

.run-card.is-danger .run-card__status {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b42318;
}

.run-card.is-warning .run-card__status {
  background: #fffbeb;
  border-color: #fde68a;
  color: #b45309;
}

.run-card__body {
  border-top: 1px solid #e2e8f0;
  display: grid;
  gap: 0.65rem;
  padding: 0.75rem;
}

.run-output-grid {
  display: grid;
  gap: 0.65rem;
}

.run-output {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  min-width: 0;
  overflow: hidden;
}

.run-output header {
  align-items: center;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  color: #475569;
  display: flex;
  font-size: 11px;
  font-weight: 800;
  justify-content: space-between;
  min-height: 32px;
  padding: 0.35rem 0.55rem;
  text-transform: uppercase;
}

.run-output pre {
  background: #ffffff;
  color: #334155;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  line-height: 1.55;
  margin: 0;
  max-height: 240px;
  min-height: 56px;
  overflow: auto;
  padding: 0.65rem;
  white-space: pre-wrap;
  word-break: break-word;
}

.run-output--stderr pre {
  color: #7f1d1d;
}

.approval-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.65rem 0.75rem 0.75rem;
}

.approval-card__actions--header {
  justify-content: flex-end;
  padding: 0;
}

.event-status {
  align-items: center;
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  color: #64748b;
  display: inline-flex;
  flex-shrink: 0;
  font-size: 11px;
  gap: 0.3rem;
  line-height: 1;
  padding: 0.38rem 0.55rem;
}

.event-status.is-open {
  background: #ecfdf3;
  border-color: #bbf7d0;
  color: #15803d;
}

.event-status.is-connecting {
  background: #fffbeb;
  border-color: #fde68a;
  color: #b45309;
}

.event-status.is-closed {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b42318;
}

.event-timeline {
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0.75rem 0.75rem 0.75rem 0;
}

.diagnostics-strip {
  border-bottom: 1px solid #e2e8f0;
  display: grid;
  gap: 0.65rem;
  grid-template-columns: minmax(0, 1fr);
  padding: 0.75rem;
}

.diagnostics-card {
  align-items: flex-start;
  background: #ffffff;
  border: 1px solid #d9dee7;
  border-radius: 8px;
  display: grid;
  gap: 0.65rem;
  grid-template-columns: 30px minmax(0, 1fr);
  padding: 0.7rem;
}

.diagnostics-card__icon {
  align-items: center;
  background: #e6f6f2;
  border: 1px solid #b8e6dc;
  border-radius: 6px;
  color: #0f766e;
  display: inline-flex;
  height: 30px;
  justify-content: center;
  width: 30px;
}

.diagnostics-card__title {
  color: #0f172a;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.25;
}

.diagnostics-card__summary,
.diagnostics-card__meta,
.diagnostics-card__error {
  font-size: 11px;
  line-height: 1.4;
  margin-top: 0.18rem;
  overflow-wrap: anywhere;
}

.diagnostics-card__summary {
  color: #334155;
}

.diagnostics-card__meta {
  color: #64748b;
}

.diagnostics-card__error {
  color: #b42318;
}

.event-item {
  display: grid;
  gap: 0.55rem;
  grid-template-columns: 2rem minmax(0, 1fr);
  margin-bottom: 0.75rem;
}

.event-item__rail {
  display: flex;
  justify-content: center;
  position: relative;
}

.event-item__rail::after {
  background: #dbe3ee;
  bottom: -0.9rem;
  content: "";
  position: absolute;
  top: 2rem;
  width: 1px;
}

.event-item:last-child .event-item__rail::after {
  display: none;
}

.event-item__dot {
  align-items: center;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  color: #2563eb;
  display: inline-flex;
  height: 24px;
  justify-content: center;
  margin-top: 0.2rem;
  width: 24px;
  z-index: 1;
}

.event-item.is-success .event-item__dot {
  background: #ecfdf3;
  border-color: #bbf7d0;
  color: #15803d;
}

.event-item.is-warning .event-item__dot {
  background: #fffbeb;
  border-color: #fde68a;
  color: #b45309;
}

.event-item.is-danger .event-item__dot {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b42318;
}

.event-item__body {
  background: #ffffff;
  border: 1px solid #d9dee7;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
  min-width: 0;
  overflow: hidden;
}

.event-item__header {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
  padding: 0.65rem 0.7rem 0.2rem;
}

.event-item__type {
  color: #0f172a;
  font-size: 12px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.event-item__time {
  color: #94a3b8;
  flex-shrink: 0;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.event-item__summary {
  color: #475569;
  font-size: 11px;
  line-height: 1.45;
  margin: 0;
  padding: 0.15rem 0.7rem 0.55rem;
}

.event-item__payload {
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
  color: #475569;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 10.5px;
  line-height: 1.5;
  margin: 0;
  max-height: 120px;
  overflow: auto;
  padding: 0.55rem 0.7rem;
  white-space: pre-wrap;
}

@media (min-width: 1024px) {
  .workspace-shell {
    grid-template-columns:
      var(--left-sidebar-width) minmax(420px, 1fr)
      var(--right-sidebar-width);
  }

  .workspace-side-panel {
    position: relative;
    transition: opacity 120ms ease;
  }

  .sidebar-resize-handle {
    display: block;
  }

  .workspace-side-panel--left .left-sidebar-body {
    margin-right: 8px;
  }

  .workspace-shell.is-resizing-sidebar,
  .workspace-shell.is-resizing-sidebar * {
    cursor: col-resize !important;
    user-select: none;
  }

  .workspace-shell.is-resizing-session-pane,
  .workspace-shell.is-resizing-session-pane * {
    cursor: col-resize !important;
    user-select: none;
  }

  .workspace-shell.is-resizing-file-pane,
  .workspace-shell.is-resizing-file-pane * {
    cursor: row-resize !important;
    user-select: none;
  }

  .workspace-side-panel.is-collapsed {
    opacity: 0;
    pointer-events: none;
  }
}

@media (max-width: 1023px) {
  .workspace-content-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .session-pane {
    display: none;
  }

  .workspace-side-panel {
    bottom: 0;
    max-width: 90vw;
    position: fixed;
    top: 0;
    transition:
      box-shadow 160ms ease,
      transform 160ms ease;
    width: 320px;
    z-index: 30;
  }

  .workspace-side-panel--left {
    left: 0;
    transform: translateX(-100%);
  }

  .workspace-side-panel--right {
    right: 0;
    transform: translateX(100%);
    width: 380px;
  }

  .workspace-side-panel.is-overlay-open {
    box-shadow: 0 24px 80px rgb(15 23 42 / 18%);
    transform: translateX(0);
  }
}

.workspace-root {
  position: relative;
}

.workspace-root::before {
  background:
    linear-gradient(90deg, rgb(255 255 255 / 5%) 1px, transparent 1px),
    linear-gradient(0deg, rgb(255 255 255 / 4%) 1px, transparent 1px);
  background-size: 38px 38px;
  content: "";
  inset: 0;
  mask-image: radial-gradient(circle at 48% 32%, black 0%, transparent 70%);
  opacity: 0.44;
  pointer-events: none;
  position: absolute;
}

.workspace-root > .workspace-shell {
  position: relative;
  z-index: 1;
}

.workspace-side-panel,
.workspace-topbar,
.session-pane,
.composer-footer {
  background:
    linear-gradient(180deg, rgb(255 255 255 / 7%), transparent 32%),
    var(--mebius-panel) !important;
  backdrop-filter: blur(22px);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%);
}

.workspace-main {
  background:
    radial-gradient(circle at 55% -10%, rgb(255 159 67 / 10%), transparent 30rem),
    rgb(7 10 18 / 46%);
}

.workspace-topbar {
  box-shadow: 0 12px 42px rgb(0 0 0 / 18%);
}

.left-sidebar-card,
.session-pane {
  color: var(--mebius-ink-soft);
}

.left-sidebar-disclosure {
  background: transparent;
  color: var(--mebius-ink);
}

.left-sidebar-disclosure:hover,
.left-sidebar-disclosure:focus-visible {
  background: rgb(255 255 255 / 6%);
}

.left-sidebar-disclosure__chevron {
  color: var(--mebius-muted);
}

.workspace-side-panel :deep(.n-list),
.workspace-side-panel :deep(.n-list-item) {
  background: transparent;
  color: var(--mebius-ink-soft);
}

.workspace-side-panel :deep(.n-list-item:hover),
.workspace-side-panel :deep(.n-list-item.bg-slate-100),
.session-pane :deep(.n-list-item.bg-slate-100) {
  background:
    linear-gradient(90deg, rgb(255 159 67 / 14%), transparent 90%),
    rgb(255 255 255 / 6%) !important;
  color: var(--mebius-ink);
}

.workspace-side-panel :deep(.n-thing-main__content),
.workspace-side-panel :deep(.n-thing-header__title),
.workspace-side-panel :deep(.n-thing-main__description),
.session-pane :deep(.n-thing-main__content),
.session-pane :deep(.n-thing-header__title),
.session-pane :deep(.n-thing-main__description) {
  color: inherit;
}

.chat-scroll {
  background:
    radial-gradient(circle at 30% 0%, rgb(34 211 238 / 7%), transparent 24rem),
    radial-gradient(circle at 82% 12%, rgb(255 159 67 / 8%), transparent 28rem);
}

.chat-empty-state {
  background:
    radial-gradient(circle at 50% -20%, rgb(255 159 67 / 18%), transparent 48%),
    linear-gradient(180deg, rgb(255 255 255 / 7%) 0%, rgb(255 255 255 / 3%) 100%),
    linear-gradient(90deg, rgb(255 159 67 / 10%) 1px, transparent 1px) 0 0 / 28px 100%;
  border-color: var(--mebius-border);
  color: var(--mebius-muted);
}

.chat-empty-state__brand {
  filter: saturate(1.08);
  opacity: 0.92;
}

.chat-message {
  background:
    linear-gradient(180deg, rgb(255 255 255 / 7%), transparent 72%),
    rgb(13 20 32 / 78%) !important;
  border-color: var(--mebius-border) !important;
  box-shadow: 0 14px 36px rgb(0 0 0 / 16%);
  max-width: min(880px, 100%);
  width: fit-content;
}

.chat-message--user {
  background:
    linear-gradient(180deg, rgb(255 159 67 / 18%), transparent 80%),
    rgb(22 20 22 / 86%) !important;
  border-color: rgb(255 159 67 / 28%) !important;
  margin-left: auto;
}

.chat-message--assistant {
  border-color: rgb(34 211 238 / 22%) !important;
}

.composer-shell {
  background:
    linear-gradient(180deg, rgb(255 255 255 / 9%), transparent 80%),
    rgb(11 17 29 / 90%) !important;
  border-color: rgb(255 159 67 / 24%) !important;
  box-shadow:
    0 18px 56px rgb(0 0 0 / 28%),
    0 0 0 1px rgb(255 255 255 / 4%);
  overflow: hidden;
}

.composer-shell:focus-within {
  border-color: rgb(255 159 67 / 54%) !important;
  box-shadow:
    0 22px 70px rgb(0 0 0 / 34%),
    0 0 0 3px rgb(255 159 67 / 12%);
}

.workspace-content-resize-handle::before,
.sidebar-resize-handle::before,
.file-pane-resize-handle::before {
  background: var(--mebius-border);
}

.workspace-content-resize-handle::after,
.sidebar-resize-handle::after,
.file-pane-resize-handle::after {
  background: var(--mebius-accent);
  box-shadow: 0 0 0 3px rgb(255 159 67 / 14%);
}

.workspace-content-resize-handle:hover::before,
.workspace-content-resize-handle:focus-visible::before,
.workspace-content-resize-handle.is-active::before,
.sidebar-resize-handle:hover::before,
.sidebar-resize-handle:focus-visible::before,
.sidebar-resize-handle.is-active::before,
.file-pane-resize-handle:hover::before,
.file-pane-resize-handle:focus-visible::before,
.file-pane-resize-handle.is-active::before {
  background: var(--mebius-accent);
}

.workbench-tabs {
  background: transparent;
}

.workbench-tabs :deep(.n-tabs-nav) {
  background:
    linear-gradient(180deg, rgb(255 255 255 / 7%), transparent),
    rgb(9 15 26 / 76%);
  border-bottom-color: var(--mebius-border);
}

.workbench-tabs :deep(.n-tabs-tab.n-tabs-tab--active) {
  color: var(--mebius-accent);
}

.workbench-section,
.review-card,
.approval-card,
.run-card,
.event-item__body,
.diagnostics-card {
  background:
    linear-gradient(180deg, rgb(255 255 255 / 7%) 0%, rgb(255 255 255 / 3%) 100%),
    radial-gradient(circle at top right, rgb(255 159 67 / 12%), transparent 42%),
    var(--mebius-panel) !important;
  border-color: var(--mebius-border) !important;
  box-shadow: var(--mebius-shadow-soft);
  backdrop-filter: blur(18px);
}

.workbench-section__header,
.review-card__header,
.run-card__body,
.diagnostics-strip,
.event-item__payload,
.approval-card__payload {
  border-color: var(--mebius-border) !important;
}

.workbench-section__title,
.review-card__title,
.approval-card__title,
.run-card__command,
.event-item__type,
.diagnostics-card__title {
  color: var(--mebius-ink);
}

.workbench-section__title .n-icon,
.diagnostics-card__icon,
.event-item__dot {
  color: var(--mebius-accent);
}

.workbench-section__subtitle,
.review-card__meta,
.review-plan-summary,
.review-plan-steps__detail,
.review-plan-steps__status,
.approval-card__meta,
.run-card__meta,
.run-card__cwd,
.event-item__summary,
.diagnostics-card__summary,
.diagnostics-card__meta {
  color: var(--mebius-muted);
}

.workbench-tree-shell {
  background:
    linear-gradient(90deg, rgb(148 163 184 / 13%) 1px, transparent 1px) 18px 0 / 18px 100%,
    rgb(6 11 20 / 24%);
}

.workspace-side-panel .bg-slate-50,
.workspace-side-panel .bg-white\/70,
.connect-provider-card {
  background: rgb(255 255 255 / 5%) !important;
  color: var(--mebius-ink-soft) !important;
}

.workspace-side-panel .text-slate-800,
.workspace-side-panel .text-slate-700 {
  color: var(--mebius-ink) !important;
}

.connect-provider-card:hover,
.connect-provider-card.is-selected {
  background:
    linear-gradient(90deg, rgb(255 159 67 / 14%), transparent 90%),
    rgb(255 255 255 / 7%) !important;
  border-color: var(--mebius-accent) !important;
}

.review-plan-steps li,
.workbench-empty-state,
.command-preview,
.command-request,
.run-output,
.run-output header {
  background: rgb(255 255 255 / 4%) !important;
  border-color: var(--mebius-border) !important;
  color: var(--mebius-ink-soft);
}

.run-output pre,
.event-item__payload,
.approval-card__payload {
  background: var(--mebius-code-bg) !important;
  color: var(--mebius-ink-soft);
}

.event-item__rail::after {
  background: var(--mebius-border);
}

:global(:root[data-theme="light"]) .workspace-root::before {
  background:
    linear-gradient(90deg, rgb(15 118 110 / 8%) 1px, transparent 1px),
    linear-gradient(0deg, rgb(15 118 110 / 6%) 1px, transparent 1px);
}

:global(:root[data-theme="light"]) .workspace-side-panel,
:global(:root[data-theme="light"]) .workspace-topbar,
:global(:root[data-theme="light"]) .session-pane,
:global(:root[data-theme="light"]) .composer-footer,
:global(:root[data-theme="light"]) .workbench-section,
:global(:root[data-theme="light"]) .review-card,
:global(:root[data-theme="light"]) .approval-card,
:global(:root[data-theme="light"]) .run-card,
:global(:root[data-theme="light"]) .event-item__body,
:global(:root[data-theme="light"]) .diagnostics-card,
:global(:root[data-theme="light"]) .composer-shell,
:global(:root[data-theme="light"]) .chat-message {
  background: var(--mebius-panel) !important;
}

:global(:root[data-theme="light"]) .workspace-main {
  background:
    radial-gradient(circle at 55% -10%, rgb(15 118 110 / 9%), transparent 30rem),
    rgb(255 255 255 / 38%);
}

:global(:root[data-theme="light"]) .workbench-tabs :deep(.n-tabs-nav) {
  background: rgb(255 255 255 / 82%);
}

:global(:root[data-theme="light"]) .chat-message--user {
  background:
    linear-gradient(180deg, rgb(15 118 110 / 8%), transparent 80%),
    #ffffff !important;
  border-color: rgb(15 118 110 / 24%) !important;
}

:global(:root[data-theme="light"]) .workbench-tree-shell {
  background:
    linear-gradient(90deg, rgb(15 118 110 / 8%) 1px, transparent 1px) 18px 0 / 18px 100%,
    rgb(255 255 255 / 56%);
}

:global(:root[data-theme="light"]) .workspace-side-panel .bg-slate-50,
:global(:root[data-theme="light"]) .workspace-side-panel .bg-white\/70,
:global(:root[data-theme="light"]) .connect-provider-card {
  background: #ffffff !important;
  color: var(--mebius-ink-soft) !important;
}

/* Production workspace theme correction.
   This is the final layer for shell contrast, so light and dark stay readable. */
.workspace-root {
  background: var(--workspace-canvas) !important;
  color: var(--workspace-message-text);
}

.workspace-root::before {
  background:
    linear-gradient(90deg, rgb(255 255 255 / 5%) 1px, transparent 1px),
    linear-gradient(0deg, rgb(255 255 255 / 4%) 1px, transparent 1px);
  opacity: 0.16;
}

:global(:root[data-theme="light"]) .workspace-root::before {
  background:
    linear-gradient(90deg, rgb(15 118 110 / 4%) 1px, transparent 1px),
    linear-gradient(0deg, rgb(15 118 110 / 3%) 1px, transparent 1px);
  opacity: 0.16;
}

.workspace-main {
  background:
    radial-gradient(circle at 45% -12%, color-mix(in srgb, var(--mebius-accent) 12%, transparent), transparent 30rem),
    var(--workspace-canvas) !important;
}

.chat-scroll {
  background:
    radial-gradient(circle at 28% 0%, color-mix(in srgb, var(--mebius-cyan) 8%, transparent), transparent 24rem),
    radial-gradient(circle at 82% 12%, color-mix(in srgb, var(--mebius-accent) 8%, transparent), transparent 28rem),
    var(--workspace-canvas) !important;
}

:global(:root[data-theme="light"]) .workspace-main,
:global(:root[data-theme="light"]) .chat-scroll {
  background:
    radial-gradient(circle at 36% -10%, rgb(15 118 110 / 4%), transparent 30rem),
    radial-gradient(circle at 88% 6%, rgb(255 159 67 / 3%), transparent 28rem),
    var(--workspace-canvas) !important;
}

.workspace-side-panel,
.workspace-topbar,
.session-pane,
.composer-footer,
.workbench-tabs :deep(.n-tabs-nav),
.workbench-section,
.review-card,
.approval-card,
.run-card,
.event-item__body,
.diagnostics-card {
  background: var(--workspace-panel-bg) !important;
  border-color: var(--workspace-card-border) !important;
  color: var(--workspace-message-text);
  box-shadow: 0 1px 0 var(--workspace-card-border);
  backdrop-filter: none;
}

:global(:root[data-theme="light"]) .workspace-side-panel,
:global(:root[data-theme="light"]) .workspace-topbar,
:global(:root[data-theme="light"]) .session-pane,
:global(:root[data-theme="light"]) .composer-footer,
:global(:root[data-theme="light"]) .workbench-tabs :deep(.n-tabs-nav),
:global(:root[data-theme="light"]) .workbench-section,
:global(:root[data-theme="light"]) .review-card,
:global(:root[data-theme="light"]) .approval-card,
:global(:root[data-theme="light"]) .run-card,
:global(:root[data-theme="light"]) .event-item__body,
:global(:root[data-theme="light"]) .diagnostics-card {
  box-shadow: var(--workspace-panel-shadow);
}

.left-sidebar-card,
.session-pane,
.workspace-side-panel :deep(.n-list),
.workspace-side-panel :deep(.n-list-item),
.session-pane :deep(.n-list),
.session-pane :deep(.n-list-item) {
  background: transparent;
  color: var(--workspace-message-text);
}

.workspace-side-panel :deep(.n-thing-main__content),
.workspace-side-panel :deep(.n-thing-header__title),
.session-pane :deep(.n-thing-main__content),
.session-pane :deep(.n-thing-header__title) {
  color: inherit;
}

.left-sidebar-disclosure {
  background: transparent;
  color: var(--workspace-message-text);
}

.left-sidebar-disclosure:hover,
.left-sidebar-disclosure:focus-visible,
.workspace-side-panel :deep(.n-list-item:hover),
.workspace-side-panel :deep(.n-list-item.bg-slate-100),
.session-pane :deep(.n-list-item:hover),
.session-pane :deep(.n-list-item.bg-slate-100) {
  background: var(--workspace-hover-bg) !important;
  color: var(--workspace-message-text);
}

.workspace-side-panel :deep(.n-list-item.bg-slate-100),
.session-pane :deep(.n-list-item.bg-slate-100) {
  background: var(--workspace-selected-bg) !important;
  box-shadow: inset 3px 0 0 var(--mebius-accent);
}

.left-sidebar-disclosure__chevron,
.workbench-tabs :deep(.n-tabs-tab),
.chat-message .text-mebius-muted {
  color: var(--workspace-message-muted) !important;
}

.workbench-tabs {
  background: transparent !important;
}

.workbench-tabs :deep(.n-tabs-nav) {
  background: var(--workspace-tab-bg) !important;
  box-shadow: 0 1px 0 var(--workspace-card-border);
}

.workbench-tabs :deep(.n-tabs-tab__label) {
  color: inherit;
}

.workbench-tabs :deep(.n-tabs-tab.n-tabs-tab--active) {
  color: var(--mebius-accent) !important;
}

.workbench-tabs :deep(.n-tabs-bar) {
  background-color: var(--mebius-accent);
}

.chat-empty-state,
.workbench-empty-state,
.command-preview,
.command-request,
.review-plan-steps li,
.run-output,
.run-output header,
.workbench-tree-shell {
  background: var(--workspace-card-subtle) !important;
  border-color: var(--workspace-card-border) !important;
  color: var(--workspace-message-text);
}

.chat-empty-state {
  background:
    radial-gradient(circle at 50% -24%, color-mix(in srgb, var(--mebius-accent) 14%, transparent), transparent 50%),
    var(--workspace-card-subtle) !important;
}

.chat-message {
  background: var(--workspace-card-bg) !important;
  border: 1px solid var(--workspace-card-border) !important;
  border-left: 4px solid var(--mebius-accent) !important;
  color: var(--workspace-message-text);
  margin-left: 0;
  max-width: min(900px, 100%);
  overflow: hidden;
  position: relative;
  width: fit-content;
}

:global(:root[data-theme="dark"]) .chat-message {
  box-shadow: 0 14px 36px rgb(0 0 0 / 18%);
}

:global(:root[data-theme="light"]) .chat-message {
  box-shadow: 0 10px 24px rgb(35 54 74 / 9%);
}

.chat-message--user {
  background: var(--workspace-message-user-bg) !important;
  border-color: color-mix(in srgb, var(--mebius-accent) 42%, var(--workspace-card-border)) !important;
  border-left-color: var(--mebius-accent) !important;
  margin-left: auto;
}

.chat-activity {
  max-width: min(900px, 100%);
}

.chat-thread .chat-empty-state {
  align-self: center;
  max-width: min(900px, 100%);
  width: 100%;
}

.chat-thread .chat-message {
  align-self: flex-start;
  margin: 0;
}

.chat-thread .chat-message--user {
  align-self: flex-end;
  margin-left: 0;
}

.chat-thread .chat-activity {
  align-self: flex-start;
  margin: 0;
  width: min(900px, 100%);
}

.chat-message--assistant {
  background: var(--workspace-message-assistant-bg) !important;
  border-left-color: color-mix(in srgb, var(--mebius-accent) 58%, var(--workspace-card-border)) !important;
}

.chat-message--tool,
.chat-message--system {
  background: var(--workspace-message-tool-bg) !important;
  border-left-color: var(--workspace-message-muted) !important;
}

.composer-shell {
  background: var(--workspace-input-bg) !important;
  border-color: var(--workspace-card-border) !important;
  margin: 0 auto;
  max-width: 1120px;
  width: 100%;
  box-shadow: 0 8px 22px rgb(15 23 42 / 6%);
}

.composer-shell:focus-within {
  border-color: color-mix(in srgb, var(--mebius-accent) 58%, var(--workspace-card-border)) !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--mebius-accent) 16%, transparent);
}

.composer-shell :deep(.n-input),
.composer-shell :deep(.n-input-wrapper),
.composer-shell :deep(.n-input__textarea-el),
.composer-shell :deep(.n-input__input-el) {
  background: transparent !important;
  color: var(--workspace-message-text) !important;
}

.composer-shell :deep(.n-input__placeholder) {
  color: var(--workspace-placeholder-text) !important;
}

.workspace-root :deep(.n-button:not(.n-button--primary-type)) {
  color: var(--workspace-message-text) !important;
}

.workspace-root :deep(.n-button--primary-type) {
  color: #ffffff !important;
}

.workspace-root :deep(.n-input),
.workspace-root :deep(.n-base-selection),
.workspace-root :deep(.n-dropdown-menu),
.workspace-root :deep(.n-popover) {
  color: var(--workspace-message-text) !important;
}

.workspace-root :deep(.n-input__input-el),
.workspace-root :deep(.n-input__textarea-el),
.workspace-root :deep(.n-base-selection-label),
.workspace-root :deep(.n-base-selection-input),
.workspace-root :deep(.n-base-selection-input__content),
.workspace-root :deep(.n-thing-header__title),
.workspace-root :deep(.n-thing-main__content),
.workspace-root :deep(.n-thing-main__description),
.workspace-root :deep(.n-button__content),
.workspace-root :deep(.n-tabs-tab__label),
.workspace-root :deep(.mebius-brand__name) {
  color: var(--workspace-message-text) !important;
}

.workspace-root :deep(.n-input__placeholder),
.workspace-root :deep(.n-base-selection-placeholder),
.workspace-root :deep(.n-base-selection__placeholder),
.workspace-root :deep(.mebius-brand__subtitle) {
  color: var(--workspace-placeholder-text) !important;
}

.workspace-root :deep(.n-button .n-icon),
.workspace-root :deep(.n-base-icon),
.workspace-root :deep(.n-input__suffix),
.workspace-root :deep(.n-base-selection-suffix),
.workspace-root :deep(.n-tabs-tab .n-icon) {
  color: var(--workspace-icon-muted) !important;
}

.workspace-root :deep(.n-button:hover .n-icon),
.workspace-root :deep(.n-button:focus-visible .n-icon),
.workspace-root :deep(.n-tabs-tab.n-tabs-tab--active .n-icon) {
  color: var(--mebius-accent) !important;
}

.workspace-root :deep(.n-button--primary-type .n-button__content),
.workspace-root :deep(.n-button--primary-type .n-icon) {
  color: #ffffff !important;
}

.workspace-content-resize-handle::before,
.sidebar-resize-handle::before,
.file-pane-resize-handle::before,
.event-item__rail::after {
  background: var(--workspace-card-border);
}

.workspace-content-resize-handle::after,
.sidebar-resize-handle::after,
.file-pane-resize-handle::after {
  background: var(--mebius-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--mebius-accent) 16%, transparent);
}

.workbench-section__title,
.review-card__title,
.approval-card__title,
.run-card__command,
.event-item__type,
.diagnostics-card__title {
  color: var(--workspace-message-text);
}

.workbench-section__title .n-icon,
.diagnostics-card__icon,
.event-item__dot {
  color: var(--mebius-accent);
}

.workbench-section__subtitle,
.review-card__meta,
.review-plan-summary,
.review-plan-steps__detail,
.review-plan-steps__status,
.approval-card__meta,
.run-card__meta,
.run-card__cwd,
.event-item__summary,
.diagnostics-card__summary,
.diagnostics-card__meta {
  color: var(--workspace-message-muted) !important;
}

.event-item__payload,
.approval-card__payload,
.run-output pre {
  background: var(--mebius-code-bg) !important;
  color: var(--workspace-message-text);
}

.workspace-side-panel .bg-slate-50,
.workspace-side-panel .bg-white\/70,
.connect-provider-card {
  background: var(--workspace-card-subtle) !important;
  border-color: var(--workspace-card-border) !important;
  color: var(--workspace-message-text) !important;
}

.workspace-side-panel .text-slate-800,
.workspace-side-panel .text-slate-700,
.workspace-side-panel .text-slate-600,
.workspace-side-panel .text-slate-500,
.workspace-main .text-slate-800,
.workspace-main .text-slate-700,
.workspace-main .text-slate-600,
.workspace-main .text-slate-500 {
  color: var(--workspace-message-text) !important;
}

.workspace-side-panel .text-mebius-muted,
.workspace-main .text-mebius-muted {
  color: var(--workspace-message-muted) !important;
}

:global(:root[data-theme="light"]) .workspace-root :where(strong, h1, h2, h3, h4, h5, h6),
:global(:root[data-theme="light"]) .workspace-root :deep(strong),
:global(:root[data-theme="light"]) .workspace-root :deep(h1),
:global(:root[data-theme="light"]) .workspace-root :deep(h2),
:global(:root[data-theme="light"]) .workspace-root :deep(h3),
:global(:root[data-theme="light"]) .workspace-root :deep(h4) {
  color: var(--workspace-message-text) !important;
}

:global(:root[data-theme="light"]) .workspace-root .text-mebius-muted,
:global(:root[data-theme="light"]) .workspace-root :deep(.text-mebius-muted),
:global(:root[data-theme="light"]) .workspace-root :deep(.text-slate-400),
:global(:root[data-theme="light"]) .workspace-root :deep(.text-slate-500),
:global(:root[data-theme="light"]) .workspace-root :deep(.text-slate-600) {
  color: var(--workspace-message-muted) !important;
}

:global(:root[data-theme="light"]) .workspace-side-panel,
:global(:root[data-theme="light"]) .workspace-topbar,
:global(:root[data-theme="light"]) .session-pane,
:global(:root[data-theme="light"]) .composer-footer,
:global(:root[data-theme="light"]) .workbench-section,
:global(:root[data-theme="light"]) .review-card,
:global(:root[data-theme="light"]) .approval-card,
:global(:root[data-theme="light"]) .run-card,
:global(:root[data-theme="light"]) .event-item__body,
:global(:root[data-theme="light"]) .diagnostics-card,
:global(:root[data-theme="light"]) .chat-message,
:global(:root[data-theme="light"]) .composer-shell {
  background: #ffffff !important;
  border-color: var(--workspace-card-border) !important;
}

:global(:root[data-theme="light"]) .workspace-side-panel :deep(.n-list-item:hover),
:global(:root[data-theme="light"]) .workspace-side-panel :deep(.n-list-item.bg-slate-100),
:global(:root[data-theme="light"]) .session-pane :deep(.n-list-item:hover),
:global(:root[data-theme="light"]) .session-pane :deep(.n-list-item.bg-slate-100),
:global(:root[data-theme="light"]) .left-sidebar-disclosure:hover,
:global(:root[data-theme="light"]) .left-sidebar-disclosure:focus-visible {
  background: var(--workspace-hover-bg) !important;
  color: var(--workspace-message-text) !important;
}

:global(:root[data-theme="light"]) .workspace-side-panel :deep(.n-list-item.bg-slate-100),
:global(:root[data-theme="light"]) .session-pane :deep(.n-list-item.bg-slate-100) {
  background: var(--workspace-selected-bg) !important;
  box-shadow: inset 3px 0 0 var(--mebius-accent);
}

:global(:root[data-theme="light"]) .chat-message--user {
  background: var(--workspace-message-user-bg) !important;
}

:global(:root[data-theme="light"]) .chat-message--assistant {
  background: var(--workspace-message-assistant-bg) !important;
}

:global(:root[data-theme="light"]) .chat-message--tool,
:global(:root[data-theme="light"]) .chat-message--system {
  background: var(--workspace-message-tool-bg) !important;
}

:global(:root[data-theme="light"]) .chat-empty-state,
:global(:root[data-theme="light"]) .workbench-empty-state,
:global(:root[data-theme="light"]) .command-preview,
:global(:root[data-theme="light"]) .command-request,
:global(:root[data-theme="light"]) .review-plan-steps li,
:global(:root[data-theme="light"]) .run-output,
:global(:root[data-theme="light"]) .run-output header,
:global(:root[data-theme="light"]) .workbench-tree-shell {
  background: var(--workspace-card-subtle) !important;
  border-color: var(--workspace-card-border) !important;
  color: var(--workspace-message-text) !important;
}

.connect-provider-card:hover,
.connect-provider-card.is-selected {
  background: color-mix(in srgb, var(--mebius-accent) 10%, var(--workspace-card-bg)) !important;
  border-color: var(--mebius-accent) !important;
}

/* Light theme readability clamp. Keep this as the final workspace layer. */
:global(:root[data-theme="light"]) .workspace-root {
  background: #f8fafc !important;
  color: #111827 !important;
}

:global(:root[data-theme="light"]) .workspace-main,
:global(:root[data-theme="light"]) .chat-scroll {
  background:
    radial-gradient(circle at 36% -10%, rgb(15 118 110 / 4%), transparent 30rem),
    radial-gradient(circle at 88% 6%, rgb(255 159 67 / 3%), transparent 28rem),
    #f8fafc !important;
  color: #111827 !important;
}

:global(:root[data-theme="light"]) .workspace-side-panel,
:global(:root[data-theme="light"]) .workspace-topbar,
:global(:root[data-theme="light"]) .session-pane,
:global(:root[data-theme="light"]) .composer-footer,
:global(:root[data-theme="light"]) .workbench-tabs :deep(.n-tabs-nav),
:global(:root[data-theme="light"]) .workbench-section,
:global(:root[data-theme="light"]) .review-card,
:global(:root[data-theme="light"]) .approval-card,
:global(:root[data-theme="light"]) .run-card,
:global(:root[data-theme="light"]) .event-item__body,
:global(:root[data-theme="light"]) .diagnostics-card,
:global(:root[data-theme="light"]) .chat-message,
:global(:root[data-theme="light"]) .composer-shell {
  background: #ffffff !important;
  border-color: #d1d5db !important;
  color: #111827 !important;
  opacity: 1;
}

:global(:root[data-theme="light"]) .workspace-root :where(h1, h2, h3, h4, h5, h6, strong),
:global(:root[data-theme="light"]) .workspace-root :deep(.n-thing-header__title),
:global(:root[data-theme="light"]) .workspace-root :deep(.n-button__content),
:global(:root[data-theme="light"]) .workspace-root :deep(.n-tabs-tab__label),
:global(:root[data-theme="light"]) .workspace-root :deep(.mebius-brand__name) {
  color: #111827 !important;
}

:global(:root[data-theme="light"]) .workspace-root :deep(.n-thing-main__content),
:global(:root[data-theme="light"]) .workspace-root :deep(.n-thing-main__description),
:global(:root[data-theme="light"]) .workspace-root :deep(.mebius-brand__subtitle),
:global(:root[data-theme="light"]) .workbench-section__subtitle,
:global(:root[data-theme="light"]) .review-card__meta,
:global(:root[data-theme="light"]) .review-plan-summary,
:global(:root[data-theme="light"]) .review-plan-steps__detail,
:global(:root[data-theme="light"]) .review-plan-steps__status,
:global(:root[data-theme="light"]) .approval-card__meta,
:global(:root[data-theme="light"]) .run-card__meta,
:global(:root[data-theme="light"]) .run-card__cwd,
:global(:root[data-theme="light"]) .event-item__summary,
:global(:root[data-theme="light"]) .diagnostics-card__summary,
:global(:root[data-theme="light"]) .diagnostics-card__meta {
  color: #4b5563 !important;
}

:global(:root[data-theme="light"]) .workspace-root .text-mebius-muted,
:global(:root[data-theme="light"]) .workspace-root :deep(.text-mebius-muted),
:global(:root[data-theme="light"]) .workspace-root :deep(.n-input__placeholder),
:global(:root[data-theme="light"]) .workspace-root :deep(.n-base-selection-placeholder),
:global(:root[data-theme="light"]) .workspace-root :deep(.n-base-selection__placeholder),
:global(:root[data-theme="light"]) .workspace-root :deep(.text-slate-400),
:global(:root[data-theme="light"]) .workspace-root :deep(.text-slate-500) {
  color: #6b7280 !important;
}

:global(:root[data-theme="light"]) .workspace-root .text-slate-600,
:global(:root[data-theme="light"]) .workspace-root :deep(.text-slate-600),
:global(:root[data-theme="light"]) .workspace-root .text-slate-700,
:global(:root[data-theme="light"]) .workspace-root :deep(.text-slate-700) {
  color: #4b5563 !important;
}

:global(:root[data-theme="light"]) .workspace-root .text-slate-800,
:global(:root[data-theme="light"]) .workspace-root :deep(.text-slate-800),
:global(:root[data-theme="light"]) .workspace-root :deep(.text-slate-900),
:global(:root[data-theme="light"]) .workspace-root :deep(.text-slate-950) {
  color: #111827 !important;
}

:global(:root[data-theme="light"]) .workspace-side-panel :deep(.n-list),
:global(:root[data-theme="light"]) .workspace-side-panel :deep(.n-list-item),
:global(:root[data-theme="light"]) .session-pane :deep(.n-list),
:global(:root[data-theme="light"]) .session-pane :deep(.n-list-item) {
  background: transparent !important;
  color: #111827 !important;
}

:global(:root[data-theme="light"]) .workspace-side-panel :deep(.n-list-item:hover),
:global(:root[data-theme="light"]) .workspace-side-panel :deep(.n-list-item.bg-slate-100),
:global(:root[data-theme="light"]) .session-pane :deep(.n-list-item:hover),
:global(:root[data-theme="light"]) .session-pane :deep(.n-list-item.bg-slate-100),
:global(:root[data-theme="light"]) .left-sidebar-disclosure:hover,
:global(:root[data-theme="light"]) .left-sidebar-disclosure:focus-visible {
  background: #e5f3f1 !important;
  color: #111827 !important;
}

:global(:root[data-theme="light"]) .workspace-side-panel :deep(.n-list-item.bg-slate-100),
:global(:root[data-theme="light"]) .session-pane :deep(.n-list-item.bg-slate-100) {
  background: #d2eae5 !important;
}

:global(:root[data-theme="light"]) .workspace-root :deep(.n-input),
:global(:root[data-theme="light"]) .workspace-root :deep(.n-input-wrapper),
:global(:root[data-theme="light"]) .workspace-root :deep(.n-input__input-el),
:global(:root[data-theme="light"]) .workspace-root :deep(.n-input__textarea-el),
:global(:root[data-theme="light"]) .workspace-root :deep(.n-base-selection),
:global(:root[data-theme="light"]) .workspace-root :deep(.n-base-selection-label),
:global(:root[data-theme="light"]) .workspace-root :deep(.n-base-selection-input),
:global(:root[data-theme="light"]) .workspace-root :deep(.n-base-selection-input__content) {
  background: #ffffff !important;
  color: #111827 !important;
}

:global(:root[data-theme="light"]) .workspace-root :deep(.n-input.n-input--disabled),
:global(:root[data-theme="light"]) .workspace-root :deep(.n-base-selection.n-base-selection--disabled),
:global(:root[data-theme="light"]) .workspace-root :deep(.n-button[disabled]) {
  opacity: 0.72 !important;
}

:global(:root[data-theme="light"]) .workspace-root :deep(.n-button:not(.n-button--primary-type)) {
  color: #111827 !important;
}

:global(:root[data-theme="light"]) .workspace-root :deep(.n-button .n-icon),
:global(:root[data-theme="light"]) .workspace-root :deep(.n-base-icon),
:global(:root[data-theme="light"]) .workspace-root :deep(.n-input__suffix),
:global(:root[data-theme="light"]) .workspace-root :deep(.n-base-selection-suffix),
:global(:root[data-theme="light"]) .workspace-root :deep(.n-tabs-tab .n-icon) {
  color: #6b7280 !important;
}

:global(:root[data-theme="light"]) .chat-empty-state,
:global(:root[data-theme="light"]) .workbench-empty-state,
:global(:root[data-theme="light"]) .command-preview,
:global(:root[data-theme="light"]) .command-request,
:global(:root[data-theme="light"]) .review-plan-steps li,
:global(:root[data-theme="light"]) .run-output,
:global(:root[data-theme="light"]) .run-output header,
:global(:root[data-theme="light"]) .workbench-tree-shell,
:global(:root[data-theme="light"]) .workspace-side-panel .bg-slate-50,
:global(:root[data-theme="light"]) .workspace-side-panel .bg-white\/70,
:global(:root[data-theme="light"]) .connect-provider-card {
  background: #f9fafb !important;
  border-color: #d1d5db !important;
  color: #111827 !important;
}

:global(:root[data-theme="light"]) .event-item__payload,
:global(:root[data-theme="light"]) .approval-card__payload,
:global(:root[data-theme="light"]) .run-output pre,
:global(:root[data-theme="light"]) .workspace-root :deep(.markdown-body pre),
:global(:root[data-theme="light"]) .workspace-root :deep(.markdown-body code) {
  background: #f3f4f6 !important;
  border-color: #d1d5db !important;
  color: #111827 !important;
}

:global(:root[data-theme="light"]) .workspace-root :deep(.code-preview),
:global(:root[data-theme="light"]) .workspace-root :deep(.code-editor),
:global(:root[data-theme="light"]) .workspace-root :deep(.diff-preview) {
  background: #ffffff !important;
  border-color: #d1d5db !important;
  color: #111827 !important;
}

:global(:root[data-theme="light"]) .workspace-root :deep(.code-preview__header),
:global(:root[data-theme="light"]) .workspace-root :deep(.code-editor__header),
:global(:root[data-theme="light"]) .workspace-root :deep(.diff-preview__header) {
  background: #f9fafb !important;
  border-color: #d1d5db !important;
  color: #111827 !important;
}

:global(:root[data-theme="light"]) .workspace-root :deep(.code-preview__chip),
:global(:root[data-theme="light"]) .workspace-root :deep(.code-editor__chip) {
  background: #f3f4f6 !important;
  border-color: #d1d5db !important;
  color: #4b5563 !important;
}

:global(:root[data-theme="light"]) .workspace-root :deep(.code-preview__scroller),
:global(:root[data-theme="light"]) .workspace-root :deep(.code-preview__scroller .shiki),
:global(:root[data-theme="light"]) .workspace-root :deep(.cm-editor),
:global(:root[data-theme="light"]) .workspace-root :deep(.cm-scroller) {
  background: #ffffff !important;
  color: #111827 !important;
}
</style>
