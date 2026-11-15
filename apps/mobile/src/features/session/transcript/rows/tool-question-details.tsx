import {
  NO_ANSWER_YET_LABEL,
  type QuestionDetailEntry,
  readQuestionAnswerChoices,
  readQuestionAnswerText,
  readToolDetailAvailability,
  readToolDetailsError,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import type { QuestionToolDetail } from "@openducktor/frontend-core/sessions/messages/question-tool-parser";
import type { ReactElement } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { sansWeight } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { optionIcon } from "../../pending-input/question-option-icon";
import { useDisclosure } from "./disclosure";
import { DisclosureMarker, Reveal } from "./row-parts";
import {
  DetailsError,
  type DetailsTiming,
  StatusLine,
  ToolCallInputOutput,
} from "./tool-details-parts";

/**
 * The desktop `QuestionToolDetails`: the status and run facts of a question tool, its error, each
 * question with its options and answers, and its raw input and output, closed at first. The sheet
 * title names the tool that the runtime called.
 */
export function QuestionToolDetails({
  meta,
  questions,
  messageTimestamp,
  timeLabel,
}: { meta: ToolMeta; questions: QuestionDetailEntry[] } & DetailsTiming): ReactElement {
  const { desktop } = useAppTheme();
  const raw = useDisclosure(false, `${meta.callId}:raw`);
  const { hasInput, hasOutput } = readToolDetailAvailability(meta);
  const error = readToolDetailsError(meta);
  return (
    <ScrollView style={styles.fillHeight} contentContainerStyle={styles.padded}>
      <StatusLine
        meta={meta}
        messageTimestamp={messageTimestamp}
        timeLabel={timeLabel}
        exitCode={null}
        timeoutMs={null}
      />
      {error ? <DetailsError error={error} /> : null}
      {/* A question tool asks a few questions, so they render in the scroll view of the details. */}
      {/* react-doctor-disable-next-line react-doctor/rn-no-scrollview-mapped-list */}
      {questions.map(({ key, detail }, index) => (
        <QuestionCard
          key={key}
          detail={detail}
          position={questions.length > 1 ? `${index + 1} of ${questions.length}` : null}
        />
      ))}
      {hasInput || hasOutput ? (
        <View style={styles.block}>
          <Touchable
            feedback="opacity"
            onPress={raw.toggle}
            accessibilityRole="button"
            accessibilityLabel="Raw input and output"
            accessibilityState={{ expanded: raw.open }}
            style={styles.sectionLabel}
          >
            <DisclosureMarker
              open={raw.open}
              animated={raw.pressed}
              color={desktop.mutedForeground}
              size={13}
            />
            <Text style={[styles.sectionTitle, { color: desktop.mutedForeground }]}>
              Raw input and output
            </Text>
          </Touchable>
          {raw.open ? (
            <Reveal animate={raw.pressed} style={styles.rawBlocks}>
              <ToolCallInputOutput meta={meta} />
            </Reveal>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

/** One question: its label, its prompt, its options with the chosen ones marked, and the written answers. */
function QuestionCard({
  detail,
  position,
}: {
  detail: QuestionToolDetail;
  position: string | null;
}): ReactElement {
  const { desktop } = useAppTheme();
  const { selectedLabels, customAnswers } = readQuestionAnswerChoices(detail);
  const isAnswered = detail.answers.length > 0;
  const facts = [position, detail.header].filter((fact) => fact !== null);
  return (
    <View style={[styles.questionCard, { borderColor: desktop.border }]}>
      {facts.length > 0 || detail.multiple ? (
        <View style={styles.questionFacts}>
          {facts.length > 0 ? (
            <Text style={[styles.questionFact, { color: desktop.mutedForeground }]}>
              {facts.join(" · ").toUpperCase()}
            </Text>
          ) : null}
          {detail.multiple ? (
            <Text
              style={[
                styles.multipleChip,
                { color: desktop.mutedForeground, borderColor: desktop.border },
              ]}
            >
              Multiple choice
            </Text>
          ) : null}
        </View>
      ) : null}
      <Text selectable style={[styles.questionPrompt, { color: desktop.foreground }]}>
        {detail.prompt}
      </Text>
      {detail.options.map((option) => {
        const selected = selectedLabels.has(option.label);
        return (
          <View
            key={option.label}
            accessible
            accessibilityState={{ selected }}
            accessibilityLabel={
              option.description ? `${option.label}, ${option.description}` : option.label
            }
            style={[
              styles.option,
              selected
                ? { borderColor: desktop.mutedForeground, backgroundColor: desktop.secondary }
                : { borderColor: desktop.border },
            ]}
          >
            <Icon
              name={optionIcon(detail.multiple, selected)}
              size={14}
              colorValue={selected ? desktop.foreground : desktop.mutedForeground}
            />
            <View style={styles.fill}>
              <Text
                selectable
                style={[
                  styles.optionLabel,
                  {
                    color: selected || !isAnswered ? desktop.foreground : desktop.mutedForeground,
                  },
                ]}
              >
                {option.label}
              </Text>
              {option.description ? (
                <Text
                  selectable
                  style={[styles.optionDescription, { color: desktop.mutedForeground }]}
                >
                  {option.description}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
      {customAnswers.length > 0 ? (
        <View style={styles.block}>
          <Text style={[styles.optionDescription, { color: desktop.mutedForeground }]}>
            {detail.options.length > 0 ? "Other answer" : "Answer"}
          </Text>
          {customAnswers.map(({ key, value: answer }) => (
            <Text
              key={key}
              selectable
              style={[
                styles.customAnswer,
                {
                  color: desktop.foreground,
                  borderColor: desktop.mutedForeground,
                  backgroundColor: desktop.secondary,
                },
              ]}
            >
              {answer}
            </Text>
          ))}
        </View>
      ) : null}
      {/* A secret question shows that its answer is hidden. */}
      {isAnswered && !detail.secret ? null : (
        <Text style={[styles.meta, styles.noAnswer, { color: desktop.mutedForeground }]}>
          {readQuestionAnswerText(detail) || NO_ANSWER_YET_LABEL}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  fillHeight: { flex: 1 },
  padded: {
    gap: theme.space.md,
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.sm,
    paddingBottom: theme.space.lg,
  },
  sectionLabel: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, minHeight: 28 },
  fill: { flex: 1, minWidth: 0 },
  meta: { ...sansWeight("regular"), fontSize: 12.5, lineHeight: 18 },
  sectionTitle: { ...sansWeight("medium"), fontSize: 13, lineHeight: 18 },
  block: { gap: 6 },
  // The input and output keep the gap of the blocks of the details.
  rawBlocks: { gap: theme.space.md },
  questionCard: {
    gap: theme.space.sm,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    padding: theme.space.md,
  },
  questionFacts: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  questionFact: { ...sansWeight("semibold"), fontSize: 11.5, lineHeight: 16, letterSpacing: 0.4 },
  multipleChip: {
    ...sansWeight("medium"),
    fontSize: 11.5,
    lineHeight: 16,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    overflow: "hidden",
  },
  questionPrompt: { ...sansWeight("medium"), fontSize: 14, lineHeight: 20 },
  option: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.space.sm,
    borderWidth: 1,
    borderRadius: theme.radius.xs,
    paddingHorizontal: theme.space.md,
    paddingVertical: 6,
  },
  optionLabel: { ...sansWeight("medium"), fontSize: 13, lineHeight: 18 },
  optionDescription: { ...sansWeight("regular"), fontSize: 12, lineHeight: 16 },
  customAnswer: {
    ...sansWeight("regular"),
    fontSize: 13,
    lineHeight: 18,
    borderWidth: 1,
    borderRadius: theme.radius.xs,
    paddingHorizontal: theme.space.md,
    paddingVertical: 6,
    overflow: "hidden",
  },
  noAnswer: { fontStyle: "italic" },
}));
