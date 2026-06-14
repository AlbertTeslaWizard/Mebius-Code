/** @jsxImportSource @opentui/solid */
import { For, Show, createMemo } from 'solid-js';
import type { PlanBundle, PlanQuestion, PlanQuestionAnswer } from '../types';
import { ActionRow, type TuiAction } from './ActionRow';
import type { TuiTheme } from './theme';

export type PlanDecisionChoice = 'start' | 'modify' | 'discuss' | 'cancel';
export type PlanQuestionFocusTarget = 'choices' | 'custom' | 'notes';
type PlanReviewChoice = 'confirm' | 'modify' | 'cancel';

export const PLAN_APPROVAL_PANEL_HEIGHT = 7;
export const PLAN_QUESTION_PANEL_HEIGHT = 16;
export const PLAN_REVIEW_PANEL_HEIGHT = 12;
const PLAN_VISIBLE_CHOICE_COUNT = 5;

const PLAN_READY_PROMPT = 'Plan ready. Confirm before implementation starts.';

const PLAN_DECISION_CHOICES: Array<TuiAction<PlanDecisionChoice>> = [
  { id: 'start', label: '\u53ef\u4ee5\uff0c\u5f00\u59cb\u5199', width: 18 },
  { id: 'modify', label: '\u4fee\u6539\u8ba1\u5212', width: 14 },
  { id: 'discuss', label: '\u7ee7\u7eed\u8ba8\u8bba', width: 14 },
  { id: 'cancel', label: '\u53d6\u6d88', width: 10, tone: 'danger' },
];

const PLAN_REVIEW_CHOICES: Array<TuiAction<PlanReviewChoice>> = [
  { id: 'confirm', label: 'Confirm start', width: 17 },
  { id: 'modify', label: 'Modify', width: 12 },
  { id: 'cancel', label: 'Cancel', width: 11, tone: 'danger' },
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

  function confirm(choice: PlanDecisionChoice) {
    if (props.busy) return;
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
        <ActionRow
          actions={PLAN_DECISION_CHOICES}
          selectedId={props.selectedChoice}
          busy={props.busy}
          theme={props.theme}
          accentColor={props.theme.yellow}
          onSelect={props.onSelectChoice}
          onConfirm={confirm}
        />
      </box>
    </box>
  );
}

