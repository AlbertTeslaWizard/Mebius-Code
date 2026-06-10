/** @jsxImportSource @opentui/solid */
import { For, Show, createMemo } from 'solid-js';
import type { Approval } from '../types';
import type { TuiTheme } from './theme';

export type ApprovalChoice = 'allow_once' | 'allow_always' | 'reject';

export const APPROVAL_INLINE_PANEL_HEIGHT = 8;

const APPROVAL_CHOICES: Array<{ id: ApprovalChoice; label: string; width: number }> = [
  { id: 'allow_once', label: 'Allow once', width: 16 },
  { id: 'allow_always', label: 'Allow always', width: 18 },
  { id: 'reject', label: 'Reject', width: 12 },
];

interface ApprovalDetails {
  title: string;
  primary?: { label?: string; value: string };
  secondary?: { label?: string; value: string };
}

export function ApprovalInlinePanel(props: {
  approval: Approval;
  selectedChoice: ApprovalChoice;
  busy: boolean;
  theme: TuiTheme;
  onSelectChoice: (choice: ApprovalChoice) => void;
  onAllowOnce: () => void;
  onAllowAlways: () => void;
  onReject: () => void;
}) {
  const details = createMemo(() => buildApprovalDetails(props.approval));

  function choose(choice: ApprovalChoice) {
    if (props.busy) return;
    props.onSelectChoice(choice);
    if (choice === 'allow_once') {
      props.onAllowOnce();
      return;
    }
    if (choice === 'allow_always') {
      props.onAllowAlways();
      return;
    }
    props.onReject();
  }

  return (
    <box
      border
      borderStyle="rounded"
      borderColor={props.theme.yellow}
      focusedBorderColor={props.theme.yellow}
      style={{
        width: '100%',
        height: APPROVAL_INLINE_PANEL_HEIGHT,
        minHeight: APPROVAL_INLINE_PANEL_HEIGHT,
        minWidth: 0,
        flexShrink: 0,
        alignSelf: 'stretch',
        flexDirection: 'row',
        backgroundColor: props.theme.input,
      }}
    >
      <box style={{ width: 1, flexShrink: 0, alignSelf: 'stretch', backgroundColor: props.theme.yellow }} />
      <box style={{ width: '100%', flexGrow: 1, minWidth: 0, paddingX: 1, flexDirection: 'column' }}>
        <box style={{ width: '100%', height: 1, minHeight: 1, flexDirection: 'row' }}>
          <text fg={props.theme.yellow}>△ Permission required</text>
          <Show when={props.busy}>
            <text fg={props.theme.muted}> - working...</text>
          </Show>
        </box>
        <text fg={props.theme.text} truncate style={{ width: '100%', height: 1, minHeight: 1 }}>
          ↳ {details().title}
        </text>
        <DetailLine detail={details().primary} theme={props.theme} />
        <DetailLine detail={details().secondary} theme={props.theme} />
        <box style={{ width: '100%', height: 1, minHeight: 1, flexDirection: 'row', marginTop: 1 }}>
          <For each={APPROVAL_CHOICES}>
            {(choice) => {
              const selected = createMemo(() => props.selectedChoice === choice.id);
              return (
                <box
                  style={{
                    width: choice.width,
                    height: 1,
                    minHeight: 1,
                    flexShrink: 0,
                    paddingX: 1,
                    backgroundColor: selected() ? props.theme.selection : props.theme.input,
                  }}
                  onMouseDown={() => choose(choice.id)}
                >
                  <text fg={selected() ? props.theme.text : props.theme.muted} truncate>
                    {selected() ? `[ ${choice.label} ]` : choice.label}
                  </text>
                </box>
              );
            }}
          </For>
        </box>
        <text fg={props.theme.muted} style={{ width: '100%', height: 1, minHeight: 1 }}>
          ←/→ select   enter confirm
        </text>
      </box>
    </box>
  );
}

function DetailLine(props: { detail: { label?: string; value: string } | undefined; theme: TuiTheme }) {
  return (
    <box style={{ width: '100%', height: 1, minHeight: 1, flexDirection: 'row' }}>
      <Show when={props.detail} fallback={<text> </text>}>
        {(detail) => (
          <>
            <Show when={detail().label}>
              {(label) => <text fg={props.theme.muted}>{label()}: </text>}
            </Show>
            <text fg={props.theme.text} truncate style={{ flexGrow: 1, minWidth: 0 }}>
              {detail().value}
            </text>
          </>
        )}
      </Show>
    </box>
  );
}

function buildApprovalDetails(approval: Approval): ApprovalDetails {
  const preview = approval.preview;
  if (preview?.kind === 'command') {
    return {
      title: 'Run command',
      primary: { value: preview.command },
      secondary: { label: 'cwd', value: preview.cwd ?? 'workspace root' },
    };
  }
  if (preview?.kind === 'patch') {
    return {
      title: 'Create patch',
      primary: { label: 'Path', value: preview.path },
      secondary: preview.truncated ? { label: 'Diff', value: 'preview truncated' } : undefined,
    };
  }
  if (preview?.kind === 'patch_set') {
    const paths = preview.files.map((file) => file.path);
    return {
      title: 'Create patch',
      primary: { label: paths.length === 1 ? 'Path' : 'Paths', value: summarizePaths(paths) },
      secondary: {
        label: 'Diff',
        value: `${preview.files.length} file${preview.files.length === 1 ? '' : 's'}${preview.truncated ? ', preview truncated' : ''}`,
      },
    };
  }

  const name = approval.toolCall.name;
  const args = approval.toolCall.arguments;
  if (name === 'run_command') {
    return {
      title: 'Run command',
      primary: { value: stringArg(args, 'command') ?? '(command unavailable)' },
      secondary: { label: 'cwd', value: stringArg(args, 'cwd') ?? 'workspace root' },
    };
  }
  if (name === 'create_patch') {
    const paths = patchArgumentPaths(args);
    return {
      title: 'Create patch',
      primary: { label: paths.length === 1 ? 'Path' : 'Paths', value: summarizePaths(paths) },
    };
  }
  if (name === 'read_file' || name === 'read' || name === 'list_files') {
    return {
      title: name === 'list_files' ? 'Read' : 'Read',
      primary: { label: 'Path', value: stringArg(args, 'path') ?? '.' },
    };
  }
  if (name === 'search_text') {
    return {
      title: 'Search',
      primary: { label: 'Query', value: stringArg(args, 'query') ?? '(query unavailable)' },
      secondary: { label: 'Path', value: stringArg(args, 'path') ?? '.' },
    };
  }

  return {
    title: humanizeToolName(name),
    primary: { label: 'Tool', value: name },
  };
}

function patchArgumentPaths(args: Record<string, unknown>): string[] {
  const path = stringArg(args, 'path');
  if (path) return [path];
  const files = Array.isArray(args.files) ? args.files : [];
  const paths = files
    .map((item) => (item && typeof item === 'object' ? stringArg(item as Record<string, unknown>, 'path') : undefined))
    .filter((value): value is string => Boolean(value));
  return paths.length > 0 ? paths : ['(path unavailable)'];
}

function summarizePaths(paths: string[]): string {
  if (paths.length <= 3) return paths.join(', ');
  return `${paths.slice(0, 3).join(', ')} +${paths.length - 3}`;
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function humanizeToolName(name: string): string {
  return name
    .split('_')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ') || 'Tool call';
}
