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
import { startupIsPending } from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import { terminalCommandSucceeded } from "@openducktor/frontend-core/terminals/terminal-command-result";
import { type ReactElement, useState } from "react";
import { ScrollView, useWindowDimensions, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import type { ThemeColorName } from "@/theme/tokens";
import { Icon, type IconName } from "@/ui/icon";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
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
  detailsMaxHeight,
}: {
  attemptId: string;
  onContinueInBackground?: (() => void) | undefined;
  onEditChoices?: (() => void) | undefined;
  onRepairSavedSession?: (() => void) | undefined;
  presentation?: StartupPresentation;
  detailsMaxHeight?: number;
}): ReactElement | null {
  const attempt = useStartupAttempt(attemptId);
  const { startupAttempts } = useClientConnection();
  const traceState = useStartupPresentation();
  const compact = expectedPresentation !== "dialog";
  const rows = attempt ? startupTraceRows(attempt) : [];
  const traceAvailable = rows.length > 0;
  const progressOpen =
    traceAvailable && (!compact || traceState.expanded[attemptId]?.has("progress") === true);
  const [progressViewed, setProgressViewed] = useState(progressOpen);
  useAnnounce(startupAnnouncement(attempt, expectedPresentation));
  if (!attempt || attempt.presentation !== expectedPresentation) return null;
  if (
    expectedPresentation === "inline" &&
    startupAttempts.isReadyForHandoff(attemptId) &&
    hasConfirmedReadyState(attempt)
  )
    return null;
  const toggleProgress =
    compact && traceAvailable
      ? () => {
          setProgressViewed(true);
          traceState.toggle(attemptId, "progress");
        }
      : undefined;
  return (
    <View style={[styles.root, compact ? styles.compact : styles.full]}>
      <StartupTraceHeader
        attempt={attempt}
        compact={compact}
        progressExpanded={progressOpen}
        onToggleProgress={toggleProgress}
      />
      <StartupTraceSummary
        attempt={attempt}
        rows={rows}
        compact={compact}
        progressOpen={progressOpen}
      />
      {traceAvailable ? (
        <StartupTraceDetails
          key={attemptId}
          attempt={attempt}
          rows={rows}
          compact={compact}
          mounted={progressOpen || progressViewed}
          visible={progressOpen}
          maxHeight={detailsMaxHeight}
        />
      ) : (
        <StartupStatusDetails
          key={attemptId}
          attempt={attempt}
          compact={compact}
          maxHeight={detailsMaxHeight}
        />
      )}
      <StartupInstructionNotice instruction={attempt.instruction} />
      <StartupAttemptActions
        attempt={attempt}
        onContinueInBackground={onContinueInBackground}
        onEditChoices={onEditChoices}
        onRepairSavedSession={onRepairSavedSession}
        progressExpanded={progressOpen}
        onToggleProgress={toggleProgress}
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
  progressExpanded,
  onToggleProgress,
}: {
  attempt: StartupAttempt;
  compact: boolean;
  progressExpanded: boolean;
  onToggleProgress: (() => void) | undefined;
}): ReactElement {
  const theme = useAppTheme();
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
      <View
        style={[
          styles.phaseIcon,
          { backgroundColor: withAlpha(theme.colors[PHASE_COLORS[phase]], 0.12) },
        ]}
      >
        {phase === "submitting" || phase === "running" || phase === "settling" ? (
          <LoaderSpinner size={16} colorStyle={styles.activeIcon} />
        ) : (
          <Icon name={PHASE_ICONS[phase]} size={16} color={PHASE_COLORS[phase]} />
        )}
      </View>
      <View style={styles.heading}>
        <Text
          variant="headline"
          accessibilityRole={compact ? "header" : "text"}
          numberOfLines={2}
          style={styles.title}
        >
          {PHASE_LABELS[phase]}
        </Text>
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
      <StartupNotificationControls
        attempt={attempt}
        progressExpanded={progressExpanded}
        onToggleProgress={onToggleProgress}
      />
    </View>
  );
}

