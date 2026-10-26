import { deriveAgentChatReadiness } from "@openducktor/frontend-core/sessions/send/agent-chat-readiness";
import { resolveAgentChatTranscriptPresentation } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-presentation";
import { useFailedTranscriptAction } from "@openducktor/frontend-core/sessions/transcript/use-failed-transcript-action";
import type { RuntimeReadiness } from "@openducktor/frontend-core/lib/use-runtime-readiness";
import type { AgentSessionTransientFault } from "@openducktor/frontend-core/types/agent-session-transient-fault";
import type { useAgentChatPresentation } from "@openducktor/frontend-core/sessions/transcript/use-agent-chat-presentation";
import type {
  AgentOperationsContextValue,
  AgentSessionReadModelStateContextValue,
} from "@/types/state-slices";
import type { projectWorkspaceSessionChatState } from "@openducktor/frontend-core/workspace-sessions/chat/workspace-session-chat-state";

export function useWorkspaceSessionTranscript({
  repoPath,
  state,
  presentation,
  fault,
  runtimeReadiness,
  readModel,
  loadHistory,
}: {
  repoPath: string;
  state: ReturnType<typeof projectWorkspaceSessionChatState>;
  presentation: Pick<
    ReturnType<typeof useAgentChatPresentation>,
    "transcriptSession" | "runtimeBlockedAction"
  >;
  fault: AgentSessionTransientFault | null;
  runtimeReadiness: RuntimeReadiness;
  readModel: AgentSessionReadModelStateContextValue;
  loadHistory: AgentOperationsContextValue["loadAgentSessionHistory"];
}) {
  const identity = state.transcriptTarget;
  const recovery = useFailedTranscriptAction({
    scopeKey: repoPath,
    transcriptState: state.transcriptState,
    identity,
    hasLoadedSession: state.transcriptSession !== null,
    observationFailed: readModel.sessionReadModelLoadState.kind === "failed" || fault !== null,
    observationPending: readModel.sessionReadModelLoadState.kind === "loading",
    targetMismatch: state.targetFault !== null,
    loadHistory,
    reloadReadModel: readModel.reloadSessionReadModel,
  });
  const readiness = deriveAgentChatReadiness({
    transcriptState: state.transcriptState,
    runtimeReadiness,
    runtimeBlockedAction: presentation.runtimeBlockedAction,
    failedTranscriptAction: recovery.action,
  });
  let notice = readiness.transcriptNotice;
  if (state.targetFault) {
    notice = {
      kind: "session_failed",
      severity: "error",
      title: "Workspace Session target mismatch",
      description: state.targetFault.message,
    };
    if (recovery.action) notice.action = recovery.action;
  }
  const transcript = resolveAgentChatTranscriptPresentation({
    repoPath,
    sessionKey: state.sessionKey,
    session: presentation.transcriptSession,
    target: state.transcriptTarget,
    state: state.transcriptState,
    notice,
  });
  return { readiness, transcript, retryError: recovery.error };
}
