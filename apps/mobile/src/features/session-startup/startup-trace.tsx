import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  startupFailureRows,
  startupTraceRows,
} from "@openducktor/frontend-core/sessions/startup/startup-trace";
import {
  useStartupAttempt,
  type StartupPresentation,
  type StartupAttempt,
} from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import { terminalCommandSucceeded } from "@openducktor/frontend-core/terminals/terminal-command-result";
import { type ReactElement, useState } from "react";
import { ScrollView, useWindowDimensions, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ThemeColorName } from "@/theme/tokens";
import { Icon, type IconName } from "@/ui/icon";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { Text } from "@/ui/text";
import { useAnnounce } from "@/ui/use-announce";
import { StartupStepDetails, StartupStepRow } from "./startup-step-row";
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
const PHASE_COLORS = {
  submitting: "tint",
  waiting: "tint",
  running: "tint",
  settling: "tint",
  ready: "green",
  failed: "red",
  canceled: "tertiaryLabel",
} satisfies Record<StartupAttempt["status"]["phase"], ThemeColorName>;

type StartupTraceRow = ReturnType<typeof startupTraceRows>[number];

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
  const rows = attempt ? startupTraceRows(attempt) : [];
  const traceAvailable = rows.length > 0;
  const progressKey = expectedPresentation === "notification" ? "progress-collapsed" : "progress";
  const progressOpen =
    traceAvailable && startupProgressExpanded(expectedPresentation, traceState.expanded[attemptId]);
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
      <StartupTraceSummary
        attempt={attempt}
        rows={rows}
        compact={compact}
        progressOpen={progressOpen}
      />
      {traceAvailable ? (
        <StartupTraceDetails
          attempt={attempt}
          rows={rows}
          compact={compact}
          mounted={progressOpen || progressViewed}
          visible={progressOpen}
        />
      ) : (
        <StartupStatusDetails attempt={attempt} compact={compact} />
      )}
      <StartupInstructionNotice instruction={attempt.instruction} />
      <StartupAttemptActions
        attempt={attempt}
        onContinueInBackground={onContinueInBackground}
        onEditChoices={onEditChoices}
        onRepairSavedSession={onRepairSavedSession}
        progressExpanded={progressOpen}
        onToggleProgress={
          compact && traceAvailable
            ? () => {
                setProgressViewed(true);
                traceState.toggle(attemptId, progressKey);
              }
            : undefined
        }
      />
    </View>
  );
}

function startupProgressExpanded(
  presentation: StartupPresentation,
  expanded: ReadonlySet<string> | undefined,
): boolean {
  if (presentation === "dialog") return true;
  if (presentation === "notification") return expanded?.has("progress-collapsed") !== true;
  return expanded?.has("progress") === true;
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
        {phase === "submitting" || phase === "running" || phase === "settling" ? (
          <LoaderSpinner size={16} colorStyle={styles.activeIcon} />
        ) : (
          <Icon name={PHASE_ICONS[phase]} size={16} color={PHASE_COLORS[phase]} />
        )}
        <Text
          variant="headline"
          accessibilityRole={compact ? "header" : "text"}
          numberOfLines={2}
          style={styles.title}
        >
          {PHASE_LABELS[phase]}
        </Text>
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
  rows,
  compact,
  progressOpen,
}: {
  attempt: StartupAttempt;
  rows: readonly StartupTraceRow[];
  compact: boolean;
  progressOpen: boolean;
}): ReactElement | null {
  if (!compact || rows.length === 0) return null;
  const steps = rows.map(({ step }) => step);
  const failedStep = steps.findLast(
    (step) =>
      step.state === "failed" ||
      step.failure ||
      (step.action?.result && !terminalCommandSucceeded(step.action.result)),
  );
  const activeStep =
    steps.findLast((step) => step.state === "running" || step.state === "waiting") ?? failedStep;
  return (
    <>
      {activeStep ? (
        <Text
          variant="footnote"
          tone={activeStep === failedStep ? "red" : "secondary"}
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
  rows,
  compact,
  mounted,
  visible,
}: {
  attempt: StartupAttempt;
  rows: readonly StartupTraceRow[];
  compact: boolean;
  mounted: boolean;
  visible: boolean;
}): ReactElement | null {
  const traceState = useStartupPresentation();
  const { height } = useWindowDimensions();
  if (!mounted) return null;
  const attemptId = attempt.id;
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
        {/* Keep expanded read-only terminal pages attached while startup rows change height. */}
        {/* react-doctor-disable-next-line react-doctor/rn-no-scrollview-mapped-list */}
        {rows.map(({ id, step }, index) => (
          <StartupStepRow
            key={id}
            attemptId={attemptId}
            step={step}
            last={index === rows.length - 1}
            expanded={traceState.expanded[attemptId]?.has(id) === true}
            toggle={() => traceState.toggle(attemptId, id)}
          />
        ))}
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

function StartupStatusDetails({
  attempt,
  compact,
}: {
  attempt: StartupAttempt;
  compact: boolean;
}): ReactElement | null {
  const { height } = useWindowDimensions();
  const failures = startupFailureRows(attempt);
  if (!attempt.error && failures.length === 0 && attempt.ownership.state !== "saved") return null;
  return (
    <ScrollView
      style={[styles.scroll, { maxHeight: compact ? 240 : Math.min(360, height * 0.5) }]}
      contentContainerStyle={styles.statusDetails}
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
    >
      {attempt.error ? (
        <Text variant="footnote" tone="red" selectable>
          {attempt.error}
        </Text>
      ) : null}
      {/* Failure output keeps its terminal page and selection while saved-session details change. */}
      {/* react-doctor-disable-next-line react-doctor/rn-no-scrollview-mapped-list */}
      {failures.map(({ id, step }) => (
        <View key={id} style={styles.failure}>
          {step.failure ? (
            <Text variant="footnote" tone="red" selectable>
              {step.failure.message}
              {step.failure.nextAction ? ` ${step.failure.nextAction}` : ""}
            </Text>
          ) : null}
          <StartupStepDetails attemptId={attempt.id} step={step} />
        </View>
      ))}
      <StartupSavedSession attempt={attempt} />
    </ScrollView>
  );
}

function startupAnnouncement(
  attempt: StartupAttempt | null,
  expectedPresentation: StartupPresentation,
): string | null {
  if (!attempt || attempt.presentation !== expectedPresentation) return null;
  const current = attempt.status.confirmation === "current";
  const steps = startupTraceRows(attempt).map(({ step }) => step);
  const activeStep =
    steps.findLast((step) => step.state === "running" || step.state === "waiting") ??
    steps.findLast(
      (step) =>
        step.state === "failed" ||
        step.failure ||
        (step.action?.result && !terminalCommandSucceeded(step.action.result)),
    );
  const state =
    activeStep?.action?.result && !terminalCommandSucceeded(activeStep.action.result)
      ? "failed"
      : activeStep?.state.replace("_", " ");
  const stepAnnouncement = activeStep ? ` ${activeStep.label}. ${state}.` : "";
  const failure = attempt.error ? ` ${attempt.error}` : "";
  return `${attempt.label}. ${PHASE_LABELS[attempt.status.phase]}.${current ? stepAnnouncement : " Waiting for the host to confirm the outcome."}${failure}`;
}

const styles = StyleSheet.create((theme) => ({
  activeIcon: { color: theme.colors.tint },
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
  statusDetails: { gap: theme.space.sm },
  failure: { gap: theme.space.xs },
}));