function StartupNotificationControls({
  attempt,
  progressExpanded,
  onToggleProgress,
}: {
  attempt: StartupAttempt;
  progressExpanded: boolean;
  onToggleProgress: (() => void) | undefined;
}): ReactElement | null {
  const { startupAttempts } = useClientConnection();
  if (attempt.presentation !== "notification") return null;
  const settled = !startupIsPending(attempt);
  if (!onToggleProgress && !settled) return null;
  return (
    <View style={styles.headerActions}>
      {onToggleProgress ? (
        <Touchable
          feedback="opacity"
          onPress={onToggleProgress}
          accessibilityRole="button"
          accessibilityLabel={progressExpanded ? "Hide startup progress" : "Show startup progress"}
          accessibilityState={{ expanded: progressExpanded }}
          style={styles.headerAction}
        >
          <Icon
            name={progressExpanded ? "chevron-up" : "chevron-down"}
            size={16}
            color="secondaryLabel"
          />
        </Touchable>
      ) : null}
      {settled ? (
        <Touchable
          feedback="opacity"
          onPress={() => startupAttempts.dismiss(attempt.id)}
          accessibilityRole="button"
          accessibilityLabel="Dismiss startup notification"
          style={styles.headerAction}
        >
          <Icon name="x" size={16} color="secondaryLabel" />
        </Touchable>
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
      {activeStep && !progressOpen ? (
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
  maxHeight,
}: {
  attempt: StartupAttempt;
  rows: readonly StartupTraceRow[];
  compact: boolean;
  mounted: boolean;
  visible: boolean;
  maxHeight: number | undefined;
}): ReactElement | null {
  const traceState = useStartupPresentation();
  const { height } = useWindowDimensions();
  const [initialOffset] = useState(() => ({
    x: 0,
    y: traceState.scroll.get(attempt.id) ?? 0,
  }));
  if (!mounted) return null;
  const attemptId = attempt.id;
  return (
    <View
      style={visible ? styles.progress : styles.hiddenProgress}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
    >
      <ScrollView
        style={[
          styles.scroll,
          { maxHeight: maxHeight ?? (compact ? 240 : Math.min(360, height * 0.5)) },
        ]}
        contentContainerStyle={styles.steps}
        nestedScrollEnabled
        bounces={false}
        alwaysBounceVertical={false}
        overScrollMode="never"
        keyboardShouldPersistTaps="handled"
        contentOffset={initialOffset}
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
  maxHeight,
}: {
  attempt: StartupAttempt;
  compact: boolean;
  maxHeight: number | undefined;
}): ReactElement | null {
  const { height } = useWindowDimensions();
  const traceState = useStartupPresentation();
  const [initialOffset] = useState(() => ({
    x: 0,
    y: traceState.scroll.get(attempt.id) ?? 0,
  }));
  const failures = startupFailureRows(attempt);
  if (!attempt.error && failures.length === 0 && attempt.ownership.state !== "saved") return null;
  return (
    <ScrollView
      style={[
        styles.scroll,
        { maxHeight: maxHeight ?? (compact ? 240 : Math.min(360, height * 0.5)) },
      ]}
      contentContainerStyle={styles.statusDetails}
      nestedScrollEnabled
      bounces={false}
      alwaysBounceVertical={false}
      overScrollMode="never"
      keyboardShouldPersistTaps="handled"
      contentOffset={initialOffset}
      onScroll={(event) => traceState.scroll.set(attempt.id, event.nativeEvent.contentOffset.y)}
      scrollEventThrottle={100}
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
  root: { gap: theme.space.sm, flexShrink: 1, minHeight: 0 },
  full: { maxHeight: "100%", padding: theme.layout.screenPadding },
  compact: { padding: theme.space.md },
  header: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.md, flexShrink: 0 },
  phaseIcon: {
    width: 32,
    height: 32,
    borderRadius: theme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  heading: { flex: 1, minWidth: 0, gap: theme.space.xxs },
  headerActions: { flexDirection: "row", flexShrink: 0 },
  headerAction: {
    minWidth: theme.touchTarget,
    minHeight: theme.touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { minWidth: 0 },
  progress: { flexShrink: 1, minHeight: 0 },
  hiddenProgress: { display: "none" },
  scroll: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
  steps: { paddingBottom: theme.space.xs },
  statusDetails: { gap: theme.space.sm },
  failure: { gap: theme.space.xs },
}));
