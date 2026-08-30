import type { SessionHistoryFailure } from "@openducktor/contracts";
import type { RepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import type { AgentSessionTranscriptState } from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import type {
  AgentChatTranscriptNotice,
  AgentChatTranscriptNoticeAction,
} from "./agent-chat.types";

type DeriveAgentChatReadinessInput = {
  transcriptState: AgentSessionTranscriptState;
  runtimeReadiness: Pick<RepoRuntimeReadiness, "state" | "message">;
  runtimeBlockedAction?: AgentChatTranscriptNoticeAction | null;
  failedTranscriptAction?: AgentChatTranscriptNoticeAction | null;
};

type AgentChatReadiness = {
  interactionEnabled: boolean;
  transcriptNotice: AgentChatTranscriptNotice | null;
};

const sessionHistoryFailureDetails = (
  failure: SessionHistoryFailure,
): Array<{ label: string; value: string }> => {
  const details = [{ label: "Error", value: failure.detail }];
  if (failure.method) details.push({ label: "Method", value: failure.method });
  if (failure.pageCursor !== undefined) {
    details.push({ label: "Page cursor", value: failure.pageCursor ?? "First page" });
  }
  if (failure.diagnosticId) details.push({ label: "Diagnostic ID", value: failure.diagnosticId });
  return details;
};

const sessionHistoryFailureNotice = ({
  failure,
  hasTranscript,
  action,
}: {
  failure: SessionHistoryFailure;
  hasTranscript: boolean;
  action?: AgentChatTranscriptNoticeAction | null | undefined;
}): AgentChatTranscriptNotice => {
  const notice: AgentChatTranscriptNotice = {
    kind: hasTranscript ? "session_history_warning" : "session_failed",
    severity: "error",
    title: hasTranscript ? "History may be incomplete" : "Couldn't load conversation history",
    description: failure.summary,
    details: sessionHistoryFailureDetails(failure),
  };
  if (action) notice.action = action;
  return notice;
};

export const deriveAgentChatReadiness = ({
  transcriptState,
  runtimeReadiness,
  runtimeBlockedAction,
  failedTranscriptAction,
}: DeriveAgentChatReadinessInput): AgentChatReadiness => {
  let transcriptNotice: AgentChatTranscriptNotice | null = null;

  if (transcriptState.kind === "runtime_waiting" && runtimeReadiness.state === "blocked") {
    const notice: AgentChatTranscriptNotice = {
      kind: "runtime_blocked",
      severity: "error",
      title: "Runtime unavailable",
      description:
        runtimeReadiness.message ?? "Runtime readiness is blocked without an error message.",
    };
    if (runtimeBlockedAction) notice.action = runtimeBlockedAction;
    transcriptNotice = notice;
  } else if (transcriptState.kind === "runtime_waiting") {
    transcriptNotice = {
      kind: "runtime_waiting",
      severity: "loading",
      title: "Runtime is starting",
      description:
        runtimeReadiness.message ??
        "Waiting for runtime and MCP health before loading this session.",
    };
  } else if (transcriptState.kind === "session_loading") {
    transcriptNotice = {
      kind: "session_loading",
      severity: "loading",
      title: "Loading session",
      description:
        transcriptState.reason === "history"
          ? "Loading the selected conversation."
          : "Preparing the selected session view.",
    };
  } else if (transcriptState.kind === "visible" && transcriptState.historyFailure) {
    transcriptNotice = sessionHistoryFailureNotice({
      failure: transcriptState.historyFailure,
      hasTranscript: true,
      action: failedTranscriptAction,
    });
  } else if (transcriptState.kind === "failed") {
    if (transcriptState.historyFailure) {
      transcriptNotice = sessionHistoryFailureNotice({
        failure: transcriptState.historyFailure,
        hasTranscript: false,
        action: failedTranscriptAction,
      });
    } else {
      const notice: AgentChatTranscriptNotice = {
        kind: "session_failed",
        severity: "error",
        title: "Failed to load session",
        description: transcriptState.message,
      };
      if (failedTranscriptAction) notice.action = failedTranscriptAction;
      transcriptNotice = notice;
    }
  }

  return {
    interactionEnabled: runtimeReadiness.state === "ready",
    transcriptNotice,
  };
};
