/** @jsxImportSource @opentui/solid */
import { SyntaxStyle, type TextareaAction, type TextareaRenderable } from '@opentui/core';
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/solid';
import { For, Show, createContext, createEffect, createMemo, createSignal, onCleanup, onMount, useContext } from 'solid-js';
import type { Accessor, JSX } from 'solid-js';
import { attachEventStream, refreshReviewData, type WorkspaceState } from '../bootstrap';
import { saveConfig } from '../config';
import type { Approval, ApprovalPreview, Message, ModelChoice, ModelsCommandResult, Session, TuiThemeName } from '../types';
import { getTuiTheme, resolveTuiThemeName, tuiThemeList, type TuiTheme } from './theme';

const ThemeContext = createContext<Accessor<TuiTheme>>();

function useTheme(): Accessor<TuiTheme> {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('Theme context is not available.');
  return theme;
}

function createMessageMarkdownStyle(theme: TuiTheme): SyntaxStyle {
  const style = SyntaxStyle.create();
  style.registerStyle('default', { fg: theme.text });
  style.registerStyle('markup.heading', { fg: theme.blue, bold: true });
  style.registerStyle('markup.strong', { fg: theme.text, bold: true });
  style.registerStyle('markup.italic', { fg: theme.text, italic: true });
  style.registerStyle('markup.raw', { fg: theme.green });
  style.registerStyle('markup.link', { fg: theme.blue, underline: true });
  style.registerStyle('markup.link.label', { fg: theme.blue, underline: true });
  style.registerStyle('markup.link.url', { fg: theme.purple, underline: true });
  style.registerStyle('markup.quote', { fg: theme.muted, dim: true });
  style.registerStyle('markup.list', { fg: theme.yellow });
  style.registerStyle('conceal', { fg: theme.muted, dim: true });
  return style;
}

function createMarkdownTableOptions(theme: TuiTheme) {
  return {
    style: 'grid',
    widthMode: 'full',
    wrapMode: 'word',
    cellPaddingX: 1,
    borderColor: theme.border,
  } as const;
}

interface AppProps {
  initialState: WorkspaceState;
}

interface ModelPaletteState {
  step: 'list' | 'apiKey';
  choices: ModelChoice[];
  selectedIndex: number;
  query: string;
  apiKey: string;
  pendingChoice?: ModelChoice;
  error?: string;
}

type ComposerMode = 'build' | 'plan';

interface ActiveModelInfo {
  modelName: string;
  providerDisplay: string;
}

interface CommandPaletteState {
  selectedIndex: number;
  query: string;
}

export type SlashCommandContext = {
  openModelSelectModal: () => Promise<void>;
  openSessionPalette: () => Promise<void>;
  openThemePalette: () => void;
  runCommand: (value: string) => Promise<void>;
  exitTui: () => void;
};

export type SlashCommand = {
  id: string;
  name: string;
  description: string;
  aliases?: string[];
  kind: 'immediate' | 'input';
  run?: (ctx: SlashCommandContext) => void | Promise<void>;
};

interface ThemePaletteState {
  selectedIndex: number;
}

interface SessionPaletteState {
  sessions: Session[];
  selectedIndex: number;
  query: string;
  loading: boolean;
  error?: string;
}

interface CommandPaletteCommand {
  label: string;
  description: string;
  insert?: string;
  action?: 'models' | 'sessions';
}

interface ModelChoiceGroupRow {
  choice: ModelChoice;
  index: number;
}

interface ModelChoiceGroup {
  title: string;
  rows: ModelChoiceGroupRow[];
}

interface SessionGroupRow {
  session: Session;
  index: number;
}

interface SessionGroup {
  title: string;
  rows: SessionGroupRow[];
}

const commandPaletteCommands: CommandPaletteCommand[] = [
  { label: 'Select model', insert: '/models', action: 'models', description: 'Choose or configure the active model' },
  { label: '/sessions', action: 'sessions', description: 'Switch to a previous session' },
  { label: '/new <title>', insert: '/new ', description: 'Create and switch to a new session' },
  { label: '/clear', insert: '/clear', description: 'Clear the chat and model context' },
  { label: '/compact', insert: '/compact', description: 'Compact the chat into model context' },
  { label: '/themes', insert: '/themes', description: 'Switch the TUI theme' },
  { label: '/plan <goal>', insert: '/plan ', description: 'Create a plan for a goal' },
  { label: '/plan-approve', insert: '/plan-approve', description: 'Approve the latest plan' },
  { label: '/approve', insert: '/approve', description: 'Approve the active tool request' },
  { label: '/reject', insert: '/reject', description: 'Reject the active tool request' },
  { label: '/run <command>', insert: '/run ', description: 'Request a shell command run' },
  { label: '/open <path>', insert: '/open ', description: 'Open a project file' },
  { label: '/exit', insert: '/exit', description: 'Exit the TUI' },
  { label: '/quit', insert: '/quit', description: 'Exit the TUI' },
];

const slashCommands: SlashCommand[] = [
  {
    id: 'models',
    name: '/models',
    description: 'Choose or configure the active model',
    kind: 'immediate',
    run: (ctx) => ctx.openModelSelectModal(),
  },
  {
    id: 'sessions',
    name: '/sessions',
    description: 'Switch to a previous session',
    kind: 'immediate',
    run: (ctx) => ctx.openSessionPalette(),
  },
  { id: 'new', name: '/new', description: 'Create and switch to a new session', kind: 'input' },
  {
    id: 'clear',
    name: '/clear',
    description: 'Clear the chat and model context',
    kind: 'immediate',
    run: (ctx) => ctx.runCommand('/clear'),
  },
  {
    id: 'compact',
    name: '/compact',
    description: 'Compact the chat into model context',
    kind: 'immediate',
    run: (ctx) => ctx.runCommand('/compact'),
  },
  {
    id: 'themes',
    name: '/themes',
    description: 'Switch the TUI theme',
    kind: 'immediate',
    run: (ctx) => ctx.openThemePalette(),
  },
  { id: 'plan', name: '/plan', description: 'Create a plan for a goal', kind: 'input' },
  {
    id: 'plan-approve',
    name: '/plan-approve',
    description: 'Approve the latest plan',
    kind: 'immediate',
    run: (ctx) => ctx.runCommand('/plan-approve'),
  },
  {
    id: 'approve',
    name: '/approve',
    description: 'Approve the active tool request',
    kind: 'immediate',
    run: (ctx) => ctx.runCommand('/approve'),
  },
  {
    id: 'reject',
    name: '/reject',
    description: 'Reject the active tool request',
    kind: 'immediate',
    run: (ctx) => ctx.runCommand('/reject'),
  },
  { id: 'run', name: '/run', description: 'Request a shell command run', kind: 'input' },
  { id: 'open', name: '/open', description: 'Open a project file', kind: 'input' },
  { id: 'exit', name: '/exit', description: 'Exit the TUI', kind: 'immediate', run: (ctx) => ctx.exitTui() },
  { id: 'quit', name: '/quit', description: 'Exit the TUI', kind: 'immediate', run: (ctx) => ctx.exitTui() },
];

const RIGHT_RAIL_WIDTH = 32;
const MAIN_COLUMN_MIN_WIDTH = 48;
const COMPOSER_HEIGHT = 6;
const composerSubmitKeyBindings: Array<{ name: string; action: TextareaAction }> = [
  { name: 'return', action: 'submit' },
  { name: 'kpenter', action: 'submit' },
  { name: 'linefeed', action: 'submit' },
];
const HIGH_LEVEL_EVENT_TYPES = new Set([
  'agent_status',
  'message_created',
  'model_call_started',
  'model_call_completed',
  'model_call_failed',
  'error',
  'done',
]);
const RUNNING_AGENT_STATUSES = new Set(['thinking', 'responding', 'using_tools', 'waiting_for_approval', 'working']);
const COMPLETED_AGENT_STATUSES = new Set(['completed']);
const ERROR_AGENT_STATUSES = new Set(['failed', 'error']);
const MIN_SESSION_TITLE_LENGTH = 2;
const MAX_SESSION_TITLE_LENGTH = 120;
const SESSION_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SESSION_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type TaskStatus = 'idle' | 'running' | 'completed' | 'error';
type StatusEvent = WorkspaceState['events'][number];

