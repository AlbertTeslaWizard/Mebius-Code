/** @jsxImportSource @opentui/solid */
import { SyntaxStyle } from '@opentui/core';
import { useKeyboard, useRenderer } from '@opentui/solid';
import { For, Show, createContext, createMemo, createSignal, onCleanup, onMount, useContext } from 'solid-js';
import type { Accessor, JSX } from 'solid-js';
import { attachEventStream, refreshReviewData, type WorkspaceState } from '../bootstrap';
import { saveConfig } from '../config';
import type { Approval, ApprovalPreview, Message, ModelChoice, ModelsCommandResult, TuiThemeName } from '../types';
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
}

interface ThemePaletteState {
  selectedIndex: number;
}

interface CommandPaletteCommand {
  label: string;
  insert: string;
  description: string;
}

const commandPaletteCommands: CommandPaletteCommand[] = [
  { label: '/models', insert: '/models', description: 'Choose or configure a model' },
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

const RIGHT_RAIL_WIDTH = 32;
const MAIN_COLUMN_MIN_WIDTH = 48;
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

type TaskStatus = 'idle' | 'running' | 'completed' | 'error';
type StatusEvent = WorkspaceState['events'][number];

export function App(props: AppProps) {
  const [state, setState] = createSignal(props.initialState);
  const [input, setInput] = createSignal('');
  const [composerMode, setComposerMode] = createSignal<ComposerMode>('build');
  const [themeName, setThemeName] = createSignal<TuiThemeName>(
    resolveTuiThemeName(props.initialState.config.preferences?.theme),
  );
  const [busy, setBusy] = createSignal(false);
  const [modelPalette, setModelPalette] = createSignal<ModelPaletteState | null>(null);
  const [commandPalette, setCommandPalette] = createSignal<CommandPaletteState | null>(null);
  const [themePalette, setThemePalette] = createSignal<ThemePaletteState | null>(null);
  const renderer = useRenderer();
  const abort = new AbortController();

  onMount(() => {
    const token = props.initialState.config.accessToken;
    if (token) {
      attachEventStream({
        state,
        setState: (updater) => setState(updater),
        token,
        abortSignal: abort.signal,
      });
    }
  });

  onCleanup(() => abort.abort());

  const activeApproval = createMemo(() => state().approvals[0]);
  const activeModelInfo = createMemo(() => getActiveModelInfo(state()));
  const theme = createMemo(() => getTuiTheme(themeName()));
  const composerAccentColor = createMemo(() => composerModeAccent(composerMode(), theme()));
  const rightTitle = createMemo(() => {
    const approval = activeApproval();
    if (approval) return `Approval - ${approval.toolCall.name}`;
    return 'Status';
  });

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
    }

    if (name === 'tab' && !modelPalette() && !commandPalette() && !themePalette()) {
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
    setCommandPalette({ selectedIndex: 0 });
  }

  function chooseCommand(command: CommandPaletteCommand) {
    setInput(command.insert);
    setCommandPalette(null);
  }

  function openThemePalette() {
    setCommandPalette(null);
    setModelPalette(null);
    const selectedIndex = Math.max(
      tuiThemeList.findIndex((item) => item.name === themeName()),
      0,
    );
    setThemePalette({ selectedIndex });
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
    abort.abort();
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
      const choices = await current.api.listModels(current.session.id);
      setState((prev) => ({ ...prev, modelChoices: choices }));
      setModelPalette({
        step: 'list',
        choices,
        selectedIndex: Math.max(choices.findIndex((choice) => choice.active), 0),
        apiKey: '',
      });
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
      <Show
        when={commandPalette()}
        fallback={
          <Show
            when={themePalette()}
            fallback={
              <Show
                when={modelPalette()}
                fallback={
                  <box style={{ flexDirection: 'row', flexGrow: 1, minHeight: 0 }}>
                    <ChatPanel messages={state().messages} error={state().error} />
                    <RightPanel
                      title={rightTitle()}
                      approval={activeApproval()}
                      state={state()}
                      mode={composerMode()}
                      busy={busy()}
                    />
                  </box>
                }
              >
                {(palette) => (
                  <ModelsPanel
                    palette={palette()}
                    busy={busy()}
                    onClose={() => setModelPalette(null)}
                    onSelectedIndex={(selectedIndex) =>
                      setModelPalette((current) => (current ? { ...current, selectedIndex } : current))
                    }
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
            }
          >
            {(palette) => (
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
            )}
          </Show>
        }
      >
        {(palette) => (
          <CommandPalette
            palette={palette()}
            onClose={() => setCommandPalette(null)}
            onSelectedIndex={(selectedIndex) =>
              setCommandPalette((current) => (current ? { ...current, selectedIndex } : current))
            }
            onChoose={chooseCommand}
          />
        )}
      </Show>
      <box style={{ height: 4, flexDirection: 'row', backgroundColor: theme().background }}>
        <Composer
          mode={composerMode()}
          accentColor={composerAccentColor()}
          modelInfo={activeModelInfo()}
          value={input()}
          focused={!modelPalette() && !commandPalette() && !themePalette()}
          onInput={setInput}
          onSubmit={() => {
            void submit();
          }}
        />
        <box
          style={{
            width: RIGHT_RAIL_WIDTH,
            flexShrink: 0,
          }}
        />
      </box>
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
  onSelectedIndex: (index: number) => void;
  onChoose: (command: CommandPaletteCommand) => void;
}) {
  const theme = useTheme();
  return (
    <box
      border
      borderColor={theme().blue}
      title="Commands"
      style={{ flexGrow: 1, minHeight: 0, paddingX: 2, paddingY: 1, flexDirection: 'column', backgroundColor: theme().panel }}
      onKeyDown={(event) => {
        if (event.name === 'escape') {
          props.onClose();
        }
      }}
    >
      <select
        focused
        options={commandPaletteCommands.map((command) => ({
          name: command.label,
          description: command.description,
          value: command,
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
          const command = option?.value as CommandPaletteCommand | undefined;
          if (command) props.onChoose(command);
        }}
        onKeyDown={(event) => {
          if (event.name === 'escape') {
            props.onClose();
          }
        }}
      />
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
      border
      borderColor={theme().border}
      title="Themes"
      style={{ flexGrow: 1, minHeight: 0, paddingX: 2, paddingY: 1, flexDirection: 'column', backgroundColor: theme().panel }}
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
  onSubmit: () => void;
}) {
  const theme = useTheme();
  return (
    <box
      border
      borderStyle="rounded"
      borderColor={theme().border}
      focusedBorderColor={theme().border}
      style={{
        height: 4,
        flexGrow: 1,
        minWidth: MAIN_COLUMN_MIN_WIDTH,
        flexDirection: 'row',
        backgroundColor: theme().input,
      }}
    >
      <box style={{ width: 1, flexShrink: 0, alignSelf: 'stretch', backgroundColor: props.accentColor }} />
      <box style={{ flexGrow: 1, minWidth: 0, paddingX: 1, flexDirection: 'column' }}>
        <input
          focused={props.focused}
          value={props.value}
          placeholder=""
          style={{ width: '100%', flexShrink: 0 }}
          onInput={props.onInput}
          onSubmit={props.onSubmit}
        />
        <box style={{ height: 1, flexDirection: 'row' }}>
          <text fg={props.accentColor}>{composerModeLabel(props.mode)}</text>
          <text fg={theme().muted}> · {props.modelInfo.modelName} · {props.modelInfo.providerDisplay}</text>
        </box>
      </box>
    </box>
  );
}

function ModelsPanel(props: {
  palette: ModelPaletteState;
  busy: boolean;
  onClose: () => void;
  onSelectedIndex: (index: number) => void;
  onChoose: (choice: ModelChoice) => void;
  onApiKeyInput: (apiKey: string) => void;
  onSubmitApiKey: () => void;
}) {
  const theme = useTheme();
  return (
    <box
      border
      borderColor={theme().border}
      title="Models"
      style={{ flexGrow: 1, minHeight: 0, paddingX: 2, paddingY: 1, flexDirection: 'column', backgroundColor: theme().panel }}
      onKeyDown={(event) => {
        if (event.name === 'escape') {
          props.onClose();
        }
      }}
    >
      <text fg={theme().text}>DeepSeek models</text>
      <text fg={theme().muted}>Enter selects. Existing provider keys are reused. Esc closes.</text>
      <Show when={props.palette.error}>
        <text fg={theme().red}>{props.palette.error}</text>
      </Show>
      <Show
        when={props.palette.step === 'apiKey'}
        fallback={
          <box style={{ flexDirection: 'column', flexGrow: 1, minHeight: 0, marginTop: 1 }}>
            <select
              focused
              options={props.palette.choices.map((choice) => ({
                name: modelChoiceName(choice),
                description: modelChoiceDescription(choice),
                value: choice,
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
                const choice = option?.value as ModelChoice | undefined;
                if (choice) props.onChoose(choice);
              }}
              onKeyDown={(event) => {
                if (event.name === 'escape') {
                  props.onClose();
                }
              }}
            />
          </box>
        }
      >
        <box style={{ flexDirection: 'column', marginTop: 1 }}>
          <text fg={theme().yellow}>API key required for {props.palette.pendingChoice?.modelName}</text>
          <text fg={theme().muted}>The key is sent to the backend model config store and is not added to chat.</text>
          <input
            focused
            value={props.palette.apiKey}
            placeholder="DeepSeek API Key"
            onInput={props.onApiKeyInput}
            onSubmit={props.onSubmitApiKey}
            onKeyDown={(event) => {
              if (event.name === 'escape') {
                props.onClose();
              }
            }}
          />
          <text fg={props.busy ? theme().yellow : theme().muted}>
            {props.busy ? 'Validating key...' : 'Press Enter to save and switch.'}
          </text>
        </box>
      </Show>
    </box>
  );
}

function ChatPanel(props: { messages: Message[]; error: string }) {
  const theme = useTheme();
  return (
    <box border borderColor={theme().border} title="Chat" style={{ flexGrow: 1, minWidth: MAIN_COLUMN_MIN_WIDTH, paddingX: 1, backgroundColor: theme().panel }}>
      <scrollbox stickyScroll stickyStart="bottom" style={{ flexGrow: 1, minHeight: 0, width: '100%' }}>
        <Show when={props.error}>
          <text fg={theme().red}>{props.error}</text>
        </Show>
        <For each={props.messages}>
          {(message) => <MessageBlock message={message} />}
        </For>
      </scrollbox>
    </box>
  );
}

function MessageBlock(props: { message: Message }) {
  const theme = useTheme();
  return (
    <box
      style={{
        width: '100%',
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'stretch',
        marginBottom: 1,
        backgroundColor: theme().background,
      }}
    >
      <box style={{ width: 1, flexShrink: 0, alignSelf: 'stretch', backgroundColor: roleColor(props.message.role, theme()) }} />
      <box style={{ flexGrow: 1, minWidth: 0, paddingX: 1, flexDirection: 'column' }}>
        <text fg={roleColor(props.message.role, theme())} style={{ width: '100%', flexShrink: 0 }}>
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

function modelChoiceName(choice: ModelChoice): string {
  const active = choice.active ? '* ' : '  ';
  const configured = choice.configured ? 'saved' : choice.requiresApiKey ? 'needs key' : 'uses saved key';
  return `${active}${choice.modelName} (${configured})`;
}

function modelChoiceDescription(choice: ModelChoice): string {
  const status = choice.isDefault ? 'default' : choice.active ? 'current' : choice.configured ? 'configured' : 'not configured';
  return `${choice.providerName} - ${status} - ${choice.baseUrl}`;
}

function highRiskCommand(command: string): boolean {
  return /\b(rm|del|rmdir|Remove-Item|chmod|chown|mv|move)\b|--recursive|-rf|\/s\b/i.test(command);
}

function isExitCommand(value: string): boolean {
  return value === '/exit' || value === '/quit';
}
