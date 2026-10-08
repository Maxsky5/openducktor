import { deriveAgentChatReadiness } from "@/components/features/agents/agent-chat/agent-chat-readiness";
import { resolveAgentChatTranscriptPresentation } from "@/components/features/agents/agent-chat/agent-chat-transcript-presentation";
import { useFailedTranscriptAction } from "@/components/features/agents/agent-chat/use-failed-transcript-action";
import type { RuntimeReadiness } from "@/lib/use-runtime-readiness";
import type { AgentSessionTransientFault } from "@/types/agent-session-transient-fault";
import type { useAgentChatPresentation } from "@/components/features/agents/agent-chat/use-agent-chat-presentation";
import type {
  AgentOperationsContextValue,
  AgentSessionReadModelStateContextValue,
} from "@/types/state-slices";
import type { projectWorkspaceSessionChatState } from "./workspace-session-chat-state";

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
  presentation: Pick<ReturnType<typeof useAgentChatPresentation>, "transcriptSession" | "runtimeBlockedAction">;
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