export function App(props: AppProps) {
  const [state, setState] = createSignal(props.initialState);
  const [input, setInput] = createSignal('');
  const [composerCursorOffset, setComposerCursorOffset] = createSignal(0);
  const [composerMode, setComposerMode] = createSignal<ComposerMode>('build');
  const [themeName, setThemeName] = createSignal<TuiThemeName>(
    resolveTuiThemeName(props.initialState.config.preferences?.theme),
  );
  const [busy, setBusy] = createSignal(false);
  const [modelPalette, setModelPalette] = createSignal<ModelPaletteState | null>(null);
  const [commandPalette, setCommandPalette] = createSignal<CommandPaletteState | null>(null);
  const [slashSelectedIndex, setSlashSelectedIndex] = createSignal(0);
  const [dismissedSlashQuery, setDismissedSlashQuery] = createSignal<string | null>(null);
  const [lastSlashQuery, setLastSlashQuery] = createSignal<string | null>(null);
  const [themePalette, setThemePalette] = createSignal<ThemePaletteState | null>(null);
  const [sessionPalette, setSessionPalette] = createSignal<SessionPaletteState | null>(null);
  const [recentModelKeys, setRecentModelKeys] = createSignal<string[]>(initialRecentModelKeys(props.initialState.modelChoices));
  const renderer = useRenderer();
  let eventStreamAbort: AbortController | null = null;

  onMount(() => {
    startEventStream();
  });

  onCleanup(() => stopEventStream());

  const activeApproval = createMemo(() => state().approvals[0]);
  const activeModelInfo = createMemo(() => getActiveModelInfo(state()));
  const theme = createMemo(() => getTuiTheme(themeName()));
  const composerAccentColor = createMemo(() => composerModeAccent(composerMode(), theme()));
  const rightTitle = createMemo(() => {
    const approval = activeApproval();
    if (approval) return `Approval - ${approval.toolCall.name}`;
    return 'Status';
  });
  const slashQuery = createMemo(() => {
    if (modelPalette() || commandPalette() || themePalette() || sessionPalette()) return null;
    return getSlashQuery(input(), composerCursorOffset());
  });
  const filteredSlashSuggestions = createMemo(() => {
    const query = slashQuery();
    return query === null ? [] : filteredSlashCommandSuggestions(query);
  });
  const slashAutocompleteVisible = createMemo(() => {
    const query = slashQuery();
    return query !== null && dismissedSlashQuery() !== query;
  });

  createEffect(() => {
    const query = slashQuery();
    if (query !== lastSlashQuery()) {
      setLastSlashQuery(query);
      setSlashSelectedIndex(0);
    }
    const dismissed = dismissedSlashQuery();
    if (query === null) {
      if (dismissed !== null) setDismissedSlashQuery(null);
      return;
    }
    if (dismissed !== null && dismissed !== query) {
      setDismissedSlashQuery(null);
    }
  });

  createEffect(() => {
    const query = slashQuery();
    const count = filteredSlashSuggestions().length;
    if (query === null) {
      if (slashSelectedIndex() !== 0) setSlashSelectedIndex(0);
      return;
    }
    setSlashSelectedIndex((current) => clamp(current, 0, Math.max(count - 1, 0)));
  });

  function startEventStream() {
    stopEventStream();
    const token = state().config.accessToken;
    if (!token) return;

    eventStreamAbort = new AbortController();
    attachEventStream({
      state,
      setState: (updater) => setState(updater),
      token,
      abortSignal: eventStreamAbort.signal,
    });
  }

  function stopEventStream() {
    eventStreamAbort?.abort();
    eventStreamAbort = null;
  }

  useKeyboard((event) => {
    const name = event.name.toLowerCase();
    if (event.ctrl && name === 'p') {
      event.preventDefault();
      event.stopPropagation();
      openCommandPalette();
      return;
    }

    if (name === 'escape') {
      if (commandPalette()) {
        event.preventDefault();
        event.stopPropagation();
        setCommandPalette(null);
        return;
      }
      if (sessionPalette()) {
        event.preventDefault();
        event.stopPropagation();
        setSessionPalette(null);
        return;
      }
      if (modelPalette()) {
        event.preventDefault();
        event.stopPropagation();
        setModelPalette(null);
        return;
      }
      if (themePalette()) {
        event.preventDefault();
        event.stopPropagation();
        setThemePalette(null);
        return;
      }
      if (slashAutocompleteVisible()) {
        event.preventDefault();
        event.stopPropagation();
        setDismissedSlashQuery(slashQuery());
        return;
      }
    }

    if (slashAutocompleteVisible()) {
      if (name === 'up') {
        event.preventDefault();
        event.stopPropagation();
        moveSlashSelection(-1);
        return;
      }
      if (name === 'down') {
        event.preventDefault();
        event.stopPropagation();
        moveSlashSelection(1);
        return;
      }
      if (name === 'tab') {
        event.preventDefault();
        event.stopPropagation();
        if (filteredSlashSuggestions().length > 0) {
          chooseSlashSuggestion();
        }
        return;
      }
      if (isEnterKey(name) && filteredSlashSuggestions().length > 0) {
        event.preventDefault();
        event.stopPropagation();
        chooseSlashSuggestion();
        return;
      }
    }

    if (commandPalette()) {
      if (name === 'up') {
        event.preventDefault();
        event.stopPropagation();
        moveCommandSelection(-1);
        return;
      }
      if (name === 'down') {
        event.preventDefault();
        event.stopPropagation();
        moveCommandSelection(1);
        return;
      }
      if (isEnterKey(name)) {
        event.preventDefault();
        event.stopPropagation();
        const command = selectedCommand(commandPalette());
        if (command) {
          void chooseCommand(command);
        }
        return;
      }
    }

    const sessionState = sessionPalette();
    if (sessionState) {
      if (name === 'up') {
        event.preventDefault();
        event.stopPropagation();
        moveSessionSelection(-1);
        return;
      }
      if (name === 'down') {
        event.preventDefault();
        event.stopPropagation();
        moveSessionSelection(1);
        return;
      }
      if (isEnterKey(name)) {
        event.preventDefault();
        event.stopPropagation();
        const session = selectedSession(sessionState);
        if (session) {
          void chooseSession(session);
        }
        return;
      }
    }

    const modelState = modelPalette();
    if (modelState?.step === 'list') {
      if (name === 'up') {
        event.preventDefault();
        event.stopPropagation();
        moveModelSelection(-1);
        return;
      }
      if (name === 'down') {
        event.preventDefault();
        event.stopPropagation();
        moveModelSelection(1);
        return;
      }
      if (isEnterKey(name)) {
        event.preventDefault();
        event.stopPropagation();
        const choice = selectedModelChoice(modelState, recentModelKeys());
        if (choice) {
          void chooseModel(choice);
        }
        return;
      }
    }

    if (name === 'tab' && !modelPalette() && !commandPalette() && !themePalette() && !sessionPalette()) {
      event.preventDefault();
      event.stopPropagation();
      toggleComposerMode();
    }
  });

  function toggleComposerMode() {
    setComposerMode((mode) => (mode === 'build' ? 'plan' : 'build'));
  }

  function openCommandPalette() {
    setModelPalette(null);
    setThemePalette(null);
    setSessionPalette(null);
    setCommandPalette({ selectedIndex: 0, query: '' });
  }

  async function chooseCommand(command: CommandPaletteCommand) {
    setCommandPalette(null);
    if (command.action === 'models') {
      await openModelSelectModal();
      return;
    }
    if (command.action === 'sessions') {
      await openSessionPalette();
      return;
    }
    setInput(command.insert ?? '');
  }

  function moveSlashSelection(delta: number) {
    const count = filteredSlashSuggestions().length;
    setSlashSelectedIndex((current) => moveIndex(current, delta, count));
  }

  function slashCommandContext(): SlashCommandContext {
    return {
      openModelSelectModal,
      openSessionPalette: () => openSessionPalette(),
      openThemePalette,
      runCommand: runComposerCommand,
      exitTui,
    };
  }

  function chooseSlashSuggestion(command = filteredSlashSuggestions()[slashSelectedIndex()]) {
    if (!command) return;
    setDismissedSlashQuery(null);
    if (command.kind === 'input') {
      const insert = `${command.name} `;
      setInput(insert);
      setComposerCursorOffset(insert.length);
      setDismissedSlashQuery(getSlashQuery(insert, insert.length));
      return;
    }

    setInput('');
    setComposerCursorOffset(0);
    void command.run?.(slashCommandContext());
  }

  function moveCommandSelection(delta: number) {
    setCommandPalette((current) => {
      if (!current) return current;
      const count = filteredCommandPaletteCommands(current.query).length;
      return { ...current, selectedIndex: moveIndex(current.selectedIndex, delta, count) };
    });
  }

  function selectedCommand(palette: CommandPaletteState | null): CommandPaletteCommand | undefined {
    if (!palette) return undefined;
    return filteredCommandPaletteCommands(palette.query)[palette.selectedIndex];
  }

  function moveModelSelection(delta: number) {
    setModelPalette((current) => {
      if (!current || current.step !== 'list') return current;
      const count = flattenModelGroups(buildModelChoiceGroups(current.choices, current.query, recentModelKeys())).length;
      return { ...current, selectedIndex: moveIndex(current.selectedIndex, delta, count) };
    });
  }

  async function openModelSelectModal() {
    const current = state();
    setCommandPalette(null);
    setThemePalette(null);
    setSessionPalette(null);
    let choices = current.modelChoices;
    let error: string | undefined;
    try {
      choices = await current.api.listModels(current.session.id);
      setState((prev) => ({ ...prev, modelChoices: choices, error: '' }));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Failed to load models.';
      error = message;
      setState((prev) => ({ ...prev, error: message }));
    }

    const recentKeys = ensureRuntimeRecentModels(choices);
    const selectedIndex = initialModelSelectedIndex(choices, recentKeys);
    setModelPalette({
      step: 'list',
      choices,
      selectedIndex,
      query: '',
      apiKey: '',
      error,
    });
  }

  function ensureRuntimeRecentModels(choices: ModelChoice[]): string[] {
    const currentKeys = recentModelKeys();
    if (currentKeys.length > 0) return currentKeys;
    const activeChoice = choices.find((choice) => choice.active);
    if (!activeChoice) return currentKeys;
    const nextKeys = [modelChoiceKey(activeChoice)];
    setRecentModelKeys(nextKeys);
    return nextKeys;
  }

  function rememberRecentModel(choice: ModelChoice) {
    const key = modelChoiceKey(choice);
    setRecentModelKeys((current) => [key, ...current.filter((item) => item !== key)].slice(0, 5));
  }

  function openThemePalette() {
    setCommandPalette(null);
    setModelPalette(null);
    setSessionPalette(null);
    const selectedIndex = Math.max(
      tuiThemeList.findIndex((item) => item.name === themeName()),
      0,
    );
    setThemePalette({ selectedIndex });
  }

  async function openSessionPalette(initialQuery = '') {
    const current = state();
    const query = initialQuery.trim();
    setCommandPalette(null);
    setModelPalette(null);
    setThemePalette(null);
    setSessionPalette({
      sessions: current.sessions,
      selectedIndex: initialSessionSelectedIndex(current.sessions, query, current.session.id),
      query,
      loading: true,
    });

    try {
      const sessions = (await current.api.listSessions(current.project.id)).items;
      setState((prev) => ({ ...prev, sessions, error: '' }));
      setSessionPalette((palette) =>
        palette
          ? {
              ...palette,
              sessions,
              selectedIndex: initialSessionSelectedIndex(sessions, palette.query, current.session.id),
              loading: false,
              error: undefined,
            }
          : palette,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load sessions.';
      setState((prev) => ({ ...prev, error: message }));
      setSessionPalette((palette) => (palette ? { ...palette, loading: false, error: message } : palette));
    }
  }

  function moveSessionSelection(delta: number) {
    setSessionPalette((current) => {
      if (!current) return current;
      const count = flattenSessionGroups(buildSessionGroups(current.sessions, current.query)).length;
      return { ...current, selectedIndex: moveIndex(current.selectedIndex, delta, count) };
    });
  }

  function selectedSession(palette: SessionPaletteState | null): Session | undefined {
    if (!palette) return undefined;
    return flattenSessionGroups(buildSessionGroups(palette.sessions, palette.query))[palette.selectedIndex];
  }

  async function chooseSession(session: Session) {
    if (busy()) return;
    setBusy(true);
    setSessionPalette((current) => (current ? { ...current, loading: true, error: undefined } : current));
    try {
      await switchToSession(session);
      setSessionPalette(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to switch sessions.';
      setState((current) => ({ ...current, error: message }));
      setSessionPalette((current) => (current ? { ...current, loading: false, error: message } : current));
    } finally {
      setBusy(false);
    }
  }

  async function chooseTheme(nextThemeName: TuiThemeName) {
    const current = state();
    const nextConfig = {
      ...current.config,
      preferences: {
        ...current.config.preferences,
        theme: nextThemeName,
      },
    };
    setThemeName(nextThemeName);
    setThemePalette(null);
    setState((prev) => ({
      ...prev,
      config: nextConfig,
      activity: `Theme: ${getTuiTheme(nextThemeName).label}`,
      error: '',
    }));
    try {
      await saveConfig(nextConfig);
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to save theme preference.',
      }));
    }
  }

  async function submit() {
    const value = input().trim();
    if (!value) return;
    if (isExitCommand(value)) {
      setInput('');
      exitTui();
      return;
    }
    if (busy()) return;
    setInput('');
    await runComposerCommand(value);
  }

  async function runComposerCommand(value: string) {
    if (busy()) return;
    setBusy(true);
    try {
      if (value.startsWith('/')) {
        await handleCommand(value);
      } else {
        await submitComposerText(value);
      }
      const updates = await refreshReviewData(state());
      setState((current) => ({ ...current, ...updates }));
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Operation failed.',
      }));
    } finally {
      setBusy(false);
    }
  }

  function exitTui() {
    stopEventStream();
    renderer.destroy();
  }

  async function submitComposerText(value: string) {
    if (composerMode() === 'plan') {
      await createPlanFromGoal(value);
      return;
    }
    await runAgentPrompt(value);
  }

  async function handleCommand(value: string) {
    const current = state();
    if (value === '/approve') {
      const approval = current.approvals[0];
      if (!approval) throw new Error('No pending approval.');
      await current.api.approve(approval.id, 'once');
      return;
    }
    if (value === '/reject') {
      const approval = current.approvals[0];
      if (!approval) throw new Error('No pending approval.');
      await current.api.reject(approval.id);
      return;
    }
    if (value === '/new' || value.startsWith('/new ')) {
      await createNewSessionFromCommand(value);
      return;
    }
    if (value === '/sessions' || value.startsWith('/sessions ')) {
      await openSessionPalette(value.slice('/sessions'.length));
      return;
    }
    if (value === '/clear') {
      await current.api.runSessionCommand(current.session.id, '/clear');
      setState((prev) => ({ ...prev, messages: [], activity: 'Context cleared' }));
      return;
    }
    if (value.startsWith('/clear ')) {
      throw new Error('/clear does not accept arguments.');
    }
    if (value === '/compact') {
      await current.api.runSessionCommand(current.session.id, '/compact');
      setState((prev) => ({ ...prev, messages: [], activity: 'Context compacted' }));
      return;
    }
    if (value.startsWith('/compact ')) {
      throw new Error('/compact does not accept arguments.');
    }
    if (value.startsWith('/plan ')) {
      await createPlanFromGoal(value.slice('/plan '.length));
      return;
    }
    if (value === '/plan-approve') {
      const plan = current.plan;
      if (!plan) throw new Error('No plan to approve.');
      const approved = await current.api.approvePlan(plan.plan.id);
      setState((prev) => ({ ...prev, plan: { ...plan, plan: approved } }));
      return;
    }
    if (value.startsWith('/run ')) {
      await current.api.requestCommand(current.session.id, value.slice('/run '.length));
      return;
    }
    if (value.startsWith('/open ')) {
      const file = await current.api.file(current.project.id, value.slice('/open '.length));
      setState((prev) => ({ ...prev, currentFile: file }));
      return;
    }
    if (value === '/models' || value.startsWith('/models ')) {
      await openModelSelectModal();
      return;
    }
    if (value === '/themes' || value.startsWith('/themes ')) {
      openThemePalette();
      return;
    }
    if (value === '/model' || value.startsWith('/model ') || value === '/connect' || value.startsWith('/connect ')) {
      throw new Error('Use /models to choose or configure a model in the TUI.');
    }

    await runAgentPrompt(value);
  }

  async function createNewSessionFromCommand(value: string) {
    const title = parseNewSessionTitle(value);
    const current = state();
    const modelConfigId =
      current.session.activeModelConfig?.id ?? current.modelChoices.find((choice) => choice.active)?.modelConfigId;

    setState((prev) => ({ ...prev, activity: 'Creating session', error: '' }));
    const created = await current.api.createSession(current.project.id, {
      ...(title ? { title } : {}),
      ...(modelConfigId ? { modelConfigId } : {}),
    });

    await switchToSession(created, { fallbackToTarget: true });
  }

  async function switchToSession(target: Session, options: { fallbackToTarget?: boolean } = {}) {
    const current = state();
    setState((prev) => ({ ...prev, activity: `Opening session: ${target.title}`, error: '' }));
    stopEventStream();
    try {
      const sessionPromise = current.api.getSession(target.id).catch((error) => {
        if (options.fallbackToTarget) return target;
        throw error;
      });

      const [session, sessionList, messages, approvals, plan, commandRuns, gitStatus, modelChoices] = await Promise.all([
        sessionPromise,
        current.api
          .listSessions(current.project.id)
          .then((result) => result.items)
          .catch(() => current.sessions),
        current.api.listMessages(target.id).catch(() => []),
        current.api.pendingApprovals().catch(() => current.approvals),
        current.api.latestPlan(target.id).catch(() => null),
        current.api.commandRuns(target.id).catch(() => []),
        current.api.gitStatus(current.project.id).catch(() => current.gitStatus),
        current.api.listModels(target.id).catch(() => current.modelChoices),
      ]);
      const nextConfig = {
        ...current.config,
        recentProjectId: current.project.id,
        recentSessionId: session.id,
      };

      setState((prev) => ({
        ...prev,
        config: nextConfig,
        session,
        sessions: upsertSessionList(sessionList, session),
        modelChoices,
        messages,
        gitStatus,
        approvals,
        plan,
        commandRuns,
        events: [],
        activity: `Session: ${session.title}`,
        error: '',
      }));
      startEventStream();

      try {
        await saveConfig(nextConfig);
      } catch (error) {
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Failed to save recent session.',
        }));
      }
    } catch (error) {
      startEventStream();
      throw error;
    }
  }

  async function createPlanFromGoal(goal: string) {
    const current = state();
    setState((prev) => ({ ...prev, activity: 'Planning' }));
    const plan = await current.api.createPlan(current.session.id, goal);
    setState((prev) => ({ ...prev, plan, activity: 'Ready' }));
  }

  async function runAgentPrompt(value: string) {
    const current = state();
    setState((prev) => ({
      ...prev,
      messages: [
        ...prev.messages,
        {
          id: `local-user-${Date.now()}`,
          role: 'user',
          content: value,
          createdAt: new Date().toISOString(),
        },
      ],
      activity: 'Thinking',
    }));
    await current.api.runAgent(current.session.id, value);
  }

  async function chooseModel(choice: ModelChoice, apiKey?: string) {
    if (busy()) return;
    if (!apiKey && choice.requiresApiKey) {
      setModelPalette((current) =>
        current
          ? {
              ...current,
              step: 'apiKey',
              pendingChoice: choice,
              apiKey: '',
              error: undefined,
            }
          : current,
      );
      return;
    }

    setBusy(true);
    try {
      const result = await state().api.selectModel(state().session.id, {
        providerId: choice.providerId,
        modelName: choice.modelName,
        ...(apiKey ? { apiKey } : {}),
      });
      await applyModelsResult(result);
      rememberRecentModel(choice);
      setModelPalette(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Model selection failed.';
      if (!apiKey && message.includes('API key is required')) {
        setModelPalette((current) =>
          current
            ? {
                ...current,
                step: 'apiKey',
                pendingChoice: choice,
                apiKey: '',
                error: undefined,
              }
            : current,
        );
        return;
      }
      setModelPalette((current) => (current ? { ...current, error: message } : current));
      setState((current) => ({ ...current, error: message }));
    } finally {
      setBusy(false);
    }
  }

  async function submitModelApiKey() {
    const palette = modelPalette();
    const choice = palette?.pendingChoice;
    const apiKey = palette?.apiKey.trim();
    if (!palette || !choice) return;
    if (!apiKey) {
      setModelPalette({ ...palette, error: 'API key is required for this model.' });
      return;
    }
    await chooseModel(choice, apiKey);
  }

  async function applyModelsResult(result: ModelsCommandResult) {
    if (result.type !== 'models.selected') return;
    const choices = await state().api.listModels(result.session.id).catch(() => state().modelChoices);
    setState((current) => ({
      ...current,
      session: result.session,
      modelChoices: choices,
      activity: `Model: ${result.modelConfig.modelName}`,
      error: '',
    }));
  }

  return (
    <ThemeContext.Provider value={theme}>
      <box style={{ flexDirection: 'column', width: '100%', height: '100%', backgroundColor: theme().background }}>
        <Header state={state()} busy={busy()} />
        <box style={{ flexDirection: 'row', flexGrow: 1, minHeight: 0 }}>
          <ChatPanel
            messages={state().messages}
            error={state().error}
            slashAutocomplete={{
              visible: slashAutocompleteVisible(),
              suggestions: filteredSlashSuggestions(),
              selectedIndex: slashSelectedIndex(),
              onChoose: chooseSlashSuggestion,
            }}
            composer={{
              mode: composerMode(),
              accentColor: composerAccentColor(),
              modelInfo: activeModelInfo(),
              value: input(),
              focused: !modelPalette() && !commandPalette() && !themePalette() && !sessionPalette(),
              onInput: setInput,
              onCursorOffsetChange: setComposerCursorOffset,
              onSubmit: () => {
                void submit();
              },
            }}
          />
          <RightPanel title={rightTitle()} approval={activeApproval()} state={state()} mode={composerMode()} busy={busy()} />
        </box>

        <Show when={commandPalette()}>
          {(palette) => (
            <CommandPalette
              palette={palette()}
              onClose={() => setCommandPalette(null)}
              onQuery={(query) => setCommandPalette((current) => (current ? { ...current, query, selectedIndex: 0 } : current))}
              onChoose={(command) => {
                void chooseCommand(command);
              }}
            />
          )}
        </Show>

        <Show when={sessionPalette()}>
          {(palette) => (
            <SessionsPalette
              palette={palette()}
              currentSessionId={state().session.id}
              onClose={() => setSessionPalette(null)}
              onQuery={(query) => setSessionPalette((current) => (current ? { ...current, query, selectedIndex: 0 } : current))}
              onChoose={(session) => {
                void chooseSession(session);
              }}
            />
          )}
        </Show>

        <Show when={modelPalette()}>
          {(palette) => (
            <ModelSelectModal
              palette={palette()}
              busy={busy()}
              recentModelKeys={recentModelKeys()}
              onClose={() => setModelPalette(null)}
              onQuery={(query) => setModelPalette((current) => (current ? { ...current, query, selectedIndex: 0 } : current))}
              onChoose={(choice) => {
                void chooseModel(choice);
              }}
              onApiKeyInput={(apiKey) =>
                setModelPalette((current) => (current ? { ...current, apiKey, error: undefined } : current))
              }
              onSubmitApiKey={() => {
                void submitModelApiKey();
              }}
            />
          )}
        </Show>

        <Show when={themePalette()}>
          {(palette) => (
            <ModalShell title="Themes" onClose={() => setThemePalette(null)}>
              <ThemesPanel
                palette={palette()}
                currentThemeName={themeName()}
                onClose={() => setThemePalette(null)}
                onSelectedIndex={(selectedIndex) =>
                  setThemePalette((current) => (current ? { ...current, selectedIndex } : current))
                }
                onChoose={(name) => {
                  void chooseTheme(name);
                }}
              />
            </ModalShell>
          )}
        </Show>
      </box>
    </ThemeContext.Provider>
  );
}

