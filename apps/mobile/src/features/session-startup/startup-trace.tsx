import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  useStartupAttempt,
  type StartupPresentation,
  type StartupAttempt,
} from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import { terminalCommandSucceeded } from "@openducktor/frontend-core/terminals/terminal-command-result";
import { type ReactElement, useState } from "react";
import { ScrollView, useWindowDimensions, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Icon, type IconName } from "@/ui/icon";
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

const PHASE_ICONS = {
  submitting: "loader-circle",
  waiting: "clock",
  running: "loader-circle",
  settling: "loader-circle",
  ready: "check",
  failed: "circle-alert",
  canceled: "x",
} satisfies Record<StartupAttempt["status"]["phase"], IconName>;

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
  const { startupAttempts } = useClientConnection();
  const traceState = useStartupPresentation();
  const compact = expectedPresentation !== "dialog";
  const progressOpen = !compact || traceState.expanded[attemptId]?.has("progress") === true;
  const [progressViewed, setProgressViewed] = useState(progressOpen);
  useAnnounce(startupAnnouncement(attempt, expectedPresentation));
  if (!attempt || attempt.presentation !== expectedPresentation) return null;
  if (
    expectedPresentation === "inline" &&
    startupAttempts.isReadyForHandoff(attemptId) &&
    hasConfirmedReadyState(attempt)
  )
    return null;
  return (
    <View style={[styles.root, compact ? styles.compact : styles.full]}>
      <StartupTraceHeader attempt={attempt} compact={compact} />
      <StartupTraceSummary attempt={attempt} compact={compact} progressOpen={progressOpen} />
      <StartupTraceDetails
        attempt={attempt}
        compact={compact}
        mounted={progressOpen || progressViewed}
        visible={progressOpen}
      />
      <StartupInstructionNotice instruction={attempt.instruction} />
      <StartupAttemptActions
        attempt={attempt}
        onContinueInBackground={onContinueInBackground}
        onEditChoices={onEditChoices}
        onRepairSavedSession={onRepairSavedSession}
        progressExpanded={progressOpen}
        onToggleProgress={
          compact
            ? () => {
                setProgressViewed(true);
                traceState.toggle(attemptId, "progress");
              }
            : undefined
        }
      />
    </View>
  );
}

function hasConfirmedReadyState(attempt: StartupAttempt): boolean {
  return (
    attempt.status.phase === "ready" &&
    attempt.status.confirmation === "current" &&
    !attempt.error &&
    attempt.instruction?.state !== "not_sent" &&
    attempt.instruction?.state !== "unknown" &&
    !attempt.operations.some((operation) =>
      operation.steps.some(
        (step) => step.action?.result && !terminalCommandSucceeded(step.action.result),
      ),
    )
  );
}

function StartupTraceHeader({
  attempt,
  compact,
}: {
  attempt: StartupAttempt;
  compact: boolean;
}): ReactElement {
  const phase = attempt.status.phase;
  const current = attempt.status.confirmation === "current";
  const workspace = attempt.origin.workspaceId.split(/[\\/]/).filter(Boolean).at(-1);
  const scope =
    attempt.origin.scope.kind === "task"
      ? ` · ${attempt.origin.scope.taskId} · ${attempt.origin.scope.role}`
      : "";
  const origin = `${workspace}${scope}`;
  return (
    <View style={styles.header}>
      <View style={styles.heading}>
        <Icon
          name={PHASE_ICONS[phase]}
          size={16}
          color={phase === "failed" ? "red" : "secondaryLabel"}
        />
        <Text
          variant="headline"
          accessibilityRole={compact ? "header" : "text"}
          numberOfLines={2}
          style={styles.title}
        >
          {compact ? attempt.label : PHASE_LABELS[phase]}
        </Text>
        {compact ? (
          <Text variant="caption1" tone={phase === "failed" ? "red" : "secondary"}>
            {PHASE_LABELS[phase]}
          </Text>
        ) : null}
      </View>
      <Text
        variant="caption1"
        tone="secondary"
        numberOfLines={1}
        accessibilityLabel={`${attempt.origin.workspaceId}${scope}`}
        selectable
      >
        {origin}
      </Text>
      {!current ? (
        <Text variant="footnote" tone="amber">
          Outcome unconfirmed. Inspect the session before you send again.
        </Text>
      ) : null}
    </View>
  );
}

function StartupTraceSummary({
  attempt,
  compact,
  progressOpen,
}: {
  attempt: StartupAttempt;
  compact: boolean;
  progressOpen: boolean;
}): ReactElement | null {
  if (!compact) return null;
  const steps = attempt.operations.flatMap((operation) => operation.steps);
  const failedAction = steps.findLast(
    (step) => step.action?.result && !terminalCommandSucceeded(step.action.result),
  );
  const activeStep =
    steps.find((step) => step.state === "running" || step.state === "waiting") ??
    failedAction ??
    steps.at(-1);
  return (
    <>
      {activeStep ? (
        <Text
          variant="footnote"
          tone={activeStep === failedAction ? "red" : "secondary"}
          numberOfLines={2}
        >
          {activeStep.label}
        </Text>
      ) : null}
      {attempt.error && !progressOpen ? (
        <Text variant="footnote" tone="red" numberOfLines={2} selectable>
          {attempt.error}
        </Text>
      ) : null}
    </>
  );
}

function StartupTraceDetails({
  attempt,
  compact,
  mounted,
  visible,
}: {
  attempt: StartupAttempt;
  compact: boolean;
  mounted: boolean;
  visible: boolean;
}): ReactElement | null {
  const traceState = useStartupPresentation();
  const { height } = useWindowDimensions();
  if (!mounted) return null;
  const attemptId = attempt.id;
  const rows = attempt.operations.flatMap((operation) =>
    operation.steps.map((step) => ({ key: `${operation.context.operationId}:${step.id}`, step })),
  );
  return (
    <View
      style={visible ? styles.progress : styles.hiddenProgress}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
    >
      <ScrollView
        style={[styles.scroll, { maxHeight: compact ? 240 : Math.min(360, height * 0.5) }]}
        contentContainerStyle={styles.steps}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        contentOffset={{ x: 0, y: traceState.scroll.get(attemptId) ?? 0 }}
        onScroll={(event) => traceState.scroll.set(attemptId, event.nativeEvent.contentOffset.y)}
        scrollEventThrottle={100}
      >
        {rows.length === 0 ? (
          <Text variant="footnote" tone="secondary">
            Submitting the request to the host.
          </Text>
        ) : (
          rows.map(({ key, step }, index) => (
            <StartupStepRow
              key={key}
              attemptId={attemptId}
              step={step}
              last={index === rows.length - 1}
              expanded={traceState.expanded[attemptId]?.has(key) === true}
              toggle={() => traceState.toggle(attemptId, key)}
            />
          ))
        )}
        {attempt.error ? (
          <Text variant="footnote" tone="red" selectable>
            {attempt.error}
          </Text>
        ) : null}
        <StartupSavedSession attempt={attempt} />
      </ScrollView>
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
  root: { gap: theme.space.sm, flexShrink: 1 },
  full: { maxHeight: "100%", padding: theme.layout.screenPadding },
  compact: { padding: theme.space.md },
  header: { gap: theme.space.xxs },
  heading: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  title: { flex: 1, minWidth: 0 },
  progress: { flexShrink: 1 },
  hiddenProgress: { display: "none" },
  scroll: { flexGrow: 0, flexShrink: 1 },
  steps: { paddingBottom: theme.space.xs },
}));
