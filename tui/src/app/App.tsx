/** @jsxImportSource @opentui/solid */
import { useRenderer } from '@opentui/solid';
import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { attachEventStream, refreshReviewData, type WorkspaceState } from '../bootstrap';
import type { Approval, ApprovalPreview, Message } from '../types';
import { oneDark } from './theme';

interface AppProps {
  initialState: WorkspaceState;
}

export function App(props: AppProps) {
  const [state, setState] = createSignal(props.initialState);
  const [input, setInput] = createSignal('');
  const [busy, setBusy] = createSignal(false);
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

  return (
    <box style={{ flexDirection: 'column', width: '100%', height: '100%', backgroundColor: oneDark.background }}>
      <Header state={state()} busy={busy()} />
      <box style={{ flexDirection: 'row', flexGrow: 1, minHeight: 0 }}>
        <ChatPanel messages={state().messages} error={state().error} />
        <RightPanel title={rightTitle()} approval={activeApproval()} state={state()} />
      </box>
      <box border borderColor={oneDark.border} style={{ height: 5, paddingX: 1, flexDirection: 'column', backgroundColor: oneDark.input }}>
        <text fg={oneDark.muted}>Type a task, /plan goal, /approve, /reject, /run command, /open path, or /exit.</text>
        <input
          focused
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
  return (
    <box style={{ height: 3, paddingX: 1, alignItems: 'center', flexDirection: 'row', backgroundColor: oneDark.background }}>
      <text fg={oneDark.text}>Mebius</text>
      <text fg={oneDark.muted}> - {props.state.project.name}</text>
      <text fg={oneDark.muted}> - {props.state.session.title}</text>
      <text fg={oneDark.muted}> - {mode}</text>
      <text fg={props.busy ? oneDark.yellow : oneDark.green}> - {props.busy ? 'busy' : props.state.activity}</text>
    </box>
  );
}

function ChatPanel(props: { messages: Message[]; error: string }) {
  return (
    <box border borderColor={oneDark.border} title="Chat" style={{ flexGrow: 1, minWidth: 40, paddingX: 1, backgroundColor: oneDark.panel }}>
      <scrollbox stickyScroll stickyStart="bottom" style={{ flexGrow: 1 }}>
        <Show when={props.error}>
          <text fg={oneDark.red}>{props.error}</text>
        </Show>
        <For each={props.messages}>
          {(message) => (
            <box style={{ flexDirection: 'column', marginBottom: 1 }}>
              <text fg={roleColor(message.role)}>{message.role}{message.streaming ? ' - streaming' : ''}</text>
              <For each={message.content.split('\n').slice(0, 40)}>
                {(line) => <text fg={oneDark.text}>{line || ' '}</text>}
              </For>
            </box>
          )}
        </For>
      </scrollbox>
    </box>
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

function highRiskCommand(command: string): boolean {
  return /\b(rm|del|rmdir|Remove-Item|chmod|chown|mv|move)\b|--recursive|-rf|\/s\b/i.test(command);
}

function isExitCommand(value: string): boolean {
  return value === '/exit' || value === '/quit';
}
