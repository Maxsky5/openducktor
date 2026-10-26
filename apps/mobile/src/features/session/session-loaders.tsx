import { useSelectedSessionContextLoad } from "@openducktor/frontend-core/sessions/agent-orchestrator/history/use-selected-session-context-load";
import { useSelectedSessionHistoryLoad } from "@openducktor/frontend-core/sessions/agent-orchestrator/history/use-selected-session-history-load";
import {
  deriveLoadedAgentSessionTranscriptState,
  isAgentSessionTranscriptLoading,
} from "@openducktor/frontend-core/sessions/agent-orchestrator/transcript/session-transcript-state";
import { useAgentSessionReadModelStateContext } from "@openducktor/frontend-core/sessions/session-contexts";
import type { AgentSessionState } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/ui/button";
import { SessionNoticeRow } from "./session-notice-row";
import { useSessionScreen } from "./session-target";
import { useSessionSelector } from "./use-session-selector";

const wholeSession = (session: AgentSessionState | null): AgentSessionState | null => session;

/**
 * True when the loads and the transcript state read the same facts of both sessions. A streamed
 * token changes only the messages, so the loaders do not render again for it.
 */
const sameLoadFacts = (left: AgentSessionState | null, right: AgentSessionState | null): boolean =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.externalSessionId === right.externalSessionId &&
    left.status === right.status &&
    left.pendingUserMessageStartedAt === right.pendingUserMessageStartedAt &&
    left.livePresence === right.livePresence &&
    left.historyLoadState === right.historyLoadState &&
    left.historyLoadFailure === right.historyLoadFailure &&
    left.contextUsage === right.contextUsage &&
    left.selectedModel === right.selectedModel &&
    left.sessionAssociation === right.sessionAssociation &&
    left.messages.externalSessionId === right.messages.externalSessionId &&
    left.messages.items.length === right.messages.items.length);

/**
 * Loads the history and context of the open session, as desktop does for the selected session.
 * Other sessions supply status only, so they never load history here. A failure of the session
 * read model or of the context shows as the desktop auxiliary error row above the composer. The
 * read model loads the history, so its failure has Retry. The row also says why messages are
 * paused when no other part of the screen says it.
 */
export function SessionLoaders(): ReactElement | null {
  const { target, interaction } = useSessionScreen();
  const session = useSessionSelector(target.identity, wholeSession, sameLoadFacts);
  const { sessionReadModelLoadState: readModel, reloadSessionReadModel } =
    useAgentSessionReadModelStateContext();
  const load = { session, runtimeReadinessState: interaction.runtimeReadiness.state };
  useSelectedSessionHistoryLoad(load);
  const contextError = useSelectedSessionContextLoad(load);
  // Until the history shows, the transcript names this failure with its own Retry.
  const historyShown =
    session !== null &&
    !isAgentSessionTranscriptLoading(
      deriveLoadedAgentSessionTranscriptState({
        session,
        runtimeReadinessState: load.runtimeReadinessState,
      }),
    );
  if (historyShown && readModel.kind === "failed") {
    return (
      <View style={styles.wrap}>
        <SessionNoticeRow
          tone="destructive"
          title="The session did not load"
          action={
            <Button
              label="Retry"
              icon="refresh-ccw"
              variant="outline"
              size="sm"
              onPress={reloadSessionReadModel}
            />
          }
        >
          {readModel.message}
        </SessionNoticeRow>
      </View>
    );
  }
  if (contextError) {
    return (
      <View style={styles.wrap}>
        <SessionNoticeRow tone="destructive" title="Session details could not load">
          {contextError}
        </SessionNoticeRow>
      </View>
    );
  }
  // A reason that no other part of the screen shows, such as a runtime that is not available.
  if (interaction.canInteract || interaction.reasonShown || !interaction.blockedReason) return null;
  return (
    <View style={styles.wrap}>
      <SessionNoticeRow tone="destructive" title="Messages are paused">
        {interaction.blockedReason}
      </SessionNoticeRow>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { paddingHorizontal: theme.space.md, paddingTop: theme.space.sm },
}));
