import type {
  AgentSessionUsageLimit,
  RuntimeDescriptor,
  UsageLimitAutoResume,
} from "@openducktor/contracts";
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
import { useAgentOperationsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { INTERRUPTED_TURN_COPY } from "@openducktor/frontend-core/sessions/session-view/interrupted-turn-copy";
import {
  buildInterruptedTurnNotice,
  interruptedTurnDetailText,
} from "@openducktor/frontend-core/sessions/session-view/interrupted-turn-notice";
import { useInterruptedTurnClock } from "@openducktor/frontend-core/sessions/session-view/use-interrupted-turn-clock";
import { useInterruptedTurnResume } from "@openducktor/frontend-core/sessions/session-view/use-interrupted-turn-resume";
import { useUsageLimitAutoResumeCancel } from "@openducktor/frontend-core/sessions/session-view/use-usage-limit-auto-resume-cancel";
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
  autoResume: UsageLimitAutoResume | undefined;
};

const NO_RESUME: ResumeFacts = Object.freeze({
  canResume: false,
  isLatestTurnSettled: false,
  usageLimit: undefined,
  autoResume: undefined,
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
    autoResume: session.usageLimitAutoResume,
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
  const { continueInterruptedTurn, cancelUsageLimitAutoResume } = useAgentOperationsContext();
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
  const { autoResume } = facts;
  const cancelStop = useCallback(
    (stopId: string) => cancelUsageLimitAutoResume(identity, stopId),
    [cancelUsageLimitAutoResume, identity],
  );
  const autoResumeCancel = useUsageLimitAutoResumeCancel(autoResume, cancelStop);
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
        autoResume={autoResume}
        isResuming={isResuming}
        resumeError={error}
        cancelError={autoResumeCancel.error}
        errorTitle={errorTitle}
        renderActions={(notice) => (
          <>
            {notice.canCancelAutoResume ? (
              <SessionButton
                label={
                  autoResumeCancel.isCanceling
                    ? INTERRUPTED_TURN_COPY.canceling
                    : INTERRUPTED_TURN_COPY.cancelAutoResume
                }
                icon="x"
                variant="outline"
                command
                loading={autoResumeCancel.isCanceling}
                disabled={!interaction.canInteract}
                accessibilityHint={
                  interaction.blockedReason ?? "Keeps this stop for a manual Resume."
                }
                onPress={autoResumeCancel.cancel}
              />
            ) : null}
            <SessionButton
              label={
                notice.isResuming ? INTERRUPTED_TURN_COPY.resuming : INTERRUPTED_TURN_COPY.resume
              }
              icon="play"
              variant="outline"
              command
              loading={notice.isResuming}
              disabled={!interaction.canInteract}
              accessibilityHint={
                interaction.blockedReason ?? "Continues the turn without a new message."
              }
              onPress={() => resume.resume(identity)}
            />
          </>
        )}
      />
    </View>
  );
}

/**
 * The desktop `AgentChatInterruptedTurnResume`: an info row with the interrupted turn, its
 * actions, and the resume error. A usage limit shows the time until it resets, or the planned
 * auto-resume of the host.
 */
function ResumeOffer({
  usageLimit,
  autoResume,
  isResuming,
  resumeError,
  cancelError,
  errorTitle,
  renderActions,
}: {
  usageLimit: AgentSessionUsageLimit | undefined;
  autoResume: UsageLimitAutoResume | undefined;
  isResuming: boolean;
  resumeError: string | null;
  cancelError: string | null;
  errorTitle: string;
  renderActions: (notice: ReturnType<typeof buildInterruptedTurnNotice>) => ReactNode;
}): ReactElement {
  const theme = useAppTheme();
  const now = useInterruptedTurnClock(usageLimit, autoResume);
  const notice = buildInterruptedTurnNotice({
    usageLimit,
    autoResume,
    isResuming,
    resumeError,
    now,
  });
  const detail = interruptedTurnDetailText(notice.detail, (time) => time.toLocaleString());
  const error = notice.error ? `${errorTitle}: ${notice.error}` : cancelError;
  return (
    <View style={styles.offer}>
      <View style={styles.offerIcon}>
        <Icon name="info" size={16} colorValue={theme.desktop.infoAccent} />
      </View>
      <View style={styles.offerText} accessible accessibilityLabel={`${notice.title}. ${detail}`}>
        <Text variant="callout" weight="medium" style={styles.offerForeground}>
          {notice.title}
        </Text>
        <Text variant="footnote" style={styles.offerForeground}>
          {detail}
        </Text>
      </View>
      <View style={styles.offerAction}>{renderActions(notice)}</View>
      {error ? (
        <Text variant="footnote" selectable accessibilityRole="alert" style={styles.offerError}>
          {error}
        </Text>
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
  offerAction: { marginLeft: "auto", flexDirection: "row", gap: theme.space.sm },
  offerError: { width: "100%", color: theme.desktop.destructiveMuted },
}));
