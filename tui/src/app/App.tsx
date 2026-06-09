/** @jsxImportSource @opentui/solid */
import { SyntaxStyle } from '@opentui/core';
import { useRenderer } from '@opentui/solid';
import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { attachEventStream, refreshReviewData, type WorkspaceState } from '../bootstrap';
import type { Approval, ApprovalPreview, Message, ModelChoice, ModelsCommandResult } from '../types';
import { oneDark } from './theme';

const messageMarkdownStyle = SyntaxStyle.create();
messageMarkdownStyle.registerStyle('default', { fg: oneDark.text });
messageMarkdownStyle.registerStyle('markup.heading', { fg: oneDark.blue, bold: true });
messageMarkdownStyle.registerStyle('markup.strong', { fg: oneDark.text, bold: true });
messageMarkdownStyle.registerStyle('markup.italic', { fg: oneDark.text, italic: true });
messageMarkdownStyle.registerStyle('markup.raw', { fg: oneDark.green });
messageMarkdownStyle.registerStyle('markup.link', { fg: oneDark.blue, underline: true });
messageMarkdownStyle.registerStyle('markup.link.label', { fg: oneDark.blue, underline: true });
messageMarkdownStyle.registerStyle('markup.link.url', { fg: oneDark.purple, underline: true });
messageMarkdownStyle.registerStyle('markup.quote', { fg: oneDark.muted, dim: true });
messageMarkdownStyle.registerStyle('markup.list', { fg: oneDark.yellow });
messageMarkdownStyle.registerStyle('conceal', { fg: oneDark.muted, dim: true });

const markdownTableOptions = {
  style: 'grid',
  widthMode: 'full',
  wrapMode: 'word',
  cellPaddingX: 1,
  borderColor: oneDark.border,
} as const;

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