function Header(props: { state: WorkspaceState; busy: boolean }) {
  const theme = useTheme();
  const mode = props.state.mode === 'remote' ? 'remote API' : 'local API';
  return (
    <box style={{ height: 3, paddingX: 1, alignItems: 'center', flexDirection: 'row', backgroundColor: theme().background }}>
      <text fg={theme().text}>Mebius</text>
      <text fg={theme().muted}> - {props.state.project.name}</text>
      <text fg={theme().muted}> - {props.state.session.title}</text>
      <text fg={theme().muted}> - {mode}</text>
      <text fg={props.busy ? theme().yellow : theme().green}> - {props.busy ? 'busy' : props.state.activity}</text>
    </box>
  );
}

function CommandPalette(props: {
  palette: CommandPaletteState;
  onClose: () => void;
  onQuery: (query: string) => void;
  onChoose: (command: CommandPaletteCommand) => void;
}) {
  const theme = useTheme();
  const dimensions = useTerminalDimensions();
  const commands = createMemo(() => filteredCommandPaletteCommands(props.palette.query));
  const listHeight = createMemo(() => clamp(commands().length, 1, Math.max(3, Math.floor(dimensions().height * 0.8) - 7)));

  return (
    <ModalShell title="Command palette" onClose={props.onClose}>
      <PaletteSearch value={props.palette.query} placeholder="Search commands" onInput={props.onQuery} />
      <scrollbox
        scrollY
        style={{ width: '100%', height: listHeight(), minHeight: 1, marginTop: 1, flexShrink: 0 }}
        contentOptions={{ width: '100%', minWidth: '100%', flexDirection: 'column' }}
      >
        <Show when={commands().length > 0} fallback={<text fg={theme().muted}>No commands found</text>}>
          <For each={commands()}>
            {(command, index) => {
              const selected = createMemo(() => index() === props.palette.selectedIndex);
              return (
                <box
                  style={{
                    width: '100%',
                    height: 1,
                    minHeight: 1,
                    flexDirection: 'row',
                    backgroundColor: selected() ? theme().selection : theme().panel,
                  }}
                  onMouseDown={() => props.onChoose(command)}
                >
                  <text fg={selected() ? theme().text : theme().text} style={{ width: 18, flexShrink: 0 }}>
                    {command.label}
                  </text>
                  <text fg={selected() ? theme().text : theme().muted} style={{ flexGrow: 1, minWidth: 0 }}>
                    {command.description}
                  </text>
                </box>
              );
            }}
          </For>
        </Show>
      </scrollbox>
      <PaletteFooter items={[['Enter', 'select'], ['Esc', 'close'], ['Up/Down', 'navigate']]} />
    </ModalShell>
  );
}

