import { deriveAgentChatReadiness } from "@openducktor/frontend-core/sessions/send/agent-chat-readiness";
import { resolveAgentChatTranscriptPresentation } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-presentation";
import { useFailedTranscriptAction } from "@openducktor/frontend-core/sessions/transcript/use-failed-transcript-action";
import type { RuntimeReadiness } from "@openducktor/frontend-core/lib/use-runtime-readiness";
import type { AgentSessionTransientFault } from "@openducktor/frontend-core/types/agent-session-transient-fault";
import type { HandoffLink, WorkspaceRef } from "@openducktor/contracts";
import { useAgentChatPresentation } from "@openducktor/frontend-core/sessions/transcript/use-agent-chat-presentation";
import { useRuntimeHandoffTranscript } from "@openducktor/frontend-core/sessions/transcript/use-runtime-handoff-transcript";
import type {
  AgentOperationsContextValue,
  AgentSessionReadModelStateContextValue,
} from "@/types/state-slices";
import type { projectWorkspaceSessionChatState } from "@openducktor/frontend-core/workspace-sessions/chat/workspace-session-chat-state";
import type { AgentChatTranscriptNotice } from "@openducktor/frontend-core/sessions/send/agent-chat.types";

export function useWorkspaceSessionTranscript({
  workspace,
  state,
  identity,
  links,
  skills,
  fault,
  runtimeReadiness,
  readModel,
  loadHistory,
  branchNaming,
}: {
  workspace: WorkspaceRef;
  state: ReturnType<typeof projectWorkspaceSessionChatState>;
  identity: Parameters<typeof useAgentChatPresentation>[0]["sessionIdentity"];
  links: HandoffLink[] | undefined;
  skills: Parameters<typeof useAgentChatPresentation>[0]["skills"];
  fault: AgentSessionTransientFault | null;
  runtimeReadiness: RuntimeReadiness;
  readModel: AgentSessionReadModelStateContextValue;
  loadHistory: AgentOperationsContextValue["loadAgentSessionHistory"];
  /** The notice of a first message that waits while the host names the branch, or null. */
  branchNaming: AgentChatTranscriptNotice | null;
}) {
  const { repoPath, workspaceId } = workspace;
  const session = useRuntimeHandoffTranscript({
    session: state.transcriptSession,
    repoPath,
    scope: { kind: "repository", workspaceId },
    links,
  });
  const presentation = useAgentChatPresentation({
    session,
    sessionIdentity: identity,
    pendingApprovals: state.pendingApprovals,
    pendingQuestions: state.pendingQuestions,
    skills,
    runtimeReadiness,
  });
  const recovery = useFailedTranscriptAction({
    scopeKey: repoPath,
    transcriptState: state.transcriptState,
    identity: state.transcriptTarget,
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
  notice ??= branchNaming;
  const transcript = resolveAgentChatTranscriptPresentation({
    repoPath,
    sessionKey: state.sessionKey,
    session: presentation.transcriptSession,
    target: state.transcriptTarget,
    state: state.transcriptState,
    notice,
  });
  return {
    readiness,
    transcript,
    retryError: recovery.error,
    subagentPendingApprovalCountBySessionKey: presentation.subagentPendingApprovalCountBySessionKey,
    subagentPendingQuestionCountBySessionKey: presentation.subagentPendingQuestionCountBySessionKey,
  };
}
