import type { AgentSessionUsageLimit, RuntimeDescriptor } from "@openducktor/contracts";
import { useRuntimeAvailabilityContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import {
  isOutcomeUnknown,
  RESULT_UNKNOWN_TITLE,
} from "@openducktor/frontend-core/lib/command-outcome";
import { getAgentSessionActivityStateFromSession } from "@openducktor/frontend-core/lib/agent-session-activity-state";
import {
  canResumeInterruptedTurn,
  hasSettledLatestTurn,
  latestTurnUsageLimit,
} from "@openducktor/frontend-core/lib/agent-session-interrupted-turn";
import { useMinuteClock } from "@openducktor/frontend-core/lib/relative-time";
import { useAgentOperationsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import {
  INTERRUPTED_TURN_COPY,
  interruptedTurnTitle,
  usageLimitCountdown,
  usageLimitResetText,
} from "@openducktor/frontend-core/sessions/session-view/interrupted-turn-copy";
import { useInterruptedTurnResume } from "@openducktor/frontend-core/sessions/session-view/use-interrupted-turn-resume";
import type {
  AgentSessionIdentity,
  AgentSessionState,
} from "@openducktor/frontend-core/types/agent-orchestrator";
import { type ReactElement, type ReactNode, useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { SessionButton } from "../session-button";
import { SessionNoticeRow } from "../session-notice-row";
import { useSessionScreen, useSessionTarget } from "../session-target";
import { useSessionSelector } from "../use-session-selector";

type ResumeFacts = {
  canResume: boolean;
  isLatestTurnSettled: boolean;
  usageLimit: AgentSessionUsageLimit | undefined;
};

const NO_RESUME: ResumeFacts = Object.freeze({
  canResume: false,
  isLatestTurnSettled: false,
  usageLimit: undefined,
});

const selectResumeFacts = (
  session: AgentSessionState | null,
  runtimeDescriptor: RuntimeDescriptor | null,
): ResumeFacts => {
  if (!session) return NO_RESUME;
  const messages = session.messages.items;
  return {
    canResume: canResumeInterruptedTurn({
      activityState: getAgentSessionActivityStateFromSession(session),
      messages,
      runtimeDescriptor,
    }),
    isLatestTurnSettled: hasSettledLatestTurn(messages),
    usageLimit: latestTurnUsageLimit(messages),
  };
};

/**
 * Offers Resume for an interrupted turn when the runtime supports it, as a compact notice above
 * the composer. A resume that the runtime could not answer keeps its notice after the turn stops
 * offering Resume.
 */
export function SessionResumeNotice(): ReactElement | null {
  const target = useSessionTarget();
  if (target.readOnly) return null;
  return <ResumeNotice />;
}

function ResumeNotice(): ReactElement | null {
  const { target, interaction } = useSessionScreen();
  const { identity, sessionKey } = target;
  const { allRuntimeDefinitions } = useRuntimeAvailabilityContext();
  const runtimeDescriptor =
    allRuntimeDefinitions.find((definition) => definition.kind === identity.runtimeKind) ?? null;
  const select = useMemo(
    () => (session: AgentSessionState | null) => selectResumeFacts(session, runtimeDescriptor),
    [runtimeDescriptor],
  );
  const facts = useSessionSelector(identity, select);
  const { continueInterruptedTurn } = useAgentOperationsContext();
  // A lost result keeps its own title, so the user reads the host state before acting again.
  const [unknownSessionKey, setUnknownSessionKey] = useState<string | null>(null);
  const continueTurn = useCallback(
    async (session: AgentSessionIdentity): Promise<void> => {
      setUnknownSessionKey(null);
      try {
        await continueInterruptedTurn(session);
      } catch (cause) {
        if (isOutcomeUnknown(cause)) setUnknownSessionKey(sessionKey);
        throw cause;
      }
    },
    [continueInterruptedTurn, sessionKey],
  );
  const resume = useInterruptedTurnResume(continueTurn, {
    sessionKey,
    isLatestTurnSettled: facts.isLatestTurnSettled,
  });
  const isResuming = resume.isSessionResuming(sessionKey);
  const error = resume.resumeErrorForSession(sessionKey);
  const persistentError = resume.persistentResumeErrorForSession(sessionKey);
  const unknown = unknownSessionKey === sessionKey;
  const errorTitle = unknown ? RESULT_UNKNOWN_TITLE : "Resume failed";

  if (!facts.canResume) {
    return persistentError ? (
      <View style={styles.wrap}>
        <SessionNoticeRow tone="destructive" title={errorTitle}>
          {persistentError}
        </SessionNoticeRow>
      </View>
    ) : null;
  }

  return (
    <View style={styles.wrap}>
      <ResumeOffer
        usageLimit={facts.usageLimit}
        error={error}
        errorTitle={errorTitle}
        action={
          <SessionButton
            label={isResuming ? INTERRUPTED_TURN_COPY.resuming : INTERRUPTED_TURN_COPY.resume}
            icon="play"
            variant="outline"
            command
            loading={isResuming}
            disabled={!interaction.canInteract}
            accessibilityHint={
              interaction.blockedReason ?? "Continues the turn without a new message."
            }
            onPress={() => resume.resume(identity)}
          />
        }
      />
    </View>
  );
}

/**
 * The desktop `AgentChatInterruptedTurnResume`: an info row with the interrupted turn, the
 * Resume button, and the resume error. A usage limit shows the time until it resets.
 */
function ResumeOffer({
  usageLimit,
  error,
  errorTitle,
  action,
}: {
  usageLimit: AgentSessionUsageLimit | undefined;
  error: string | null;
  errorTitle: string;
  action: ReactNode;
}): ReactElement {
  const theme = useAppTheme();
  const now = useMinuteClock();
  let detail: string = INTERRUPTED_TURN_COPY.stoppedDetail;
  if (usageLimit) {
    detail = INTERRUPTED_TURN_COPY.usageLimitWithoutReset;
    if (usageLimit.resetsAtEpochMs !== undefined) {
      const countdown = usageLimitCountdown(usageLimit.resetsAtEpochMs, now);
      detail =
        countdown.kind === "passed"
          ? INTERRUPTED_TURN_COPY.usageLimitResetPassed
          : usageLimitResetText(countdown.remaining, countdown.resetsAt.toLocaleString());
    }
  }
  const title = interruptedTurnTitle(usageLimit);
  return (
    <View style={styles.offer}>
      <View style={styles.offerIcon}>
        <Icon name="info" size={16} colorValue={theme.desktop.infoAccent} />
      </View>
      <View style={styles.offerText} accessible accessibilityLabel={`${title}. ${detail}`}>
        <Text variant="callout" weight="medium" style={styles.offerForeground}>
          {title}
        </Text>
        <Text variant="footnote" style={styles.offerForeground}>
          {detail}
        </Text>
      </View>
      <View style={styles.offerAction}>{action}</View>
      {error ? (
        <Text
          variant="footnote"
          selectable
          accessibilityRole="alert"
          style={styles.offerError}
        >{`${errorTitle}: ${error}`}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { paddingHorizontal: theme.space.md, paddingTop: theme.space.sm },
  offer: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.space.md,
    rowGap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.infoBorder,
    backgroundColor: theme.desktop.infoSurface,
  },
  offerIcon: { alignSelf: "flex-start", paddingTop: 2 },
  offerText: { flex: 1, minWidth: 160 },
  offerForeground: { color: theme.desktop.infoSurfaceForeground },
  offerAction: { marginLeft: "auto" },
  offerError: { width: "100%", color: theme.desktop.destructiveMuted },
}));