function SessionsPalette(props: {
  palette: SessionPaletteState;
  currentSessionId: string;
  onClose: () => void;
  onQuery: (query: string) => void;
  onChoose: (session: Session) => void;
}) {
  const theme = useTheme();
  const dimensions = useTerminalDimensions();
  const groups = createMemo(() => buildSessionGroups(props.palette.sessions, props.palette.query));
  const flatSessions = createMemo(() => flattenSessionGroups(groups()));
  const renderedRows = createMemo(() => groups().reduce((total, group) => total + group.rows.length + 1, 0));
  const listHeight = createMemo(() => clamp(renderedRows(), 2, Math.max(4, dimensions().height - 7)));

  return (
    <box
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 22,
        paddingX: 2,
        paddingY: 1,
        flexDirection: 'column',
        backgroundColor: theme().background,
      }}
      onKeyDown={(event) => {
        if (event.name === 'escape') {
          props.onClose();
        }
      }}
    >
      <box style={{ width: '100%', height: 1, flexDirection: 'row', flexShrink: 0 }}>
        <text fg={theme().text}>Sessions</text>
        <box style={{ flexGrow: 1 }} />
        <text fg={theme().muted}>esc</text>
      </box>
      <PaletteSearch value={props.palette.query} placeholder="Search sessions" onInput={props.onQuery} />
      <Show when={props.palette.error}>
        <text fg={theme().red}>{props.palette.error}</text>
      </Show>
      <Show when={props.palette.loading}>
        <text fg={theme().yellow}>Loading sessions...</text>
      </Show>
      <scrollbox
        scrollY
        style={{ width: '100%', height: listHeight(), minHeight: 2, marginTop: 1, flexShrink: 1 }}
        contentOptions={{ width: '100%', minWidth: '100%', flexDirection: 'column' }}
      >
        <Show when={flatSessions().length > 0} fallback={<text fg={theme().muted}>No sessions found</text>}>
          <For each={groups()}>
            {(group) => (
              <box style={{ flexDirection: 'column', width: '100%', marginBottom: 1 }}>
                <text fg={theme().blue}>{group.title}</text>
                <For each={group.rows}>
                  {(row) => {
                    const selected = createMemo(() => row.index === props.palette.selectedIndex);
                    return (
                      <SessionRow
                        session={row.session}
                        selected={selected()}
                        current={row.session.id === props.currentSessionId}
                        onChoose={() => props.onChoose(row.session)}
                      />
                    );
                  }}
                </For>
              </box>
            )}
          </For>
        </Show>
      </scrollbox>
      <PaletteFooter items={[['Enter', 'switch'], ['Esc', 'close'], ['Up/Down', 'navigate']]} />
    </box>
  );
}

