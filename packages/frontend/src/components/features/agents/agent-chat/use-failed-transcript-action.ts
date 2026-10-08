import type { AgentSessionTranscriptState } from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { useSessionRecoveryAction } from "@/features/session-navigation/use-session-recovery-action";
import type { AgentChatTranscriptNoticeAction } from "./agent-chat.types";

export function useFailedTranscriptAction({
  scopeKey,
  transcriptState,
  identity,
  hasLoadedSession,
  observationFailed,
  targetMismatch = false,
  loadHistory,
  reloadReadModel,
}: {
  scopeKey: string;
  transcriptState: AgentSessionTranscriptState;
  identity: AgentSessionIdentity | null;
  hasLoadedSession: boolean;
  observationFailed: boolean;
  targetMismatch?: boolean;
  loadHistory: (identity: AgentSessionIdentity) => Promise<AgentSessionState | null>;
  reloadReadModel: () => void;
}): TranscriptRecovery {
  let retry: (() => void | Promise<void>) | null = null;
  if (targetMismatch) {
    retry = reloadReadModel;
  } else if (
    (transcriptState.kind === "failed" || transcriptState.kind === "visible") &&
    transcriptState.historyFailure != null &&
    identity &&
    hasLoadedSession
  ) {
    retry = async () => {
      await loadHistory(identity);
    };
  } else if (transcriptState.kind === "failed" && !hasLoadedSession && observationFailed) {
    retry = reloadReadModel;
  }
  const recovery = useSessionRecoveryAction(
    `${scopeKey}:${identity ? agentSessionIdentityKey(identity) : "sessionless"}`,
    retry,
  );
  return {
    action: retry
      ? {
          label: "Retry",
          onAction: recovery.retry,
          disabled: recovery.isPending,
          isPending: recovery.isPending,
        }
      : null,
    error: recovery.error?.message ?? null,
  };
}

type TranscriptRecovery = {
  action: AgentChatTranscriptNoticeAction | null;
  error: string | null;
};
