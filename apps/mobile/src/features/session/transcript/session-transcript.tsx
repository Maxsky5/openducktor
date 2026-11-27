import type {
  AgentChatRuntimePresentation,
  AgentChatTranscriptNotice,
} from "@openducktor/frontend-core/sessions/send/agent-chat.types";
import type { AgentChatTranscriptSession } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript.types";
import { useAgentChatTranscriptModel } from "@openducktor/frontend-core/sessions/transcript/use-agent-chat-transcript-model";
import type { AgentSessionTranscriptTarget } from "@openducktor/frontend-core/sessions/transcript/agent-session-transcript-target";
import { memo, type ReactElement, type ReactNode, useMemo, useState } from "react";
import { ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useDevicePreferences } from "@/app-shell/app-services";
import { useSessionTarget } from "@/features/session/session-target";
import { KEYBOARD_DISMISS_ON_DRAG } from "@/ui/keyboard-dismiss";
import type { JumpToLatestSignal } from "./jump-to-latest-signal";
import { createDisclosureStore, DisclosureStoreProvider } from "./rows/disclosure";
import { TranscriptList } from "./transcript-list";
import { EmptyTranscript, TranscriptNotice, TranscriptStartupTrace } from "./transcript-notice";
import { mobileTranscriptRows } from "./transcript-row-type";
import { TranscriptSkeleton } from "./transcript-skeleton";

export type SessionTranscriptProps = {
  /** The transcript to show, or null while it loads or after it failed. */
  transcriptSession: AgentChatTranscriptSession | null;
  /** A loading, failure, or warning notice, with an action such as Retry. */
  notice: AgentChatTranscriptNotice | null;
  /** An active inline startup attempt rendered at the top of the transcript. */
  startupAttemptId?: string | null | undefined;
  isLoading: boolean;
  runtimePresentation: AgentChatRuntimePresentation;
  /** Pending approvals and questions of each Subagent session, by session key. */
  subagentPendingCountBySessionKey: Readonly<Record<string, number>>;
  onOpenSubagent: (target: AgentSessionTranscriptTarget) => void;
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
  startupAttemptId = null,
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
        <EmptyOrLoadingWithStartup startupAttemptId={startupAttemptId}>
          <TranscriptStatus notice={notice} isLoading={isLoading} />
        </EmptyOrLoadingWithStartup>
      ) : !hasRowsForActiveSession ? (
        <EmptyOrLoadingWithStartup startupAttemptId={startupAttemptId}>
          <TranscriptSkeleton label="Loading session" />
        </EmptyOrLoadingWithStartup>
      ) : rows.length === 0 ? (
        <EmptyTranscriptScroll notice={notice} startupAttemptId={startupAttemptId} />
      ) : (
        <TranscriptList
          // A new session mounts a new list, so it opens at its latest message.
          key={sessionKey}
          rows={rows}
          activeStreamingMessageId={transcriptState.activeStreamingAssistantMessageId}
          messagesVersion={transcriptSession.messages.version}
          notice={notice}
          startupAttemptId={startupAttemptId}
          presentToolCall={runtimePresentation.presentToolCall}
          subagentPendingCountBySessionKey={subagentPendingCountBySessionKey}
          onOpenSubagent={onOpenSubagent}
          latestSignal={latestSignal}
        />
      )}
    </DisclosureStoreProvider>
  );
});

function TranscriptEmptyScroll({
  startupAttemptId,
  children,
}: {
  startupAttemptId: string | null;
  children: ReactNode;
}): ReactElement {
  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.emptyContent}
      keyboardDismissMode={KEYBOARD_DISMISS_ON_DRAG}
      keyboardShouldPersistTaps="handled"
    >
      {startupAttemptId ? <TranscriptStartupTrace attemptId={startupAttemptId} /> : null}
      {children}
    </ScrollView>
  );
}

function EmptyTranscriptScroll({
  notice,
  startupAttemptId,
}: {
  notice: SessionTranscriptProps["notice"];
  startupAttemptId: string | null;
}): ReactElement {
  return (
    <TranscriptEmptyScroll startupAttemptId={startupAttemptId}>
      {notice ? <TranscriptNotice notice={notice} /> : null}
      {/* Work that the notice shows, such as branch naming, brings the first message. */}
      {notice?.severity === "loading" || startupAttemptId ? null : <EmptyTranscript />}
    </TranscriptEmptyScroll>
  );
}

function EmptyOrLoadingWithStartup({
  startupAttemptId,
  children,
}: {
  startupAttemptId: string | null;
  children: ReactElement;
}): ReactElement {
  if (!startupAttemptId) return children;
  return (
    <TranscriptEmptyScroll startupAttemptId={startupAttemptId}>{children}</TranscriptEmptyScroll>
  );
}

/** The notices that load the transcript itself. They show its skeleton. */
const TRANSCRIPT_LOAD_NOTICES: ReadonlySet<AgentChatTranscriptNotice["kind"]> = new Set([
  "runtime_waiting",
  "session_loading",
]);

/** The state of a transcript that has no rows to show yet. */
function TranscriptStatus({
  notice,
  isLoading,
}: {
  notice: AgentChatTranscriptNotice | null;
  isLoading: boolean;
}): ReactElement {
  if (notice && TRANSCRIPT_LOAD_NOTICES.has(notice.kind))
    return <TranscriptSkeleton label={notice.title} />;
  if (notice) return <TranscriptNotice notice={notice} />;
  if (isLoading) return <TranscriptSkeleton label="Loading session" />;
  return <EmptyTranscript />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  emptyContent: { flexGrow: 1 },
});
