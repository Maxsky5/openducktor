import {
  type AgentQuestionDraftEntry,
  agentQuestionCompletionText,
  agentQuestionTitle,
} from "@openducktor/frontend-core/sessions/pending-input/agent-session-question-draft";
import {
  PENDING_INPUT_LABELS,
  questionAnsweredStatus,
} from "@openducktor/frontend-core/sessions/pending-input/pending-input-labels";
import { useQuestionDraft } from "@openducktor/frontend-core/sessions/pending-input/use-agent-session-question-draft";
import type { AgentQuestionRequest } from "@openducktor/frontend-core/types/agent-orchestrator";
import { type ComponentRef, memo, type ReactElement, type Ref, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { type CommandFailure, toCommandFailure } from "@/host-session/command-outcome";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { sansWeight } from "@/theme/tokens";
import { haptics } from "@/ui/haptics";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { SessionButton } from "../session-button";
import {
  buildQuestionFlowView,
  type QuestionFlowStep,
  type QuestionFlowView,
} from "./question-flow";
import { RequestCard } from "./request-card";
import { RequestFailureBox, RequestFeedbackBox, RequestStatusLine } from "./request-feedback";

type QuestionDraft = ReturnType<typeof useQuestionDraft>;

export type StructuredQuestionCardProps = {
  request: AgentQuestionRequest;
  /** True while the session cannot take answers. `blockedReason` says why. */
  disabled: boolean;
  blockedReason: string | null;
  isSubmitting: boolean;
  onSubmit: (requestId: string, answers: string[][]) => Promise<void>;
  cardRef?: Ref<ComponentRef<typeof View>> | undefined;
};

/**
 * A Structured Question, as the desktop `AgentSessionQuestionCard`: question tabs, the active
 * question with its options and free text answer, and the footer with Reset and the main action.
 * A multi-question request moves from question to question and shows a summary before it submits.
 * The request stays until the host confirms the answers.
 */
export const StructuredQuestionCard = memo(function StructuredQuestionCard({
  request,
  disabled,
  blockedReason,
  isSubmitting,
  onSubmit,
  cardRef,
}: StructuredQuestionCardProps): ReactElement | null {
  const draft = useQuestionDraft({ request });
  const [failure, setFailure] = useState<CommandFailure | null>(null);
  if (request.questions.length === 0) return null;

  const view = buildQuestionFlowView({
    request,
    draft: draft.normalizedDraft,
    activeTabId: draft.activeTabId,
    isComplete: draft.isComplete,
  });
  const inputDisabled = disabled || isSubmitting || Boolean(request.unsupportedReason);
  const firstQuestion = request.questions[0];
  const send = (answers: string[][], failureTitle: string): void => {
    haptics.light();
    setFailure(null);
    draft.clearSubmitError();
    onSubmit(request.requestId, answers).catch((cause: unknown) => {
      setFailure(toCommandFailure(cause, failureTitle));
    });
  };
  const selectStep = (tabId: string): void => {
    haptics.selection();
    draft.setActiveTabId(tabId);
  };
  const blocked = disabled && Boolean(blockedReason);

  return (
    <RequestCard
      kind="question"
      description={firstQuestion?.header.trim() || firstQuestion?.question}
      isSubagent={request.source?.kind === "subagent"}
      status={questionAnsweredStatus(draft.answeredCount, draft.requiredCount)}
      feedback={
        failure || isSubmitting || blocked ? (
          <QuestionFeedback
            failure={failure}
            isSubmitting={isSubmitting}
            blockedReason={disabled ? blockedReason : null}
          />
        ) : null
      }
      cardRef={cardRef}
    >
      {view.steps.length > 1 ? (
        <QuestionTabs steps={view.steps} activeTabId={draft.activeTabId} onSelect={selectStep} />
      ) : null}

      {request.unsupportedReason ? (
        <RequestFeedbackBox tone="destructive" message={request.unsupportedReason} />
      ) : (
        <QuestionBody
          draft={draft}
          summary={view.summary}
          disabled={inputDisabled}
          onSelectStep={selectStep}
        />
      )}

      <View style={styles.footer}>
        <Text style={styles.completion}>{agentQuestionCompletionText(draft.isComplete)}</Text>
        <View style={styles.footerActions}>
          {request.canCancel ? (
            <SessionButton
              label="Cancel question"
              variant="outline"
              command
              disabled={disabled || isSubmitting}
              onPress={() => send([], "Question not cancelled")}
            />
          ) : null}
          <SessionButton
            label="Reset"
            variant="outline"
            disabled={inputDisabled}
            onPress={draft.resetDraft}
          />
          <QuestionMainAction
            action={view.action}
            isSubmitting={isSubmitting}
            disabled={disabled}
            inputDisabled={inputDisabled}
            blockedReason={blockedReason}
            onSubmit={() => send(draft.buildAnswers(), "Answers not sent")}
            onSelectStep={selectStep}
          />
        </View>
      </View>
    </RequestCard>
  );
});

/** The summary of the answers, or the active question with its options and free text. */
function QuestionBody({
  draft,
  summary,
  disabled,
  onSelectStep,
}: {
  draft: QuestionDraft;
  summary: QuestionFlowView["summary"];
  disabled: boolean;
  onSelectStep: (tabId: string) => void;
}): ReactElement | null {
  if (draft.isSummaryTab) {
    return (
      <View style={styles.summary} accessibilityLabel="Summary of your answers">
        {summary.map((row) => (
          <SummaryRow
            key={row.key}
            title={row.title}
            answer={row.answer}
            answered={row.answered}
            onPress={() => onSelectStep(String(row.questionIndex))}
          />
        ))}
      </View>
    );
  }
  if (!draft.activeQuestion) return null;
  return (
    <QuestionStep
      question={draft.activeQuestion}
      questionIndex={draft.activeQuestionIndex}
      entry={draft.activeEntry}
      disabled={disabled}
      onSelectOption={(value) => draft.selectOption(draft.activeQuestionIndex, value)}
      onToggleFreeText={() => draft.toggleFreeText(draft.activeQuestionIndex)}
      onChangeFreeText={(value) => draft.updateFreeText(draft.activeQuestionIndex, value)}
    />
  );
}

/** A failed send, the submit progress, and why the session takes no answers now. */
function QuestionFeedback({
  failure,
  isSubmitting,
  blockedReason,
}: {
  failure: CommandFailure | null;
  isSubmitting: boolean;
  /** Why the session takes no answers, or null while it takes them. */
  blockedReason: string | null;
}): ReactElement {
  return (
    <>
      {failure ? <RequestFailureBox failure={failure} /> : null}
      {isSubmitting ? <RequestStatusLine text={PENDING_INPUT_LABELS.submittingAnswers} /> : null}
      {blockedReason && !isSubmitting ? <RequestStatusLine text={blockedReason} /> : null}
    </>
  );
}

/** The main footer action: submit the answers, or go to the next question or the summary. */
function QuestionMainAction({
  action,
  isSubmitting,
  disabled,
  inputDisabled,
  blockedReason,
  onSubmit,
  onSelectStep,
}: {
  action: QuestionFlowView["action"];
  isSubmitting: boolean;
  disabled: boolean;
  inputDisabled: boolean;
  blockedReason: string | null;
  onSubmit: () => void;
  onSelectStep: (tabId: string) => void;
}): ReactElement {
  if (action.kind === "submit") {
    return (
      <SessionButton
        label={isSubmitting ? "Submitting…" : action.label}
        icon="sparkles"
        command
        fill
        loading={isSubmitting}
        disabled={inputDisabled || !action.enabled}
        accessibilityHint={disabled ? (blockedReason ?? undefined) : undefined}
        onPress={onSubmit}
      />
    );
  }
  return (
    <SessionButton
      label={action.label}
      icon={action.kind === "review" ? "list-checks" : undefined}
      trailingIcon={action.kind === "next" ? "chevron-right" : undefined}
      fill
      disabled={disabled || isSubmitting}
      onPress={() => onSelectStep(action.tabId)}
    />
  );
}

/** The desktop question tabs: segmented items with the answered mark, then Summary. */
function QuestionTabs({
  steps,
  activeTabId,
  onSelect,
}: {
  steps: readonly QuestionFlowStep[];
  activeTabId: string;
  onSelect: (tabId: string) => void;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.contentSized}
      contentContainerStyle={styles.tabs}
      accessibilityRole="tablist"
      accessibilityLabel="Questions"
    >
      {/* A request has few questions. */}
      {/* react-doctor-disable-next-line react-doctor/rn-no-scrollview-mapped-list */}
      {steps.map((step) => {
        const active = step.tabId === activeTabId;
        let glyph: IconName = step.answered ? "circle-check" : "circle";
        let glyphColor: string = step.answered
          ? theme.desktop.successAccent
          : theme.desktop.mutedForeground;
        if (step.isSummary) {
          glyph = "list-checks";
          glyphColor = theme.desktop.foreground;
        }
        if (active) glyphColor = withAlpha(theme.desktop.selectedControlForeground, 0.7);
        return (
          <SegmentItem
            key={step.key}
            active={active}
            icon={glyph}
            iconColor={glyphColor}
            label={step.title}
            accessibilityRole="tab"
            accessibilityLabel={
              step.isSummary
                ? step.title
                : `${step.title}, ${step.answered ? "answered" : "not answered"}`
            }
            onPress={() => onSelect(step.tabId)}
          />
        );
      })}
    </ScrollView>
  );
}