function SessionRow(props: { session: Session; selected: boolean; current: boolean; onChoose: () => void }) {
  const theme = useTheme();
  const rowBackground = createMemo(() => (props.selected ? theme().selection : theme().background));
  const primaryColor = createMemo(() => (props.selected ? theme().text : theme().text));
  const secondaryColor = createMemo(() => (props.selected ? theme().text : theme().muted));
  const markerColor = createMemo(() => (props.current ? theme().green : secondaryColor()));

  return (
    <box
      style={{
        width: '100%',
        height: 1,
        minHeight: 1,
        flexDirection: 'row',
        backgroundColor: rowBackground(),
      }}
      onMouseDown={props.onChoose}
    >
      <text fg={markerColor()} style={{ width: 2, flexShrink: 0 }}>
        {props.current ? '*' : ' '}
      </text>
      <text fg={primaryColor()} truncate style={{ flexGrow: 1, minWidth: 0 }}>
        {props.session.title}
      </text>
      <text fg={secondaryColor()} truncate style={{ width: 20, flexShrink: 0 }}>
        {props.session.activeModelConfig?.modelName ?? props.session.status}
      </text>
      <text fg={secondaryColor()} style={{ width: 5, flexShrink: 0 }}>
        {formatSessionTime(props.session)}
      </text>
    </box>
  );
}

function ModalShell(props: { title: string; onClose: () => void; children: JSX.Element }) {
  const theme = useTheme();
  const dimensions = useTerminalDimensions();
  const modalWidth = createMemo(() => {
    const maxWidth = Math.max(28, dimensions().width - 4);
    const target = Math.floor(dimensions().width * 0.5);
    return clamp(target, Math.min(48, maxWidth), Math.min(82, maxWidth));
  });
  const maxHeight = createMemo(() => Math.max(12, Math.floor(dimensions().height * 0.8)));

  return (
    <>
      <box
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 20,
          opacity: 0.62,
          backgroundColor: '#000000',
        }}
      />
      <box
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 21,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onKeyDown={(event) => {
          if (event.name === 'escape') {
            props.onClose();
          }
        }}
      >
        <box
          border
          borderStyle="rounded"
          borderColor={theme().border}
          focusedBorderColor={theme().blue}
          style={{
            width: modalWidth(),
            maxHeight: maxHeight(),
            paddingX: 2,
            paddingY: 1,
            flexDirection: 'column',
            backgroundColor: theme().input,
          }}
        >
          <box style={{ width: '100%', height: 1, flexDirection: 'row', flexShrink: 0 }}>
            <text fg={theme().text}>
              {props.title}
            </text>
            <box style={{ flexGrow: 1 }} />
            <text fg={theme().muted}>esc</text>
          </box>
          {props.children}
        </box>
      </box>
    </>
  );
}

function PaletteSearch(props: { value: string; placeholder: string; onInput: (value: string) => void }) {
  const theme = useTheme();
  return (
    <box style={{ width: '100%', height: 1, minHeight: 1, marginTop: 1, flexDirection: 'row', flexShrink: 0 }}>
      <text fg={theme().muted} style={{ width: 2, flexShrink: 0 }}>
        &gt;
      </text>
      <input
        focused
        value={props.value}
        placeholder={props.placeholder}
        backgroundColor={theme().input}
        focusedBackgroundColor={theme().input}
        textColor={theme().text}
        focusedTextColor={theme().text}
        cursorColor={theme().blue}
        onInput={props.onInput}
        style={{ flexGrow: 1, minWidth: 0 }}
      />
    </box>
  );
}

function PaletteFooter(props: { items: Array<[string, string]> }) {
  const theme = useTheme();
  return (
    <box style={{ width: '100%', height: 1, marginTop: 1, flexDirection: 'row', flexShrink: 0 }}>
      <For each={props.items}>
        {([key, action]) => (
          <>
            <text fg={theme().text}>{action}</text>
            <text fg={theme().muted}> {key}  </text>
          </>
        )}
      </For>
    </box>
  );
}

function ThemesPanel(props: {
  palette: ThemePaletteState;
  currentThemeName: TuiThemeName;
  onClose: () => void;
  onSelectedIndex: (index: number) => void;
  onChoose: (themeName: TuiThemeName) => void;
}) {
  const theme = useTheme();
  return (
    <box
      style={{ flexGrow: 1, minHeight: 0, flexDirection: 'column', backgroundColor: theme().input }}
      onKeyDown={(event) => {
        if (event.name === 'escape') {
          props.onClose();
        }
      }}
    >
      <text fg={theme().text}>TUI themes</text>
      <text fg={theme().muted}>Enter selects. Esc closes.</text>
      <box style={{ flexDirection: 'column', flexGrow: 1, minHeight: 0, marginTop: 1 }}>
        <select
          focused
          options={tuiThemeList.map((item) => ({
            name: themeChoiceName(item, props.currentThemeName),
            description: item.description,
            value: item.name,
          }))}
          selectedIndex={props.palette.selectedIndex}
          showDescription
          showScrollIndicator
          wrapSelection
          backgroundColor={theme().panel}
          textColor={theme().text}
          selectedBackgroundColor={theme().selection}
          selectedTextColor={theme().text}
          descriptionColor={theme().muted}
          selectedDescriptionColor={theme().text}
          style={{ flexGrow: 1, minHeight: 8 }}
          onChange={(index) => props.onSelectedIndex(index)}
          onSelect={(_index, option) => {
            const name = option?.value as TuiThemeName | undefined;
            if (name) props.onChoose(name);
          }}
          onKeyDown={(event) => {
            if (event.name === 'escape') {
              props.onClose();
            }
          }}
        />
      </box>
    </box>
  );
}

function Composer(props: {
  mode: ComposerMode;
  accentColor: string;
  modelInfo: ActiveModelInfo;
  value: string;
  focused: boolean;
  onInput: (value: string) => void;
  onCursorOffsetChange: (offset: number) => void;
  onSubmit: () => void;
}) {
  const theme = useTheme();
  let textareaRef: TextareaRenderable | undefined;

  function syncComposerState() {
    props.onInput(textareaRef?.plainText ?? '');
    props.onCursorOffsetChange(textareaRef?.cursorOffset ?? 0);
  }

  createEffect(() => {
    const value = props.value;
    if (!textareaRef || textareaRef.plainText === value) return;
    textareaRef.setText(value);
    textareaRef.cursorOffset = value.length;
    props.onCursorOffsetChange(value.length);
  });

  return (
    <box
      border
      borderStyle="rounded"
      borderColor={theme().border}
      focusedBorderColor={theme().border}
      style={{
        width: '100%',
        height: COMPOSER_HEIGHT,
        minHeight: COMPOSER_HEIGHT,
        minWidth: 0,
        flexShrink: 0,
        alignSelf: 'stretch',
        flexDirection: 'row',
        backgroundColor: theme().input,
      }}
    >
      <box style={{ width: 1, flexShrink: 0, alignSelf: 'stretch', backgroundColor: props.accentColor }} />
      <box style={{ width: '100%', flexGrow: 1, minWidth: 0, paddingX: 1, flexDirection: 'column' }}>
        <textarea
          ref={textareaRef}
          focused={props.focused}
          initialValue={props.value}
          placeholder={null}
          backgroundColor={theme().input}
          focusedBackgroundColor={theme().input}
          textColor={theme().text}
          focusedTextColor={theme().text}
          cursorColor={props.accentColor}
          wrapMode="word"
          keyBindings={composerSubmitKeyBindings}
          style={{ width: '100%', flexGrow: 1, minHeight: 3, minWidth: 0, flexShrink: 1 }}
          onContentChange={syncComposerState}
          onCursorChange={() => props.onCursorOffsetChange(textareaRef?.cursorOffset ?? 0)}
          onSubmit={props.onSubmit}
        />
        <box style={{ width: '100%', height: 1, flexShrink: 0, flexDirection: 'row' }}>
          <text fg={props.accentColor}>{composerModeLabel(props.mode)}</text>
          <text fg={theme().muted}> - {props.modelInfo.modelName} - {props.modelInfo.providerDisplay}</text>
        </box>
      </box>
    </box>
  );
}

