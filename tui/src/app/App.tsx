/** @jsxImportSource @opentui/solid */
import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { attachEventStream, refreshReviewData, type WorkspaceState } from '../bootstrap';
import type { Approval, ApprovalPreview, Message, TreeNode } from '../types';

interface AppProps {
  initialState: WorkspaceState;
}

export function App(props: AppProps) {
  const [state, setState] = createSignal(props.initialState);
  const [input, setInput] = createSignal('');
  const [busy, setBusy] = createSignal(false);
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
    if (approval) return `Approval · ${approval.toolCall.name}`;
    if (state().plan) return `Plan · ${state().plan?.plan.status}`;
    return 'Logs';
  });

  async function submit() {
    const value = input().trim();
    if (!value || busy()) return;
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
    <box style={{ flexDirection: 'column', width: '100%', height: '100%', backgroundColor: '#101418' }}>
      <Header state={state()} busy={busy()} />
      <box style={{ flexDirection: 'row', flexGrow: 1, minHeight: 0 }}>
        <Sidebar state={state()} />
        <ChatPanel messages={state().messages} error={state().error} />
        <RightPanel title={rightTitle()} approval={activeApproval()} state={state()} />
      </box>
      <box border borderColor="#2d3748" style={{ height: 5, paddingX: 1, flexDirection: 'column' }}>
        <text fg="#9ca3af">Type a task, /plan goal, /approve, /reject, /run command, or /open path.</text>
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
    <box style={{ height: 3, paddingX: 1, alignItems: 'center', flexDirection: 'row' }}>
      <text fg="#e5e7eb">Mebius</text>
      <text fg="#64748b"> · {props.state.project.name}</text>
      <text fg="#64748b"> · {props.state.session.title}</text>
      <text fg="#64748b"> · {mode}</text>
      <text fg={props.busy ? '#f59e0b' : '#34d399'}> · {props.busy ? 'busy' : props.state.activity}</text>
    </box>
  );
}

function Sidebar(props: { state: WorkspaceState }) {
  const git = props.state.gitStatus;
  return (
    <box border borderColor="#334155" title="Workspace" style={{ width: 34, paddingX: 1, flexDirection: 'column' }}>
      <text fg="#e2e8f0">{props.state.project.sourceType} · {props.state.project.workspaceMode ?? 'managed'}</text>
      <text fg="#94a3b8">{truncatePath(props.state.project.workspacePath, 32)}</text>
      <Show when={git}>
        <text fg="#94a3b8">
          git {git?.branch ?? '-'} · +{git?.ahead ?? 0}/-{git?.behind ?? 0}
        </text>
        <text fg="#94a3b8">
          staged {git?.counts.staged ?? 0} · changed {git?.counts.unstaged ?? 0} · new {git?.counts.untracked ?? 0}
        </text>
      </Show>
      <text fg="#e2e8f0">Files</text>
      <scrollbox style={{ flexGrow: 1 }}>
        <For each={flattenTree(props.state.tree).slice(0, 80)}>
          {(node) => (
            <text fg={node.type === 'directory' ? '#60a5fa' : '#cbd5e1'}>
              {node.indent}{node.type === 'directory' ? '▸ ' : '  '}{node.path}
            </text>
          )}
        </For>
      </scrollbox>
    </box>
  );
}

function ChatPanel(props: { messages: Message[]; error: string }) {
  return (
    <box border borderColor="#334155" title="Chat" style={{ flexGrow: 1, minWidth: 40, paddingX: 1 }}>
      <scrollbox stickyScroll stickyStart="bottom" style={{ flexGrow: 1 }}>
        <Show when={props.error}>
          <text fg="#f87171">{props.error}</text>
        </Show>
        <For each={props.messages}>
          {(message) => (
            <box style={{ flexDirection: 'column', marginBottom: 1 }}>
              <text fg={roleColor(message.role)}>{message.role}{message.streaming ? ' · streaming' : ''}</text>
              <For each={message.content.split('\n').slice(0, 40)}>
                {(line) => <text fg="#d1d5db">{line || ' '}</text>}
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
    <box border borderColor="#334155" title={props.title} style={{ width: 48, paddingX: 1, flexDirection: 'column' }}>
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
      <text fg="#fbbf24">Pending {props.approval.toolCall.name}</text>
      <text fg="#94a3b8">Type /approve or /reject in the prompt.</text>
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
        <text fg="#fca5a5">Command requires approval</text>
        <text fg="#e5e7eb">{props.preview.command}</text>
        <text fg="#94a3b8">cwd: {props.preview.cwd ?? 'workspace root'}</text>
        <Show when={highRiskCommand(props.preview.command)}>
          <text fg="#f87171">High risk command: review carefully before approving.</text>
        </Show>
      </box>
    );
  }
  const files = props.preview.kind === 'patch' ? [{ path: props.preview.path, diffText: props.preview.diffText }] : props.preview.files;
  return (
    <box style={{ flexDirection: 'column' }}>
      <text fg="#86efac">Patch diff</text>
      <For each={files}>
        {(file) => (
          <box style={{ flexDirection: 'column', marginBottom: 1 }}>
            <text fg="#e5e7eb">{file.path}</text>
            <For each={file.diffText.split('\n').slice(0, 80)}>
              {(line) => <text fg={line.startsWith('+') ? '#86efac' : line.startsWith('-') ? '#fca5a5' : '#cbd5e1'}>{line}</text>}
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
        <text fg="#e5e7eb">Plan: {props.state.plan?.plan.status}</text>
        <text fg="#94a3b8">{props.state.plan?.plan.summary}</text>
      </Show>
      <For each={props.state.commandRuns.slice(0, 8)}>
        {(run) => <text fg="#cbd5e1">{run.status} · {run.command}</text>}
      </For>
      <For each={props.state.events.slice(0, 30)}>
        {(event) => <text fg="#94a3b8">{event.time} · {event.type}</text>}
      </For>
    </scrollbox>
  );
}

function flattenTree(nodes: TreeNode[], depth = 0): Array<TreeNode & { indent: string }> {
  return nodes.flatMap((node) => [
    { ...node, indent: '  '.repeat(depth) },
    ...(node.type === 'directory' ? flattenTree(node.children ?? [], depth + 1) : []),
  ]);
}

function roleColor(role: Message['role']): string {
  if (role === 'user') return '#93c5fd';
  if (role === 'assistant') return '#86efac';
  if (role === 'tool') return '#fbbf24';
  return '#94a3b8';
}

function highRiskCommand(command: string): boolean {
  return /\b(rm|del|rmdir|Remove-Item|chmod|chown|mv|move)\b|--recursive|-rf|\/s\b/i.test(command);
}

function truncatePath(path: string, maxLength: number): string {
  if (path.length <= maxLength) return path;
  return `...${path.slice(path.length - maxLength + 3)}`;
}
