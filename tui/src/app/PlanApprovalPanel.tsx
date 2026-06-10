/** @jsxImportSource @opentui/solid */
import { For, Show, createMemo } from 'solid-js';
import type { PlanBundle, PlanQuestion, PlanQuestionAnswer } from '../types';
import type { TuiTheme } from './theme';

export type PlanDecisionChoice = 'start' | 'modify' | 'discuss' | 'cancel';

export const PLAN_APPROVAL_PANEL_HEIGHT = 8;
export const PLAN_QUESTION_PANEL_HEIGHT = 12;
export const PLAN_REVIEW_PANEL_HEIGHT = 12;

const PLAN_READY_PROMPT = 'Plan ready. Confirm before implementation starts.';

const PLAN_DECISION_CHOICES: Array<{ id: PlanDecisionChoice; label: string; width: number }> = [
  { id: 'start', label: '\u53ef\u4ee5\uff0c\u5f00\u59cb\u5199', width: 18 },
  { id: 'modify', label: '\u4fee\u6539\u8ba1\u5212', width: 14 },
  { id: 'discuss', label: '\u7ee7\u7eed\u8ba8\u8bba', width: 14 },
  { id: 'cancel', label: '\u53d6\u6d88', width: 10 },
];

export function PlanReadyPanel(props: {
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
          {PLAN_READY_PROMPT}
        </text>
        <text fg={props.theme.text} truncate style={{ width: '100%', height: 1, minHeight: 1 }}>
          {summary()}
        </text>
        <text fg={props.theme.muted} truncate style={{ width: '100%', height: 1, minHeight: 1 }}>
          {stepsLabel()} - pending_approval
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
          left/right select   enter confirm   esc cancel
        </text>
      </box>
    </box>
  );
}