function ModelSelectModal(props: {
  palette: ModelPaletteState;
  busy: boolean;
  recentModelKeys: string[];
  onClose: () => void;
  onQuery: (query: string) => void;
  onChoose: (choice: ModelChoice) => void;
  onApiKeyInput: (apiKey: string) => void;
  onSubmitApiKey: () => void;
}) {
  const theme = useTheme();
  const dimensions = useTerminalDimensions();
  const groups = createMemo(() => buildModelChoiceGroups(props.palette.choices, props.palette.query, props.recentModelKeys));
  const flatChoices = createMemo(() => flattenModelGroups(groups()));
  const renderedRows = createMemo(() => groups().reduce((total, group) => total + group.rows.length + 1, 0));
  const listHeight = createMemo(() => clamp(renderedRows(), 2, Math.max(4, Math.floor(dimensions().height * 0.8) - 9)));

  if (props.palette.step === 'apiKey') {
    return (
      <ModalShell title="Select model" onClose={props.onClose}>
        <box style={{ flexDirection: 'column', marginTop: 1 }}>
          <Show when={props.palette.error}>
            <text fg={theme().red}>{props.palette.error}</text>
          </Show>
          <text fg={theme().yellow}>API key required for {props.palette.pendingChoice?.modelName}</text>
          <text fg={theme().muted}>The key is sent to the backend model config store and is not added to chat.</text>
          <box style={{ marginTop: 1 }}>
            <input
              focused
              value={props.palette.apiKey}
              placeholder="API Key"
              backgroundColor={theme().input}
              focusedBackgroundColor={theme().input}
              textColor={theme().text}
              focusedTextColor={theme().text}
              cursorColor={theme().blue}
              onInput={props.onApiKeyInput}
              onSubmit={props.onSubmitApiKey}
              style={{ width: '100%' }}
            />
          </box>
          <text fg={props.busy ? theme().yellow : theme().muted}>
            {props.busy ? 'Validating key...' : 'Enter saves and switches. Esc closes.'}
          </text>
        </box>
      </ModalShell>
    );
  }

  return (
    <ModalShell title="Select model" onClose={props.onClose}>
      <PaletteSearch value={props.palette.query} placeholder="Search" onInput={props.onQuery} />
      <Show when={props.palette.error}>
        <text fg={theme().red}>{props.palette.error}</text>
      </Show>
      <scrollbox
        scrollY
        style={{ width: '100%', height: listHeight(), minHeight: 2, marginTop: 1, flexShrink: 0 }}
        contentOptions={{ width: '100%', minWidth: '100%', flexDirection: 'column' }}
      >
        <Show when={flatChoices().length > 0} fallback={<text fg={theme().muted}>No models found</text>}>
          <For each={groups()}>
            {(group) => (
              <box style={{ flexDirection: 'column', width: '100%', marginBottom: 1 }}>
                <text fg={theme().blue}>{group.title}</text>
                <For each={group.rows}>
                  {(row) => {
                    const selected = createMemo(() => row.index === props.palette.selectedIndex);
                    return (
                      <ModelChoiceRow
                        choice={row.choice}
                        selected={selected()}
                        onChoose={() => props.onChoose(row.choice)}
                      />
                    );
                  }}
                </For>
              </box>
            )}
          </For>
        </Show>
      </scrollbox>
      <PaletteFooter items={[['Enter', 'select'], ['Esc', 'close'], ['Up/Down', 'navigate']]} />
    </ModalShell>
  );
}

function ModelChoiceRow(props: { choice: ModelChoice; selected: boolean; onChoose: () => void }) {
  const theme = useTheme();
  const rowBackground = createMemo(() => (props.selected ? theme().selection : theme().input));
  const primaryColor = createMemo(() => (props.selected ? theme().text : theme().text));
  const secondaryColor = createMemo(() => (props.selected ? theme().text : theme().muted));

  return (
    <box
      style={{
        width: '100%',
        height: 1,
        minHeight: 1,
        flexDirection: 'row',
        backgroundColor: rowBackground(),
      }}
      onMouseDown={props.onChoose}
    >
      <text fg={secondaryColor()} style={{ width: 2, flexShrink: 0 }}>
        {props.choice.active ? '*' : ' '}
      </text>
      <text fg={primaryColor()} truncate style={{ flexGrow: 1, minWidth: 0 }}>
        {props.choice.modelName}
      </text>
      <text fg={secondaryColor()} truncate style={{ width: 18, flexShrink: 0 }}>
        {props.choice.providerName}
      </text>
      <text fg={secondaryColor()} truncate style={{ width: 16, flexShrink: 0 }}>
        {modelChoiceTag(props.choice)}
      </text>
    </box>
  );
}

function ChatPanel(props: {
  messages: Message[];
  error: string;
  slashAutocomplete: {
    visible: boolean;
    suggestions: SlashCommand[];
    selectedIndex: number;
    onChoose: (command: SlashCommand) => void;
  };
  composer: {
    mode: ComposerMode;
    accentColor: string;
    modelInfo: ActiveModelInfo;
    value: string;
    focused: boolean;
    onInput: (value: string) => void;
    onCursorOffsetChange: (offset: number) => void;
    onSubmit: () => void;
  };
}) {
  const theme = useTheme();
  return (
    <box
      border
      borderColor={theme().border}
      title="Chat"
      style={{
        flexGrow: 1,
        flexShrink: 1,
        minWidth: MAIN_COLUMN_MIN_WIDTH,
        minHeight: 0,
        paddingX: 1,
        paddingBottom: 1,
        flexDirection: 'column',
        backgroundColor: theme().panel,
      }}
    >
      <scrollbox
        stickyScroll
        stickyStart="bottom"
        contentOptions={{ width: '100%', minWidth: '100%', maxWidth: '100%', alignSelf: 'stretch', flexDirection: 'column' }}
        style={{ width: '100%', flexGrow: 1, minHeight: 0, minWidth: 0, alignSelf: 'stretch' }}
      >
        <Show when={props.error}>
          <text fg={theme().red}>{props.error}</text>
        </Show>
        <For each={props.messages}>
          {(message) => <MessageBlock message={message} />}
        </For>
      </scrollbox>
      <Show when={props.slashAutocomplete.visible}>
        <SlashCommandAutocomplete
          suggestions={props.slashAutocomplete.suggestions}
          selectedIndex={props.slashAutocomplete.selectedIndex}
          onChoose={props.slashAutocomplete.onChoose}
        />
      </Show>
      <Composer {...props.composer} />
    </box>
  );
}

function SlashCommandAutocomplete(props: {
  suggestions: SlashCommand[];
  selectedIndex: number;
  onChoose: (command: SlashCommand) => void;
}) {
  const theme = useTheme();
  const dimensions = useTerminalDimensions();
  const rowCount = createMemo(() => Math.max(props.suggestions.length, 1));
  const listHeight = createMemo(() => clamp(rowCount(), 1, Math.max(3, Math.min(12, dimensions().height - COMPOSER_HEIGHT - 8))));

  return (
    <box
      border
      borderStyle="rounded"
      borderColor={theme().border}
      style={{
        width: '100%',
        height: listHeight() + 2,
        minHeight: 3,
        flexShrink: 0,
        marginBottom: 1,
        flexDirection: 'column',
        backgroundColor: theme().input,
      }}
    >
      <scrollbox
        scrollY
        style={{ width: '100%', height: listHeight(), minHeight: 1, flexShrink: 0 }}
        contentOptions={{ width: '100%', minWidth: '100%', flexDirection: 'column' }}
      >
        <Show when={props.suggestions.length > 0} fallback={<text fg={theme().muted}>No slash commands found</text>}>
          <For each={props.suggestions}>
            {(suggestion, index) => {
              const selected = createMemo(() => index() === props.selectedIndex);
              return (
                <box
                  style={{
                    width: '100%',
                    height: 1,
                    minHeight: 1,
                    paddingX: 1,
                    flexDirection: 'row',
                    backgroundColor: selected() ? theme().selection : theme().input,
                  }}
                  onMouseDown={() => props.onChoose(suggestion)}
                >
                  <text fg={theme().text} truncate style={{ width: 18, flexShrink: 0 }}>
                    {suggestion.name}
                  </text>
                  <text fg={selected() ? theme().text : theme().muted} truncate style={{ flexGrow: 1, minWidth: 0 }}>
                    {suggestion.description}
                  </text>
                </box>
              );
            }}
          </For>
        </Show>
      </scrollbox>
    </box>
  );
}

function MessageBlock(props: { message: Message }) {
  const theme = useTheme();
  const isUserMessage = createMemo(() => props.message.role === 'user');
  const accentColor = createMemo(() => (isUserMessage() ? theme().blue : roleColor(props.message.role, theme())));
  return (
    <box
      style={{
        width: '100%',
        flexGrow: 0,
        flexShrink: 0,
        minWidth: 0,
        alignSelf: 'stretch',
        flexDirection: 'row',
        alignItems: 'stretch',
        marginBottom: 1,
        backgroundColor: isUserMessage() ? theme().input : theme().background,
      }}
    >
      <box style={{ width: 1, flexShrink: 0, alignSelf: 'stretch', backgroundColor: accentColor() }} />
      <box style={{ width: '100%', flexGrow: 1, minWidth: 0, paddingX: 1, flexDirection: 'column' }}>
        <text fg={accentColor()} style={{ width: '100%', minWidth: 0, flexShrink: 0 }}>
          {props.message.role}
          {props.message.streaming ? ' - streaming' : ''}
        </text>
        <MessageBody message={props.message} />
      </box>
    </box>
  );
}