export function App(props: AppProps) {
  const [state, setState] = createSignal(props.initialState);
  const [input, setInput] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [modelPalette, setModelPalette] = createSignal<ModelPaletteState | null>(null);
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
  const rightTitle = createMemo(() => {
    const approval = activeApproval();
    if (approval) return `Approval - ${approval.toolCall.name}`;
    if (state().plan) return `Plan - ${state().plan?.plan.status}`;
    return 'Logs';
  });

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
      await handleCommand(value);
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
    if (value.startsWith('/plan ')) {
      const plan = await current.api.createPlan(current.session.id, value.slice('/plan '.length));
      setState((prev) => ({ ...prev, plan }));
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
    if (value === '/model' || value.startsWith('/model ') || value === '/connect' || value.startsWith('/connect ')) {
      throw new Error('Use /models to choose or configure a model in the TUI.');
    }

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
    <box style={{ flexDirection: 'column', width: '100%', height: '100%', backgroundColor: oneDark.background }}>
      <Header state={state()} busy={busy()} />
      <Show
        when={modelPalette()}
        fallback={
          <box style={{ flexDirection: 'row', flexGrow: 1, minHeight: 0 }}>
            <ChatPanel messages={state().messages} error={state().error} />
            <RightPanel title={rightTitle()} approval={activeApproval()} state={state()} />
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
      <box border borderColor={oneDark.border} style={{ height: 5, paddingX: 1, flexDirection: 'column', backgroundColor: oneDark.input }}>
        <text fg={oneDark.muted}>Type a task, /models, /plan goal, /approve, /reject, /run command, /open path, or /exit.</text>
        <input
          focused={!modelPalette()}
          value={input()}
          placeholder="Ask Mebius to work on this repository..."
          onInput={(value) => setInput(value)}
          onSubmit={() => {
            void submit();
          }}
        />
      </box>
    </box>
  );
}

function Header(props: { state: WorkspaceState; busy: boolean }) {
  const mode = props.state.mode === 'remote' ? 'remote API' : 'local API';
  const modelName =
    props.state.session.activeModelConfig?.modelName ??
    props.state.modelChoices.find((choice) => choice.active)?.modelName ??
    'no model';
  return (
    <box style={{ height: 3, paddingX: 1, alignItems: 'center', flexDirection: 'row', backgroundColor: oneDark.background }}>
      <text fg={oneDark.text}>Mebius</text>
      <text fg={oneDark.muted}> - {props.state.project.name}</text>
      <text fg={oneDark.muted}> - {props.state.session.title}</text>
      <text fg={oneDark.muted}> - {modelName}</text>
      <text fg={oneDark.muted}> - {mode}</text>
      <text fg={props.busy ? oneDark.yellow : oneDark.green}> - {props.busy ? 'busy' : props.state.activity}</text>
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
  return (
    <box
      border
      borderColor={oneDark.border}
      title="Models"
      style={{ flexGrow: 1, minHeight: 0, paddingX: 2, paddingY: 1, flexDirection: 'column', backgroundColor: oneDark.panel }}
      onKeyDown={(event) => {
        if (event.name === 'escape') {
          props.onClose();
        }
      }}
    >
      <text fg={oneDark.text}>DeepSeek models</text>
      <text fg={oneDark.muted}>Enter selects. Existing provider keys are reused. Esc closes.</text>
      <Show when={props.palette.error}>
        <text fg={oneDark.red}>{props.palette.error}</text>
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
              backgroundColor={oneDark.panel}
              textColor={oneDark.text}
              selectedBackgroundColor={oneDark.selection}
              selectedTextColor={oneDark.text}
              descriptionColor={oneDark.muted}
              selectedDescriptionColor={oneDark.text}
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
          <text fg={oneDark.yellow}>API key required for {props.palette.pendingChoice?.modelName}</text>
          <text fg={oneDark.muted}>The key is sent to the backend model config store and is not added to chat.</text>
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
          <text fg={props.busy ? oneDark.yellow : oneDark.muted}>
            {props.busy ? 'Validating key...' : 'Press Enter to save and switch.'}
          </text>
        </box>
      </Show>
    </box>
  );
}

function ChatPanel(props: { messages: Message[]; error: string }) {
  return (
    <box border borderColor={oneDark.border} title="Chat" style={{ flexGrow: 1, minWidth: 40, paddingX: 1, backgroundColor: oneDark.panel }}>
      <scrollbox stickyScroll stickyStart="bottom" style={{ flexGrow: 1, minHeight: 0 }}>
        <Show when={props.error}>
          <text fg={oneDark.red}>{props.error}</text>
        </Show>
        <For each={props.messages}>
          {(message) => (
            <box style={{ flexDirection: 'column', width: '100%', marginBottom: 1 }}>
              <text fg={roleColor(message.role)}>{message.role}{message.streaming ? ' - streaming' : ''}</text>
              <MessageBody message={message} />
            </box>
          )}
        </For>
      </scrollbox>
    </box>
  );
}

function MessageBody(props: { message: Message }) {
  if (props.message.role === 'assistant' || props.message.role === 'system') {
    return (
      <markdown
        content={props.message.content || ' '}
        syntaxStyle={messageMarkdownStyle}
        fg={oneDark.text}
        conceal={true}
        concealCode={false}
        streaming={props.message.streaming ?? false}
        internalBlockMode="top-level"
        tableOptions={markdownTableOptions}
        style={{ width: '100%', flexShrink: 0 }}
      />
    );
  }

  return (
    <text fg={oneDark.text} wrapMode="word" style={{ width: '100%', flexShrink: 0 }}>
      {props.message.content || ' '}
    </text>
  );
}

function RightPanel(props: { title: string; approval: Approval | undefined; state: WorkspaceState }) {
  return (
    <box border borderColor={oneDark.border} title={props.title} style={{ width: 48, paddingX: 1, flexDirection: 'column', backgroundColor: oneDark.panel }}>
      <Show when={props.approval} fallback={<Logs state={props.state} />}>
        {(approval) => <ApprovalView approval={approval()} />}
      </Show>
    </box>
  );
}

function ApprovalView(props: { approval: Approval }) {
  const preview = props.approval.preview;
  return (
    <scrollbox style={{ flexGrow: 1 }}>
      <text fg={oneDark.yellow}>Pending {props.approval.toolCall.name}</text>
      <text fg={oneDark.muted}>Type /approve or /reject in the prompt.</text>
      <Show when={preview}>
        {(value) => <Preview preview={value()} />}
      </Show>
    </scrollbox>
  );
}

function Preview(props: { preview: ApprovalPreview }) {
  if (props.preview.kind === 'command') {
    return (
      <box style={{ flexDirection: 'column' }}>
        <text fg={oneDark.softRed}>Command requires approval</text>
        <text fg={oneDark.text}>{props.preview.command}</text>
        <text fg={oneDark.muted}>cwd: {props.preview.cwd ?? 'workspace root'}</text>
        <Show when={highRiskCommand(props.preview.command)}>
          <text fg={oneDark.red}>High risk command: review carefully before approving.</text>
        </Show>
      </box>
    );
  }
  const files = props.preview.kind === 'patch' ? [{ path: props.preview.path, diffText: props.preview.diffText }] : props.preview.files;
  return (
    <box style={{ flexDirection: 'column' }}>
      <text fg={oneDark.green}>Patch diff</text>
      <For each={files}>
        {(file) => (
          <box style={{ flexDirection: 'column', marginBottom: 1 }}>
            <text fg={oneDark.text}>{file.path}</text>
            <For each={file.diffText.split('\n').slice(0, 80)}>
              {(line) => <text fg={line.startsWith('+') ? oneDark.green : line.startsWith('-') ? oneDark.softRed : oneDark.text}>{line}</text>}
            </For>
          </box>
        )}
      </For>
    </box>
  );
}

function Logs(props: { state: WorkspaceState }) {
  return (
    <scrollbox style={{ flexGrow: 1 }}>
      <Show when={props.state.plan}>
        <text fg={oneDark.text}>Plan: {props.state.plan?.plan.status}</text>
        <text fg={oneDark.muted}>{props.state.plan?.plan.summary}</text>
      </Show>
      <For each={props.state.commandRuns.slice(0, 8)}>
        {(run) => <text fg={oneDark.text}>{run.status} - {run.command}</text>}
      </For>
      <For each={props.state.events.slice(0, 30)}>
        {(event) => <text fg={oneDark.muted}>{event.time} - {event.type}</text>}
      </For>
    </scrollbox>
  );
}

function roleColor(role: Message['role']): string {
  if (role === 'user') return oneDark.blue;
  if (role === 'assistant') return oneDark.green;
  if (role === 'tool') return oneDark.yellow;
  return oneDark.muted;
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