export function PlanQuestionPanel(props: {
  question: PlanQuestion;
  questionIndex: number;
  questionCount: number;
  selectedIndex: number;
  selectedChoiceIds: string[];
  customAnswer: string;
  busy: boolean;
  theme: TuiTheme;
  onSelectIndex: (index: number) => void;
  onToggleChoice: (choiceId: string) => void;
  onCustomAnswer: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const optionCount = createMemo(() => props.question.choices.length + (props.question.allowCustomAnswer ? 1 : 0));
  const customSelected = createMemo(() => props.question.allowCustomAnswer && props.selectedIndex === optionCount() - 1);

  function choiceMark(choiceId: string) {
    if (props.question.multiSelect) return props.selectedChoiceIds.includes(choiceId) ? '[x]' : '[ ]';
    return props.selectedChoiceIds[0] === choiceId ? '>' : ' ';
  }

  return (
    <box
      border
      borderStyle="rounded"
      borderColor={props.theme.yellow}
      focusedBorderColor={props.theme.yellow}
      style={{
        width: '100%',
        height: PLAN_QUESTION_PANEL_HEIGHT,
        minHeight: PLAN_QUESTION_PANEL_HEIGHT,
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
          <text fg={props.theme.yellow}>Clarification</text>
          <text fg={props.theme.muted}> {props.questionIndex + 1}/{props.questionCount}</text>
          <Show when={props.busy}>
            <text fg={props.theme.muted}> - saving...</text>
          </Show>
        </box>
        <text fg={props.theme.text} truncate style={{ width: '100%', height: 1, minHeight: 1 }}>
          {props.question.title}
        </text>
        <text fg={props.theme.text} wrapMode="word" style={{ width: '100%', height: 2, minHeight: 2 }}>
          {props.question.prompt}
        </text>
        <Show when={props.question.notes}>
          {(notes) => (
            <text fg={props.theme.muted} truncate style={{ width: '100%', height: 1, minHeight: 1 }}>
              {notes()}
            </text>
          )}
        </Show>
        <box style={{ width: '100%', height: 3, minHeight: 3, flexDirection: 'column' }}>
          <For each={props.question.choices.slice(0, props.question.allowCustomAnswer ? 2 : 3)}>
            {(choice, index) => {
              const selected = createMemo(() => props.selectedIndex === index());
              const recommended = createMemo(() => props.question.recommendedChoiceId === choice.id);
              return (
                <box
                  style={{
                    width: '100%',
                    height: 1,
                    minHeight: 1,
                    paddingX: 1,
                    flexDirection: 'row',
                    backgroundColor: selected() ? props.theme.selection : props.theme.input,
                  }}
                  onMouseDown={() => {
                    props.onSelectIndex(index());
                    props.onToggleChoice(choice.id);
                  }}
                >
                  <text fg={selected() ? props.theme.text : props.theme.muted} style={{ width: 4, flexShrink: 0 }}>
                    {choiceMark(choice.id)}
                  </text>
                  <text fg={props.theme.text} truncate style={{ flexGrow: 1, minWidth: 0 }}>
                    {choice.label}
                  </text>
                  <Show when={recommended()}>
                    <text fg={props.theme.green}> recommended</text>
                  </Show>
                </box>
              );
            }}
          </For>
        </box>
        <Show when={props.question.allowCustomAnswer}>
          <box
            style={{
              width: '100%',
              height: 1,
              minHeight: 1,
              paddingX: 1,
              flexDirection: 'row',
              backgroundColor: customSelected() ? props.theme.selection : props.theme.input,
            }}
            onMouseDown={() => props.onSelectIndex(optionCount() - 1)}
          >
            <text fg={customSelected() ? props.theme.text : props.theme.muted} style={{ width: 8, flexShrink: 0 }}>
              Custom
            </text>
            <input
              focused={customSelected()}
              value={props.customAnswer}
              placeholder=""
              backgroundColor={customSelected() ? props.theme.selection : props.theme.input}
              focusedBackgroundColor={props.theme.selection}
              textColor={props.theme.text}
              focusedTextColor={props.theme.text}
              cursorColor={props.theme.yellow}
              style={{ flexGrow: 1, minWidth: 0 }}
              onInput={props.onCustomAnswer}
            />
          </box>
        </Show>
        <text fg={props.theme.muted} style={{ width: '100%', height: 1, minHeight: 1 }}>
          up/down select   space toggle   enter next/review   esc cancel
        </text>
      </box>
    </box>
  );
}

export function PlanReviewPanel(props: {
  plan: PlanBundle;
  answers: PlanQuestionAnswer[];
  busy: boolean;
  theme: TuiTheme;
  onConfirm: () => void;
  onModify: () => void;
  onCancel: () => void;
}) {
  const questions = createMemo(() => props.plan.questions ?? props.plan.plan.questions ?? []);
  const summary = createMemo(() => props.plan.plan.summary || props.plan.plan.goal || 'Final plan');

  function answerText(question: PlanQuestion): string {
    const answer = props.answers.find((item) => item.questionId === question.id);
    if (!answer) return 'unanswered';
    const ids = answer.choiceIds?.length ? answer.choiceIds : answer.choiceId ? [answer.choiceId] : [];
    const labels = ids.map((id) => question.choices.find((choice) => choice.id === id)?.label ?? id);
    return [labels.join(', '), answer.customAnswer, answer.notes].filter(Boolean).join(' | ') || 'answered';
  }

  return (
    <box
      border
      borderStyle="rounded"
      borderColor={props.theme.green}
      focusedBorderColor={props.theme.green}
      style={{
        width: '100%',
        height: PLAN_REVIEW_PANEL_HEIGHT,
        minHeight: PLAN_REVIEW_PANEL_HEIGHT,
        minWidth: 0,
        flexShrink: 0,
        alignSelf: 'stretch',
        flexDirection: 'row',
        backgroundColor: props.theme.input,
      }}
    >
      <box style={{ width: 1, flexShrink: 0, alignSelf: 'stretch', backgroundColor: props.theme.green }} />
      <box style={{ width: '100%', flexGrow: 1, minWidth: 0, paddingX: 1, flexDirection: 'column' }}>
        <box style={{ width: '100%', height: 1, minHeight: 1, flexDirection: 'row' }}>
          <text fg={props.theme.green}>Review</text>
          <Show when={props.busy}>
            <text fg={props.theme.muted}> - starting...</text>
          </Show>
        </box>
        <text fg={props.theme.text} wrapMode="word" style={{ width: '100%', height: 2, minHeight: 2 }}>
          {summary()}
        </text>
        <text fg={props.theme.muted} truncate style={{ width: '100%', height: 1, minHeight: 1 }}>
          {props.plan.steps.length} steps - final approval required
        </text>
        <box style={{ width: '100%', height: 5, minHeight: 5, flexDirection: 'column' }}>
          <For each={questions().slice(0, 5)}>
            {(question) => (
              <text fg={props.theme.text} truncate style={{ width: '100%', height: 1, minHeight: 1 }}>
                {question.title}: {answerText(question)}
              </text>
            )}
          </For>
          <Show when={questions().length === 0}>
            <text fg={props.theme.muted}>No clarification questions.</text>
          </Show>
        </box>
        <text fg={props.theme.muted} style={{ width: '100%', height: 1, minHeight: 1 }}>
          Enter confirm and start   Tab modify   Esc cancel
        </text>
      </box>
    </box>
  );
}

export const PlanApprovalPanel = PlanReadyPanel;