function MessageBody(props: { message: Message }) {
  const theme = useTheme();
  const messageMarkdownStyle = createMemo(() => createMessageMarkdownStyle(theme()));
  const markdownTableOptions = createMemo(() => createMarkdownTableOptions(theme()));
  if (props.message.role === 'assistant' || props.message.role === 'system') {
    return (
      <markdown
        content={props.message.content || ' '}
        syntaxStyle={messageMarkdownStyle()}
        fg={theme().text}
        conceal={true}
        concealCode={false}
        streaming={props.message.streaming ?? false}
        internalBlockMode="top-level"
        tableOptions={markdownTableOptions()}
        style={{ width: '100%', minWidth: 0, flexShrink: 0 }}
      />
    );
  }

  return (
    <text fg={theme().text} wrapMode="word" style={{ width: '100%', minWidth: 0, flexShrink: 0 }}>
      {props.message.content || ' '}
    </text>
  );
}

function RightPanel(props: {
  title: string;
  approval: Approval | undefined;
  state: WorkspaceState;
  mode: ComposerMode;
  busy: boolean;
}) {
  const theme = useTheme();
  return (
    <box
      border
      borderColor={theme().border}
      title={props.title}
      style={{
        width: RIGHT_RAIL_WIDTH,
        flexShrink: 0,
        paddingX: 1,
        flexDirection: 'column',
        backgroundColor: theme().panel,
      }}
    >
      <Show when={props.approval} fallback={<StatusPanel state={props.state} mode={props.mode} busy={props.busy} />}>
        {(approval) => <ApprovalView approval={approval()} />}
      </Show>
    </box>
  );
}

function ApprovalView(props: { approval: Approval }) {
  const theme = useTheme();
  const preview = props.approval.preview;
  return (
    <scrollbox style={{ flexGrow: 1 }}>
      <text fg={theme().yellow}>Pending {props.approval.toolCall.name}</text>
      <text fg={theme().muted}>Type /approve or /reject in the prompt.</text>
      <Show when={preview}>
        {(value) => <Preview preview={value()} />}
      </Show>
    </scrollbox>
  );
}

function Preview(props: { preview: ApprovalPreview }) {
  const theme = useTheme();
  if (props.preview.kind === 'command') {
    return (
      <box style={{ flexDirection: 'column' }}>
        <text fg={theme().softRed}>Command requires approval</text>
        <text fg={theme().text}>{props.preview.command}</text>
        <text fg={theme().muted}>cwd: {props.preview.cwd ?? 'workspace root'}</text>
        <Show when={highRiskCommand(props.preview.command)}>
          <text fg={theme().red}>High risk command: review carefully before approving.</text>
        </Show>
      </box>
    );
  }
  const files = props.preview.kind === 'patch' ? [{ path: props.preview.path, diffText: props.preview.diffText }] : props.preview.files;
  return (
    <box style={{ flexDirection: 'column' }}>
      <text fg={theme().green}>Patch diff</text>
      <For each={files}>
        {(file) => (
          <box style={{ flexDirection: 'column', marginBottom: 1 }}>
            <text fg={theme().text}>{file.path}</text>
            <For each={file.diffText.split('\n').slice(0, 80)}>
              {(line) => <text fg={line.startsWith('+') ? theme().green : line.startsWith('-') ? theme().softRed : theme().text}>{line}</text>}
            </For>
          </box>
        )}
      </For>
    </box>
  );
}

function StatusPanel(props: { state: WorkspaceState; mode: ComposerMode; busy: boolean }) {
  const theme = useTheme();
  const modelInfo = createMemo(() => getActiveModelInfo(props.state));
  const taskStatus = createMemo(() => deriveTaskStatus(props.state, props.busy));
  const contextTokens = createMemo(() => estimateContextTokens(props.state.messages));
  const recentEvents = createMemo(() => props.state.events.filter(isHighLevelEvent).slice(0, 5));

  return (
    <scrollbox style={{ flexGrow: 1 }}>
      <StatusSection title="Session">
        <StatusRow label="Name" value={props.state.session.title} />
        <StatusRow label="ID" value={shortId(props.state.session.id)} />
        <StatusRow label="Mode" value={composerModeLabel(props.mode)} />
        <StatusRow label="Task" value={taskStatus()} valueColor={statusColor(taskStatus(), theme())} />
      </StatusSection>

      <StatusSection title="Model">
        <StatusRow label="Name" value={modelInfo().modelName === 'no model' ? '-' : modelInfo().modelName} />
        <StatusRow
          label="Provider"
          value={modelInfo().providerDisplay.includes('no provider') ? '-' : modelInfo().providerDisplay}
        />
        <StatusRow label="Mode" value={composerModeLabel(props.mode)} />
      </StatusSection>

      <StatusSection title="Context">
        <StatusRow label="Tokens" value={contextTokens() > 0 ? `${contextTokens().toLocaleString()} est` : '-'} />
        <StatusRow label="Usage" value="-" />
        <StatusRow label="Cost" value="$0.00" />
      </StatusSection>

      <StatusSection title="Workspace">
        <StatusRow label="Path" value={props.state.project.workspacePath || props.state.targetPath || '-'} />
        <StatusRow label="API" value={props.state.mode === 'remote' ? 'remote API' : 'local API'} />
        <StatusRow label="Backend" value="reachable" valueColor={theme().green} />
        <StatusRow
          label="Local"
          value={props.state.capabilities.localWorkspacesEnabled ? 'enabled' : 'disabled'}
          valueColor={props.state.capabilities.localWorkspacesEnabled ? theme().green : theme().yellow}
        />
      </StatusSection>

      <StatusSection title="Logs">
        <Show when={recentEvents().length > 0} fallback={<text fg={theme().muted}>-</text>}>
          <For each={recentEvents()}>
            {(event) => (
              <box style={{ flexDirection: 'column', marginBottom: 1 }}>
                <text fg={theme().muted}>{event.time}</text>
                <text fg={eventColor(event, theme())} wrapMode="word">
                  {formatEvent(event)}
                </text>
              </box>
            )}
          </For>
        </Show>
      </StatusSection>
    </scrollbox>
  );
}

function StatusSection(props: { title: string; children: JSX.Element }) {
  const theme = useTheme();
  return (
    <box style={{ flexDirection: 'column', marginBottom: 1 }}>
      <text fg={theme().muted}>{props.title}</text>
      {props.children}
    </box>
  );
}

function StatusRow(props: { label: string; value: string; valueColor?: string }) {
  const theme = useTheme();
  return (
    <box style={{ flexDirection: 'row', minWidth: 0 }}>
      <text fg={theme().muted} style={{ width: 9, flexShrink: 0 }}>
        {props.label}
      </text>
      <text fg={props.valueColor ?? theme().text} wrapMode="word" style={{ flexGrow: 1, minWidth: 0 }}>
        {props.value || '-'}
      </text>
    </box>
  );
}

function deriveTaskStatus(state: WorkspaceState, busy: boolean): TaskStatus {
  const events = state.events.filter(isHighLevelEvent);
  const latest = events[0];
  const latestAgentStatus = events
    .filter((event) => event.type === 'agent_status')
    .map((event) => eventString(event, 'status'))
    .find((status): status is string => Boolean(status));

  if (state.error.trim() || isErrorEvent(latest) || (latestAgentStatus && ERROR_AGENT_STATUSES.has(latestAgentStatus))) {
    return 'error';
  }
  if (latest?.type === 'done' || (latestAgentStatus && COMPLETED_AGENT_STATUSES.has(latestAgentStatus))) {
    return 'completed';
  }
  if (busy || state.session.agentActivity || (latestAgentStatus && RUNNING_AGENT_STATUSES.has(latestAgentStatus))) {
    return 'running';
  }
  if (latest?.type === 'model_call_completed') {
    return 'completed';
  }
  if (latest?.type === 'message_created' && eventString(latest, 'role') === 'assistant') {
    return 'completed';
  }
  return 'idle';
}

function estimateContextTokens(messages: Message[]): number {
  return messages.reduce((total, message) => total + Math.ceil((message.content || '').length / 4), 0);
}

function isHighLevelEvent(event: StatusEvent): boolean {
  return HIGH_LEVEL_EVENT_TYPES.has(event.type);
}

function isErrorEvent(event: StatusEvent | undefined): boolean {
  if (!event) return false;
  if (event.type === 'error' || event.type === 'model_call_failed') return true;
  return event.type === 'agent_status' && ERROR_AGENT_STATUSES.has(eventString(event, 'status') ?? '');
}

function statusColor(status: TaskStatus, theme: TuiTheme): string {
  if (status === 'completed') return theme.green;
  if (status === 'running') return theme.yellow;
  if (status === 'error') return theme.red;
  return theme.muted;
}

function eventColor(event: StatusEvent, theme: TuiTheme): string {
  if (isErrorEvent(event)) return theme.red;
  if (event.type === 'done' || event.type === 'model_call_completed') return theme.green;
  if (event.type === 'model_call_started') return theme.yellow;
  const status = eventString(event, 'status');
  if (status && COMPLETED_AGENT_STATUSES.has(status)) return theme.green;
  if (status && RUNNING_AGENT_STATUSES.has(status)) return theme.yellow;
  return theme.text;
}

