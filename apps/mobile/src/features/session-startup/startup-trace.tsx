import {
  useStartupAttempt,
  type StartupPresentation,
  type StartupAttempt,
} from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import { type ReactElement } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Text } from "@/ui/text";
import { useAnnounce } from "@/ui/use-announce";
import { StartupStepRow } from "./startup-step-row";
import { useStartupPresentation } from "./startup-presentation-context";
import { StartupSavedSession } from "./startup-saved-session";
import { StartupAttemptActions } from "./startup-attempt-actions";
import { StartupInstructionNotice } from "./startup-instruction-notice";

const PHASE_LABELS = {
  submitting: "Submitting request",
  waiting: "Waiting",
  running: "Starting session",
  settling: "Finishing cleanup",
  ready: "Session ready",
  failed: "Session start failed",
  canceled: "Canceled",
};

export function StartupTrace({
  attemptId,
  onContinueInBackground,
  onEditChoices,
  onRepairSavedSession,
  presentation: expectedPresentation = "dialog",
}: {
  attemptId: string;
  onContinueInBackground?: (() => void) | undefined;
  onEditChoices?: (() => void) | undefined;
  onRepairSavedSession?: (() => void) | undefined;
  presentation?: StartupPresentation;
}): ReactElement | null {
  const attempt = useStartupAttempt(attemptId);
  const presentation = useStartupPresentation();
  const phase = attempt?.status.phase;
  const current = attempt?.status.confirmation === "current";
  useAnnounce(startupAnnouncement(attempt, expectedPresentation));
  if (!attempt || attempt.presentation !== expectedPresentation) return null;
  const compact = expectedPresentation !== "dialog";
  const rows = attempt.operations.flatMap((operation) =>
    operation.steps.map((step) => ({ key: `${operation.context.operationId}:${step.id}`, step })),
  );
  return (
    <View style={[styles.root, compact ? styles.compact : styles.full]}>
      <View style={styles.header}>
        <Text variant="headline" accessibilityRole="header">
          {attempt.label}
        </Text>
        <Text
          variant="footnote"
          tone={phase === "failed" ? "red" : "secondary"}
          accessibilityLiveRegion="polite"
        >
          {PHASE_LABELS[attempt.status.phase]}
        </Text>
        <Text variant="caption1" tone="secondary" selectable>
          {attempt.origin.workspaceId}
          {attempt.origin.scope.kind === "task"
            ? ` · ${attempt.origin.scope.taskId} · ${attempt.origin.scope.role}`
            : ""}
        </Text>
        {!current ? (
          <Text variant="footnote" tone="amber">
            The host has not confirmed the outcome. Inspect the session before you send again.
            Reconnecting does not start another session.
          </Text>
        ) : null}
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.steps}
        nestedScrollEnabled
        contentOffset={{ x: 0, y: presentation.scroll.get(attemptId) ?? 0 }}
        onScroll={(event) => presentation.scroll.set(attemptId, event.nativeEvent.contentOffset.y)}
        scrollEventThrottle={100}
      >
        {rows.length === 0 ? (
          <Text variant="footnote" tone="secondary">
            Submitting the request to the host.
          </Text>
        ) : (
          rows.map(({ key, step }) => (
            <StartupStepRow
              key={key}
              attemptId={attemptId}
              step={step}
              expanded={presentation.expanded[attemptId]?.has(key) === true}
              toggle={() => presentation.toggle(attemptId, key)}
            />
          ))
        )}
        {attempt.error ? (
          <Text variant="footnote" tone="red" selectable>
            {attempt.error}
          </Text>
        ) : null}
        <StartupInstructionNotice instruction={attempt.instruction} />
        <StartupSavedSession attempt={attempt} />
      </ScrollView>
      <StartupAttemptActions
        attempt={attempt}
        onContinueInBackground={onContinueInBackground}
        onEditChoices={onEditChoices}
        onRepairSavedSession={onRepairSavedSession}
      />
    </View>
  );
}

function startupAnnouncement(
  attempt: StartupAttempt | null,
  expectedPresentation: StartupPresentation,
): string | null {
  if (!attempt || attempt.presentation !== expectedPresentation) return null;
  const current = attempt.status.confirmation === "current";
  const steps = attempt.operations.flatMap((operation) => operation.steps);
  const activeStep =
    steps.find((step) => step.state === "running" || step.state === "waiting") ?? steps.at(-1);
  const stepAnnouncement = activeStep
    ? ` ${activeStep.label}. ${activeStep.state.replace("_", " ")}.`
    : "";
  return `${attempt.label}. ${PHASE_LABELS[attempt.status.phase]}.${current ? stepAnnouncement : " Waiting for the host to confirm the outcome."}`;
}

const styles = StyleSheet.create((theme) => ({
  root: { gap: theme.space.md, minHeight: 160 },
  full: { flex: 1, padding: theme.layout.screenPadding },
  compact: { maxHeight: 360, padding: theme.space.md },
  header: { gap: theme.space.xs },
  scroll: { flexShrink: 1 },
  steps: { gap: theme.space.sm, paddingBottom: theme.space.sm },
}));
