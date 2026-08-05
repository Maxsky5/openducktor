import type { SessionHistoryFailure } from "@openducktor/contracts";
import type {
  AgentChatTranscriptNotice,
  AgentChatTranscriptNoticeAction,
} from "./agent-chat.types";
import type { RepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import type { AgentSessionTranscriptState } from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";

type DeriveAgentChatReadinessInput = {
  transcriptState: AgentSessionTranscriptState;
  runtimeReadiness: RepoRuntimeReadiness;
  runtimeBlockedAction?: AgentChatTranscriptNoticeAction | null;
  failedTranscriptAction?: AgentChatTranscriptNoticeAction | null;
};

type AgentChatReadiness = {
  interactionEnabled: boolean;
  transcriptNotice: AgentChatTranscriptNotice | null;
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

export const deriveAgentChatReadiness = ({
  transcriptState,
  runtimeReadiness,
  runtimeBlockedAction,
  failedTranscriptAction,
}: DeriveAgentChatReadinessInput): AgentChatReadiness => {
  let transcriptNotice: AgentChatTranscriptNotice | null = null;

  if (
    transcriptState.kind === "runtime_waiting" &&
    runtimeReadiness.state === "blocked" &&
    runtimeReadiness.message
  ) {
    transcriptNotice = {
      kind: "runtime_blocked",
      severity: "error",
      title: "Runtime unavailable",
      description: runtimeReadiness.message,
      ...(runtimeBlockedAction ? { action: runtimeBlockedAction } : {}),
    };
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
    transcriptNotice = transcriptState.historyFailure
      ? sessionHistoryFailureNotice({
          failure: transcriptState.historyFailure,
          hasTranscript: false,
          action: failedTranscriptAction,
        })
      : {
          kind: "session_failed",
          severity: "error",
          title: "Failed to load session",
          description: transcriptState.message,
          ...(failedTranscriptAction ? { action: failedTranscriptAction } : {}),
        };
  }

  return {
    interactionEnabled: runtimeReadiness.state === "ready",
    transcriptNotice,
  };
};


