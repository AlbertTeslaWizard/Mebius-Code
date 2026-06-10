/** @jsxImportSource @opentui/solid */
import { For, Show, createMemo } from 'solid-js';
import type { PlanBundle } from '../types';
import type { TuiTheme } from './theme';

export type PlanDecisionChoice = 'start' | 'modify' | 'discuss' | 'cancel';

export const PLAN_APPROVAL_PANEL_HEIGHT = 8;

const PLAN_PROMPT =
  '\u8fd9\u4e2a\u65b9\u6848\u4f60\u89c9\u5f97\u600e\u4e48\u6837\uff1f\u8981\u8c03\u6574\u4ec0\u4e48\u5417\uff1f\u786e\u8ba4\u540e\u6211\u5f00\u59cb\u5199\u4ee3\u7801\u3002';

const PLAN_DECISION_CHOICES: Array<{ id: PlanDecisionChoice; label: string; width: number }> = [
  { id: 'start', label: '\u53ef\u4ee5\uff0c\u5f00\u59cb\u5199', width: 18 },
  { id: 'modify', label: '\u4fee\u6539\u8ba1\u5212', width: 14 },
  { id: 'discuss', label: '\u7ee7\u7eed\u8ba8\u8bba', width: 14 },
  { id: 'cancel', label: '\u53d6\u6d88', width: 10 },
];

export function PlanApprovalPanel(props: {
  plan: PlanBundle;
  selectedChoice: PlanDecisionChoice;
  busy: boolean;
  theme: TuiTheme;
  onSelectChoice: (choice: PlanDecisionChoice) => void;
  onConfirmChoice: (choice: PlanDecisionChoice) => void;
}) {
  const summary = createMemo(() => props.plan.plan.summary || props.plan.plan.goal || 'Plan ready');
  const stepsLabel = createMemo(() => {
    const count = props.plan.steps.length;
    return `${count} step${count === 1 ? '' : 's'}`;
  });

  function choose(choice: PlanDecisionChoice) {
    if (props.busy) return;
    props.onSelectChoice(choice);
    props.onConfirmChoice(choice);
  }

  return (
    <box
      border
      borderStyle="rounded"
      borderColor={props.theme.yellow}
      focusedBorderColor={props.theme.yellow}
      style={{
        width: '100%',
        height: PLAN_APPROVAL_PANEL_HEIGHT,
        minHeight: PLAN_APPROVAL_PANEL_HEIGHT,
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
          <text fg={props.theme.yellow}>Plan ready</text>
          <Show when={props.busy}>
            <text fg={props.theme.muted}> - working...</text>
          </Show>
        </box>
        <text fg={props.theme.text} truncate style={{ width: '100%', height: 1, minHeight: 1 }}>
          {PLAN_PROMPT}
        </text>
        <text fg={props.theme.text} truncate style={{ width: '100%', height: 1, minHeight: 1 }}>
          {summary()}
        </text>
        <text fg={props.theme.muted} truncate style={{ width: '100%', height: 1, minHeight: 1 }}>
          {stepsLabel()} - {props.plan.plan.status}
        </text>
        <box style={{ width: '100%', height: 1, minHeight: 1, flexDirection: 'row', marginTop: 1 }}>
          <For each={PLAN_DECISION_CHOICES}>
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
          up/down select   enter confirm   esc dismiss
        </text>
      </box>
    </box>
  );
}