/** A desktop `SegmentedControlItem` of size `xs`: the selected control blue when active. */
function SegmentItem({
  active,
  icon,
  iconColor,
  label,
  disabled = false,
  accessibilityRole,
  accessibilityLabel,
  onPress,
}: {
  active: boolean;
  icon: IconName;
  iconColor?: string | undefined;
  label: string;
  disabled?: boolean;
  accessibilityRole: "tab" | "switch";
  accessibilityLabel: string;
  onPress: () => void;
}): ReactElement {
  const theme = useAppTheme();
  styles.useVariants({ active });
  const foreground = active ? theme.desktop.selectedControlForeground : theme.desktop.foreground;
  return (
    <Touchable
      feedback="scale"
      radius={theme.radius.md}
      hitSlop={{ top: 6, bottom: 6 }}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={
        accessibilityRole === "tab" ? { selected: active } : { checked: active, disabled }
      }
      containerStyle={styles.segmentHolder}
      style={styles.segment}
    >
      <Icon name={icon} size={14} colorValue={iconColor ?? foreground} />
      <Text numberOfLines={1} style={[styles.segmentLabel, { color: foreground }]}>
        {label}
      </Text>
    </Touchable>
  );
}

function SummaryRow({
  title,
  answer,
  answered,
  onPress,
}: {
  title: string;
  answer: string;
  answered: boolean;
  onPress: () => void;
}): ReactElement {
  const theme = useAppTheme();
  styles.useVariants({ answered });
  return (
    <Touchable
      feedback="highlight"
      radius={theme.radius.md}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${answer}`}
      accessibilityHint="Opens the question to change the answer."
      style={styles.summaryRow}
    >
      <View style={styles.summaryTitle}>
        <Icon
          name={answered ? "circle-check" : "circle"}
          size={12}
          colorValue={answered ? theme.desktop.successAccent : theme.desktop.mutedForeground}
        />
        <Text numberOfLines={1} style={styles.eyebrow}>
          {title}
        </Text>
      </View>
      <Text style={styles.summaryAnswer}>{answer}</Text>
    </Touchable>
  );
}

/** The desktop option icon: a check box or a radio circle, in the foreground when selected. */
const optionIcon = (multiple: boolean, selected: boolean): IconName => {
  if (multiple) return selected ? "check-square" : "square";
  return selected ? "circle-check" : "circle";
};

function OptionRow({
  label,
  description,
  selected,
  multiple,
  disabled,
  onPress,
}: {
  label: string;
  description?: string | undefined;
  selected: boolean;
  multiple: boolean;
  disabled: boolean;
  onPress: () => void;
}): ReactElement {
  const theme = useAppTheme();
  // Plain colors, as the option cards use: a Unistyles style that the array gains on a later
  // render loses the corner radius of the row.
  const colors = selected
    ? { borderColor: theme.desktop.mutedForeground, backgroundColor: theme.desktop.secondary }
    : { borderColor: theme.desktop.border, backgroundColor: theme.desktop.card };
  return (
    <Touchable
      feedback="scale"
      disabled={disabled}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      radius={theme.radius.md}
      accessibilityRole={multiple ? "checkbox" : "radio"}
      accessibilityLabel={description ? `${label}, ${description}` : label}
      accessibilityState={{ checked: selected, disabled }}
      style={[styles.option, colors]}
    >
      {/* The mark aligns with the first line, and the row centers the content in its height. */}
      <View style={styles.optionContent}>
        <View style={styles.optionIcon}>
          <Icon
            name={optionIcon(multiple, selected)}
            size={16}
            colorValue={selected ? theme.desktop.foreground : theme.desktop.mutedForeground}
          />
        </View>
        <View style={styles.optionText}>
          <Text style={styles.optionLabel}>{label}</Text>
          {description ? <Text style={styles.optionDescription}>{description}</Text> : null}
        </View>
      </View>
    </Touchable>
  );
}

function QuestionStep({
  question,
  questionIndex,
  entry,
  disabled,
  onSelectOption,
  onToggleFreeText,
  onChangeFreeText,
}: {
  question: AgentQuestionRequest["questions"][number];
  questionIndex: number;
  entry: AgentQuestionDraftEntry | undefined;
  disabled: boolean;
  onSelectOption: (value: string) => void;
  onToggleFreeText: () => void;
  onChangeFreeText: (value: string) => void;
}): ReactElement {
  const theme = useAppTheme();
  const selected = new Set(entry?.selectedOptionValues ?? []);
  const multiple = Boolean(question.multiple);
  const allowsFreeText = question.options.length > 0 && question.custom !== false;
  const showsFreeText = question.options.length === 0 || Boolean(entry?.useFreeText);
  return (
    <View style={styles.question}>
      <View style={styles.prompt}>
        <Text selectable style={styles.questionText}>
          <Text style={styles.eyebrow}>{`${agentQuestionTitle(question, questionIndex)}  `}</Text>
          {question.question}
        </Text>
        {question.required === false ? (
          <Text variant="footnote" style={styles.muted}>
            Optional question
          </Text>
        ) : null}
        {multiple ? (
          <View style={styles.multiple}>
            <Icon name="check-square" size={12} colorValue={theme.desktop.foreground} />
            <Text style={styles.multipleText}>Multiple choice - select one or more answers</Text>
          </View>
        ) : null}
      </View>
      {question.options.length > 0 ? (
        <View style={styles.options} accessibilityRole={multiple ? undefined : "radiogroup"}>
          {question.options.map((option) => {
            const value = option.value ?? option.label;
            return (
              <OptionRow
                key={`option:${questionIndex}:${value}`}
                label={option.label}
                description={option.description}
                selected={selected.has(value)}
                multiple={multiple}
                disabled={disabled}
                onPress={() => onSelectOption(value)}
              />
            );
          })}
        </View>
      ) : null}
      {allowsFreeText ? (
        <View style={styles.otherRow}>
          <SegmentItem
            active={Boolean(entry?.useFreeText)}
            icon="message-square-plus"
            label="Other answer"
            disabled={disabled}
            accessibilityRole="switch"
            accessibilityLabel="Other answer"
            onPress={() => {
              haptics.selection();
              onToggleFreeText();
            }}
          />
        </View>
      ) : null}
      {showsFreeText ? (
        <View style={styles.freeText}>
          <Text style={styles.freeTextLabel}>Free text answer</Text>
          <TextInput
            accessibilityLabel="Free text answer"
            value={entry?.freeText ?? ""}
            editable={!disabled}
            multiline
            placeholder="Write your answer..."
            placeholderTextColor={theme.desktop.mutedForeground}
            selectionColor={theme.colors.selection}
            cursorColor={theme.colors.tint}
            onChangeText={onChangeFreeText}
            style={styles.freeTextInput}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // A horizontal ScrollView grows by default and takes height from its siblings.
  contentSized: { flexGrow: 0 },
  tabs: { gap: theme.space.xs },
  segmentHolder: { alignSelf: "flex-start" },
  segment: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.xs,
    paddingHorizontal: theme.space.sm,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    variants: {
      active: {
        true: {
          borderColor: "transparent",
          backgroundColor: theme.desktop.selectedControl,
          boxShadow: theme.shadows.card,
        },
        false: { borderColor: theme.desktop.input, backgroundColor: theme.desktop.card },
      },
    },
  },
  segmentLabel: { ...sansWeight("medium"), fontSize: 12, lineHeight: 16 },
  question: { gap: theme.space.sm },
  prompt: { gap: theme.space.xs },
  questionText: {
    ...sansWeight("medium"),
    fontSize: 14,
    lineHeight: 20,
    color: theme.desktop.foreground,
  },
  eyebrow: {
    ...sansWeight("semibold"),
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: theme.desktop.mutedForeground,
  },
  muted: { color: theme.desktop.mutedForeground },
  multiple: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: theme.space.xs,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.desktop.input,
    backgroundColor: theme.desktop.secondary,
  },
  multipleText: {
    ...sansWeight("semibold"),
    fontSize: 10,
    lineHeight: 14,
    color: theme.desktop.foreground,
  },
  options: { gap: theme.space.xs },
  option: {
    minHeight: theme.touchTarget,
    justifyContent: "center",
    paddingHorizontal: theme.space.sm,
    paddingVertical: 6,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
  },
  optionContent: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  // Space Grotesk draws its letters about 1 point below the middle of the 18-point label line,
  // so the 16-point mark sits 2 points down to center on the letters of the first line.
  optionIcon: { paddingTop: 2 },
  optionText: { flex: 1, minWidth: 0 },
  optionLabel: {
    ...sansWeight("medium"),
    fontSize: 14,
    lineHeight: 18,
    color: theme.desktop.foreground,
  },
  optionDescription: { fontSize: 12, lineHeight: 16, color: theme.desktop.mutedForeground },
  otherRow: { flexDirection: "row" },
  freeText: { gap: theme.space.xs },
  freeTextLabel: { fontSize: 11, lineHeight: 14, color: theme.desktop.mutedForeground },
  freeTextInput: {
    ...theme.type.callout,
    minHeight: 64,
    paddingHorizontal: theme.space.md,
    paddingTop: theme.space.sm,
    paddingBottom: theme.space.sm,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.input,
    backgroundColor: theme.desktop.card,
    color: theme.desktop.foreground,
    textAlignVertical: "top",
  },
  summary: {
    gap: 6,
    padding: 6,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.input,
    backgroundColor: theme.desktop.card,
  },
  summaryRow: {
    minHeight: theme.touchTarget,
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.xs,
  },
  summaryTitle: { flexDirection: "row", alignItems: "center", gap: 6 },
  summaryAnswer: {
    ...theme.type.footnote,
    variants: {
      answered: {
        true: { color: theme.desktop.foreground },
        false: { color: theme.desktop.mutedForeground, fontStyle: "italic" },
      },
    },
  },
  footer: {
    gap: theme.space.sm,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: theme.desktop.input,
  },
  completion: { fontSize: 11, lineHeight: 14, color: theme.desktop.mutedForeground },
  footerActions: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
}));
