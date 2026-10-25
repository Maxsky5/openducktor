import type {
  AgentChatRuntimePresentation,
  AgentChatTranscriptNotice,
} from "@openducktor/frontend-core/sessions/send/agent-chat.types";
import type { AgentChatTranscriptSession } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript.types";
import { useAgentChatTranscriptModel } from "@openducktor/frontend-core/sessions/transcript/use-agent-chat-transcript-model";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { memo, type ReactElement, useMemo, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useDevicePreferences } from "@/app-shell/app-services";
import { useSessionTarget } from "@/features/session/session-target";
import type { JumpToLatestSignal } from "./jump-to-latest-signal";
import { createDisclosureStore, DisclosureStoreProvider } from "./rows/disclosure";
import { TranscriptList } from "./transcript-list";
import { EmptyTranscript, TranscriptNotice } from "./transcript-notice";
import { mobileTranscriptRows } from "./transcript-row-type";
import { TranscriptSkeleton } from "./transcript-skeleton";

export type SessionTranscriptProps = {
  /** The transcript to show, or null while it loads or after it failed. */
  transcriptSession: AgentChatTranscriptSession | null;
  /** A loading, failure, or warning notice, with an action such as Retry. */
  notice: AgentChatTranscriptNotice | null;
  isLoading: boolean;
  runtimePresentation: AgentChatRuntimePresentation;
  /** Pending approvals and questions of each Subagent session, by session key. */
  subagentPendingCountBySessionKey: Readonly<Record<string, number>>;
  onOpenSubagent: (identity: AgentSessionIdentity) => void;
  /** Increases after the user sends a message. The list then jumps to the latest message. */
  latestSignal: JumpToLatestSignal;
};

/**
 * The transcript of the open session. Only the open session builds rows. A new session opens
 * at the latest message, the list follows live content at the bottom, and it keeps its place
 * when the reader scrolls up.
 */
export const SessionTranscript = memo(function SessionTranscript({
  transcriptSession,
  notice,
  isLoading,
  runtimePresentation,
  subagentPendingCountBySessionKey,
  onOpenSubagent,
  latestSignal,
}: SessionTranscriptProps): ReactElement {
  const { sessionKey } = useSessionTarget();
  const showReasoning = useDevicePreferences((state) => state.preferences.showReasoning);
  const { transcriptState, hasRowsForActiveSession } = useAgentChatTranscriptModel({
    session: transcriptSession,
    showThinkingMessages: showReasoning,
  });
  const rows = useMemo(() => mobileTranscriptRows(transcriptState.rows), [transcriptState.rows]);
  // The reader's open and closed parts of this screen, which outlive the reused row views.
  const [disclosures] = useState(createDisclosureStore);
  return (
    <DisclosureStoreProvider value={disclosures}>
      {transcriptSession === null ? (
        <TranscriptStatus notice={notice} isLoading={isLoading} />
      ) : !hasRowsForActiveSession ? (
        <TranscriptSkeleton label="Loading session" />
      ) : rows.length === 0 ? (
        <View style={styles.fill}>
          {notice ? <TranscriptNotice notice={notice} /> : null}
          <EmptyTranscript />
        </View>
      ) : (
        <TranscriptList
          // A new session mounts a new list, so it opens at its latest message.
          key={sessionKey}
          rows={rows}
          activeStreamingMessageId={transcriptState.activeStreamingAssistantMessageId}
          messagesVersion={transcriptSession.messages.version}
          notice={notice}
          presentToolCall={runtimePresentation.presentToolCall}
          subagentPendingCountBySessionKey={subagentPendingCountBySessionKey}
          onOpenSubagent={onOpenSubagent}
          latestSignal={latestSignal}
        />
      )}
    </DisclosureStoreProvider>
  );
});

/** The state of a transcript that has no rows to show yet. */
function TranscriptStatus({
  notice,
  isLoading,
}: {
  notice: AgentChatTranscriptNotice | null;
  isLoading: boolean;
}): ReactElement {
  if (notice?.severity === "loading") return <TranscriptSkeleton label={notice.title} />;
  if (notice) return <TranscriptNotice notice={notice} />;
  if (isLoading) return <TranscriptSkeleton label="Loading session" />;
  return <EmptyTranscript />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