function formatEvent(event: StatusEvent): string {
  if (event.type === 'agent_status') {
    return eventSummary(event, eventString(event, 'status'), eventString(event, 'activity'), eventString(event, 'message'));
  }
  if (event.type === 'message_created') {
    return eventSummary(event, eventString(event, 'role'));
  }
  if (event.type === 'model_call_started' || event.type === 'model_call_completed' || event.type === 'model_call_failed') {
    return eventSummary(
      event,
      eventString(event, 'modelName') ?? eventString(event, 'displayName'),
      eventString(event, 'mode'),
      event.type === 'model_call_failed' ? eventString(event, 'message') : undefined,
    );
  }
  if (event.type === 'error') {
    return eventSummary(event, eventString(event, 'message'));
  }
  return event.type;
}

function eventSummary(event: StatusEvent, ...parts: Array<string | undefined>): string {
  const values = parts.filter((part): part is string => Boolean(part));
  return values.length > 0 ? `${event.type}: ${values.join(' - ')}` : event.type;
}

function eventString(event: StatusEvent, key: string): string | undefined {
  const value = event.data[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function shortId(value: string): string {
  return value.length > 8 ? value.slice(0, 8) : value || '-';
}

function parseNewSessionTitle(value: string): string | undefined {
  const title = value.slice('/new'.length).trim();
  if (!title) return undefined;
  if (title.length < MIN_SESSION_TITLE_LENGTH || title.length > MAX_SESSION_TITLE_LENGTH) {
    throw new Error(`/new title must be ${MIN_SESSION_TITLE_LENGTH}-${MAX_SESSION_TITLE_LENGTH} characters.`);
  }
  return title;
}

function upsertSessionList(
  sessions: WorkspaceState['sessions'],
  session: WorkspaceState['session'],
): WorkspaceState['sessions'] {
  const existing = sessions.some((item) => item.id === session.id);
  return existing ? sessions.map((item) => (item.id === session.id ? session : item)) : [session, ...sessions];
}

function getActiveModelInfo(state: WorkspaceState): ActiveModelInfo {
  const activeModel = state.session.activeModelConfig;
  const activeChoice = state.modelChoices.find((choice) => choice.active);
  const modelName = activeModel?.modelName ?? activeChoice?.modelName ?? 'no model';
  const providerName = activeChoice?.providerName ?? activeModel?.providerId ?? 'no provider';
  const displayName = activeModel?.displayName ?? activeChoice?.displayName ?? 'no display';
  return { modelName, providerDisplay: `${providerName}/${displayName}` };
}

function composerModeAccent(mode: ComposerMode, theme: TuiTheme): string {
  return mode === 'build' ? theme.purple : theme.yellow;
}

function composerModeLabel(mode: ComposerMode): string {
  return mode === 'build' ? 'Build' : 'Plan';
}

function roleColor(role: Message['role'], theme: TuiTheme): string {
  if (role === 'user') return theme.blue;
  if (role === 'assistant') return theme.green;
  if (role === 'tool') return theme.yellow;
  return theme.muted;
}

function themeChoiceName(theme: TuiTheme, currentThemeName: TuiThemeName): string {
  return `${theme.name === currentThemeName ? '* ' : '  '}${theme.label}`;
}

function buildSessionGroups(sessions: Session[], query: string): SessionGroup[] {
  const filteredSessions = sessions.filter((session) => sessionMatches(session, query));
  let index = 0;
  const groups: SessionGroup[] = [];

  for (const session of filteredSessions) {
    const title = sessionGroupTitle(session);
    let group = groups[groups.length - 1];
    if (!group || group.title !== title) {
      group = { title, rows: [] };
      groups.push(group);
    }
    group.rows.push({ session, index: index++ });
  }

  return groups;
}

function flattenSessionGroups(groups: SessionGroup[]): Session[] {
  return groups.flatMap((group) => group.rows.map((row) => row.session));
}

function initialSessionSelectedIndex(sessions: Session[], query: string, currentSessionId: string): number {
  const flatSessions = flattenSessionGroups(buildSessionGroups(sessions, query));
  const currentIndex = flatSessions.findIndex((session) => session.id === currentSessionId);
  return Math.max(currentIndex, 0);
}

function sessionMatches(session: Session, query: string): boolean {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return true;
  return [
    session.title,
    session.id,
    shortId(session.id),
    session.status,
    session.activeModelConfig?.displayName,
    session.activeModelConfig?.modelName,
    session.activeModelConfig?.providerId ?? undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .map(normalizeSearch)
    .some((value) => value.includes(normalizedQuery));
}

function sessionGroupTitle(session: Session): string {
  const date = sessionTimestamp(session);
  if (!date) return 'Unknown date';
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (sameLocalDay(date, today)) return 'Today';
  if (sameLocalDay(date, yesterday)) return 'Yesterday';
  return `${SESSION_WEEKDAYS[date.getDay()]} ${SESSION_MONTHS[date.getMonth()]} ${pad2(date.getDate())} ${date.getFullYear()}`;
}

function formatSessionTime(session: Session): string {
  const date = sessionTimestamp(session);
  if (!date) return '--:--';
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function sessionTimestamp(session: Session): Date | null {
  return parseDate(session.updatedAt) ?? parseDate(session.createdAt);
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function filteredCommandPaletteCommands(query: string): CommandPaletteCommand[] {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return commandPaletteCommands;
  return commandPaletteCommands.filter((command) =>
    [command.label, command.description, command.insert ?? ''].some((value) => normalizeSearch(value).includes(normalizedQuery)),
  );
}

function getSlashQuery(input: string, cursorOffset = input.length): string | null {
  if (!input.startsWith('/')) return null;
  if (/\s/.test(input)) return null;
  const clampedOffset = clamp(cursorOffset, 0, input.length);
  if (clampedOffset === 0) return null;
  return input.slice(1, clampedOffset);
}

function filteredSlashCommandSuggestions(query: string): SlashCommand[] {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return slashCommands;
  const prefixedQuery = `/${normalizedQuery}`;
  return slashCommands.filter((command) =>
    [command.name, ...(command.aliases ?? [])].some((value) => normalizeSearch(value).startsWith(prefixedQuery)),
  );
}

function buildModelChoiceGroups(choices: ModelChoice[], query: string, recentModelKeys: string[]): ModelChoiceGroup[] {
  const filteredChoices = choices.filter((choice) => modelChoiceMatches(choice, query));
  const choicesByKey = new Map(filteredChoices.map((choice) => [modelChoiceKey(choice), choice]));
  const recentChoices = recentModelKeys
    .map((key) => choicesByKey.get(key))
    .filter((choice): choice is ModelChoice => Boolean(choice));
  const recentKeySet = new Set(recentChoices.map(modelChoiceKey));
  let index = 0;
  const groups: ModelChoiceGroup[] = [];

  if (recentChoices.length > 0) {
    groups.push({
      title: 'Recent',
      rows: recentChoices.map((choice) => ({ choice, index: index++ })),
    });
  }

  const providerOrder = uniqueValues(filteredChoices.map((choice) => choice.providerName || choice.providerId || 'Models'));
  for (const providerName of providerOrder) {
    const providerChoices = filteredChoices.filter((choice) => {
      const title = choice.providerName || choice.providerId || 'Models';
      return title === providerName && !recentKeySet.has(modelChoiceKey(choice));
    });
    if (providerChoices.length === 0) continue;
    groups.push({
      title: providerName,
      rows: providerChoices.map((choice) => ({ choice, index: index++ })),
    });
  }

  return groups;
}

function flattenModelGroups(groups: ModelChoiceGroup[]): ModelChoice[] {
  return groups.flatMap((group) => group.rows.map((row) => row.choice));
}

function selectedModelChoice(palette: ModelPaletteState, recentModelKeys: string[]): ModelChoice | undefined {
  return flattenModelGroups(buildModelChoiceGroups(palette.choices, palette.query, recentModelKeys))[palette.selectedIndex];
}

function initialModelSelectedIndex(choices: ModelChoice[], recentModelKeys: string[]): number {
  const flatChoices = flattenModelGroups(buildModelChoiceGroups(choices, '', recentModelKeys));
  const activeIndex = flatChoices.findIndex((choice) => choice.active);
  return Math.max(activeIndex, 0);
}

function initialRecentModelKeys(choices: ModelChoice[]): string[] {
  const activeChoice = choices.find((choice) => choice.active);
  return activeChoice ? [modelChoiceKey(activeChoice)] : [];
}

function modelChoiceMatches(choice: ModelChoice, query: string): boolean {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return true;
  return [choice.modelName, choice.displayName, choice.providerName, choice.providerId, choice.baseUrl]
    .map(normalizeSearch)
    .some((value) => value.includes(normalizedQuery));
}

function modelChoiceKey(choice: ModelChoice): string {
  return `${choice.providerId}::${choice.modelName}`;
}

function modelChoiceTag(choice: ModelChoice): string {
  if (choice.active) return 'current';
  if (choice.isDefault) return 'default';
  if (choice.configured) return 'saved';
  if (choice.requiresApiKey) return 'needs key';
  return 'not configured';
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function moveIndex(currentIndex: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (currentIndex + delta + count) % count;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isEnterKey(name: string): boolean {
  return name === 'return' || name === 'kpenter' || name === 'linefeed' || name === 'enter';
}

function highRiskCommand(command: string): boolean {
  return /\b(rm|del|rmdir|Remove-Item|chmod|chown|mv|move)\b|--recursive|-rf|\/s\b/i.test(command);
}

function isExitCommand(value: string): boolean {
  return value === '/exit' || value === '/quit';
}