export function PlanQuestionPanel(props: {
  question: PlanQuestion;
  questionIndex: number;
  questionCount: number;
  selectedIndex: number;
  focusTarget: PlanQuestionFocusTarget;
  selectedChoiceIds: string[];
  customAnswer: string;
  notes: string;
  error: string;
  busy: boolean;
  theme: TuiTheme;
  onSelectIndex: (index: number) => void;
  onFocusTarget: (target: PlanQuestionFocusTarget) => void;
  onToggleChoice: (choiceId: string) => void;
  onCustomAnswer: (value: string) => void;
  onNotes: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const customEnabled = createMemo(() => props.question.allowCustomAnswer || props.question.choices.length === 0);
  const customSelected = createMemo(() => props.focusTarget === 'custom');
  const notesSelected = createMemo(() => props.focusTarget === 'notes');
  const customLabel = createMemo(() => (props.question.choices.length > 0 ? 'Custom' : 'Answer'));
  const customPlaceholder = createMemo(() =>
    props.question.choices.length > 0 ? 'Type an alternative answer' : 'Type an answer',
  );
  const choiceListHeight = createMemo(() => (props.question.choices.length > 0 ? 6 : 1));
  const choiceStart = createMemo(() => {
    const count = props.question.choices.length;
    if (count <= PLAN_VISIBLE_CHOICE_COUNT) return 0;
    const selected = Math.max(0, Math.min(props.selectedIndex, count - 1));
    return Math.min(Math.max(0, selected - Math.floor(PLAN_VISIBLE_CHOICE_COUNT / 2)), count - PLAN_VISIBLE_CHOICE_COUNT);
  });
  const visibleChoices = createMemo(() =>
    props.question.choices.slice(choiceStart(), choiceStart() + PLAN_VISIBLE_CHOICE_COUNT),
  );
  const hiddenChoiceCount = createMemo(() => Math.max(0, props.question.choices.length - visibleChoices().length));

  function choiceMark(choiceId: string) {
    if (props.question.multiSelect) return props.selectedChoiceIds.includes(choiceId) ? '[✓]' : '[ ]';
    return props.selectedChoiceIds[0] === choiceId ? '(●)' : '( )';
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
        <box style={{ width: '100%', height: choiceListHeight(), minHeight: choiceListHeight(), flexDirection: 'column' }}>
          <Show when={props.question.choices.length > 0}>
            <text fg={props.focusTarget === 'choices' ? props.theme.yellow : props.theme.muted} style={{ width: '100%', height: 1, minHeight: 1 }}>
              choices{hiddenChoiceCount() > 0 ? ` - showing ${choiceStart() + 1}-${choiceStart() + visibleChoices().length} of ${props.question.choices.length}` : ''}
            </text>
          </Show>
          <For each={visibleChoices()}>
            {(choice, index) => {
              const absoluteIndex = createMemo(() => choiceStart() + index());
              const selected = createMemo(() => props.focusTarget === 'choices' && props.selectedIndex === absoluteIndex());
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
                    props.onFocusTarget('choices');
                    props.onSelectIndex(absoluteIndex());
                    props.onToggleChoice(choice.id);
                  }}
                >
                  <text fg={selected() ? props.theme.yellow : props.theme.muted} style={{ width: 5, flexShrink: 0 }}>
                    {choiceMark(choice.id)}
                  </text>
                  <text fg={props.theme.text} truncate style={{ flexGrow: 1, minWidth: 0 }}>
                    {choice.label}
                  </text>
                  <Show when={recommended()}>
                    <text fg={props.theme.green}> [recommended]</text>
                  </Show>
                </box>
              );
            }}
          </For>
        </box>
        <Show when={customEnabled()}>
          <box
            style={{
              width: '100%',
              height: 1,
              minHeight: 1,
              paddingX: 1,
              flexDirection: 'row',
              backgroundColor: customSelected() ? props.theme.selection : props.theme.input,
            }}
            onMouseDown={() => {
              props.onFocusTarget('custom');
              props.onSelectIndex(Math.max(0, props.question.choices.length));
            }}
          >
            <text fg={customSelected() ? props.theme.yellow : props.theme.muted} style={{ width: 12, flexShrink: 0 }}>
              {customLabel()}
            </text>
            <input
              focused={customSelected()}
              value={props.customAnswer}
              placeholder={customPlaceholder()}
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
        <box
          style={{
            width: '100%',
            height: 1,
            minHeight: 1,
            paddingX: 1,
            flexDirection: 'row',
            backgroundColor: notesSelected() ? props.theme.selection : props.theme.input,
          }}
          onMouseDown={() => props.onFocusTarget('notes')}
        >
          <text fg={notesSelected() ? props.theme.yellow : props.theme.muted} style={{ width: 12, flexShrink: 0 }}>
            Notes
          </text>
          <input
            focused={notesSelected()}
            value={props.notes}
            placeholder="Add detail for the plan"
            backgroundColor={notesSelected() ? props.theme.selection : props.theme.input}
            focusedBackgroundColor={props.theme.selection}
            textColor={props.theme.text}
            focusedTextColor={props.theme.text}
            cursorColor={props.theme.yellow}
            style={{ flexGrow: 1, minWidth: 0 }}
            onInput={props.onNotes}
          />
        </box>
        <Show
          when={props.error}
          fallback={
            <text fg={props.theme.muted} style={{ width: '100%', height: 1, minHeight: 1 }}>
              up/down move   space choose   tab notes   enter next/review   esc cancel
            </text>
          }
        >
          {(error) => (
            <text fg={props.theme.softRed} truncate style={{ width: '100%', height: 1, minHeight: 1 }}>
              {error()}
            </text>
          )}
        </Show>
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

  function confirm(choice: PlanReviewChoice) {
    if (props.busy) return;
    if (choice === 'confirm') {
      props.onConfirm();
      return;
    }
    if (choice === 'modify') {
      props.onModify();
      return;
    }
    props.onCancel();
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
        <ActionRow
          actions={PLAN_REVIEW_CHOICES}
          selectedId="confirm"
          busy={props.busy}
          theme={props.theme}
          accentColor={props.theme.green}
          onSelect={() => undefined}
          onConfirm={confirm}
        />
      </box>
    </box>
  );
}

export const PlanApprovalPanel = PlanReadyPanel;
