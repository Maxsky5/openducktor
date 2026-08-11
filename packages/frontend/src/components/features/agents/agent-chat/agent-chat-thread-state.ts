import type { SessionHistoryFailure } from "@openducktor/contracts";
import type { RepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import {
  type AgentSessionTranscriptState,
  isAgentSessionTranscriptLoading,
} from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import type {
  AgentChatThreadSession,
  AgentChatTranscriptNotice,
  AgentChatTranscriptNoticeAction,
} from "./agent-chat.types";

export type AgentChatThreadState = {
  threadSession: AgentChatThreadSession | null;
  displayedSessionKey: string | null;
  shouldResetTranscriptWindow: boolean;
  transcriptNotice: AgentChatTranscriptNotice | null;
};

type ProjectAgentChatThreadStateArgs = {
  sessionKey: string | null;
  session: AgentChatThreadSession | null;
  transcriptState: AgentSessionTranscriptState;
  runtimeReadiness: RepoRuntimeReadiness;
  failedTranscriptAction?: AgentChatTranscriptNoticeAction | null | undefined;
};

const sessionHistoryFailureDetails = (
  failure: SessionHistoryFailure,
): Array<{ label: string; value: string }> => [
  { label: "Error", value: failure.detail },
  ...(failure.method ? [{ label: "Method", value: failure.method }] : []),
  ...(failure.pageCursor !== undefined
    ? [{ label: "Page cursor", value: failure.pageCursor ?? "First page" }]
    : []),
  ...(failure.diagnosticId ? [{ label: "Diagnostic ID", value: failure.diagnosticId }] : []),
];

const sessionHistoryFailureNotice = ({
  failure,
  hasTranscript,
  action,
}: {
  failure: SessionHistoryFailure;
  hasTranscript: boolean;
  action?: AgentChatTranscriptNoticeAction | null | undefined;
}): AgentChatTranscriptNotice => ({
  kind: hasTranscript ? "session_history_warning" : "session_failed",
  severity: "error",
  title: hasTranscript ? "History may be incomplete" : "Couldn't load conversation history",
  description: failure.summary,
  details: sessionHistoryFailureDetails(failure),
  ...(action ? { action } : {}),
});

const deriveAgentChatTranscriptNotice = ({
  transcriptState,
  runtimeReadiness,
  failedTranscriptAction,
}: {
  transcriptState: AgentSessionTranscriptState;
  runtimeReadiness: RepoRuntimeReadiness;
  failedTranscriptAction?: AgentChatTranscriptNoticeAction | null | undefined;
}): AgentChatTranscriptNotice | null => {
  if (
    transcriptState.kind === "runtime_waiting" &&
    runtimeReadiness.state === "blocked" &&
    runtimeReadiness.message
  ) {
    return {
      kind: "runtime_blocked",
      severity: "error",
      title: "Runtime unavailable",
      description: runtimeReadiness.message,
    };
  }

  if (transcriptState.kind === "runtime_waiting") {
    return {
      kind: "runtime_waiting",
      severity: "loading",
      title: "Runtime is starting",
      description:
        runtimeReadiness.message ??
        "Waiting for runtime and MCP health before loading this session.",
    };
  }

  if (transcriptState.kind === "session_loading") {
    return {
      kind: "session_loading",
      severity: "loading",
      title: "Loading session",
      description:
        transcriptState.reason === "history"
          ? "Loading the selected conversation."
          : "Preparing the selected session view.",
    };
  }

  if (transcriptState.kind === "visible" && transcriptState.historyFailure) {
    return sessionHistoryFailureNotice({
      failure: transcriptState.historyFailure,
      hasTranscript: true,
      action: failedTranscriptAction,
    });
  }

  if (transcriptState.kind === "failed") {
    if (transcriptState.historyFailure) {
      return sessionHistoryFailureNotice({
        failure: transcriptState.historyFailure,
        hasTranscript: false,
        action: failedTranscriptAction,
      });
    }

    return {
      kind: "session_failed",
      severity: "error",
      title: "Failed to load session",
      description: transcriptState.message,
      ...(failedTranscriptAction ? { action: failedTranscriptAction } : {}),
    };
  }

  return null;
};

const hidesExistingSessionTranscript = (transcriptState: AgentSessionTranscriptState): boolean =>
  transcriptState.kind === "empty" ||
  transcriptState.kind === "failed" ||
  transcriptState.kind === "session_loading";

export const projectAgentChatThreadState = ({
  sessionKey,
  session,
  transcriptState,
  runtimeReadiness,
  failedTranscriptAction,
}: ProjectAgentChatThreadStateArgs): AgentChatThreadState => {
  const threadSession = hidesExistingSessionTranscript(transcriptState) ? null : session;
  const shouldResetTranscriptWindow =
    isAgentSessionTranscriptLoading(transcriptState) && threadSession === null;
  const transcriptNotice = deriveAgentChatTranscriptNotice({
    transcriptState,
    runtimeReadiness,
    failedTranscriptAction,
  });

  return {
    threadSession,
    displayedSessionKey: sessionKey,
    shouldResetTranscriptWindow,
    transcriptNotice,
  };
};
