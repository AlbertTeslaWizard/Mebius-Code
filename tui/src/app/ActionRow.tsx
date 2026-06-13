/** @jsxImportSource @opentui/solid */
import { For, createMemo } from 'solid-js';
import type { TuiTheme } from './theme';

export interface TuiAction<T extends string = string> {
  id: T;
  label: string;
  width: number;
  tone?: 'default' | 'danger';
}

export function ActionRow<T extends string>(props: {
  actions: readonly TuiAction<T>[];
  selectedId: T;
  busy: boolean;
  theme: TuiTheme;
  accentColor: string;
  onSelect: (id: T) => void;
  onConfirm: (id: T) => void;
}) {
  function choose(actionId: T) {
    if (props.busy) return;
    props.onSelect(actionId);
    props.onConfirm(actionId);
  }

  return (
    <box style={{ width: '100%', height: 1, minHeight: 1, flexDirection: 'row', marginTop: 1 }}>
      <For each={props.actions}>
        {(action) => {
          const selected = createMemo(() => props.selectedId === action.id);
          const toneColor = createMemo(() => (action.tone === 'danger' ? props.theme.softRed : props.accentColor));
          const textColor = createMemo(() => {
            if (props.busy) return props.theme.muted;
            if (selected()) return props.theme.text;
            if (action.tone === 'danger') return props.theme.softRed;
            return props.theme.muted;
          });
          return (
            <box
              style={{
                width: action.width,
                height: 1,
                minHeight: 1,
                flexShrink: 0,
                flexDirection: 'row',
                backgroundColor: selected() ? props.theme.selection : props.theme.input,
              }}
              onMouseDown={() => choose(action.id)}
            >
              <box
                style={{
                  width: 1,
                  height: 1,
                  minHeight: 1,
                  flexShrink: 0,
                  backgroundColor: selected() ? toneColor() : props.theme.border,
                }}
              />
              <text fg={textColor()} truncate style={{ flexGrow: 1, minWidth: 0, paddingX: 1 }}>
                {action.label}
              </text>
            </box>
          );
        }}
      </For>
    </box>
  );
}
