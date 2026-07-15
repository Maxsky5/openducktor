import type { AgentSessionTodoItem } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { repoRuntimeReadinessTargetForRuntime } from "@/lib/repo-runtime-readiness";
import { useRepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import { useAgentSession, useAgentSessionVisiblePendingInput } from "@/state/app-state-provider";
import { useWorkspaceChatSettings } from "@/state/queries/use-workspace-chat-settings";
import type { AgentSessionTranscriptTarget } from "../agent-session-transcript-target";
import { useAgentChatSurfaceModel } from "../use-agent-chat-surface-model";
import { deriveRuntimeTranscriptSurfaceState } from "./runtime-transcript-surface-state";
import { useRuntimeTranscriptInteractions } from "./use-runtime-transcript-interactions";
import { useRuntimeTranscriptSessionHistory } from "./use-runtime-transcript-session-history";

const EMPTY_TODOS = Object.freeze([]) as readonly AgentSessionTodoItem[];

type UseSessionTranscriptSurfaceModelArgs = {
  isOpen: boolean;
  workspaceRepoPath: string | null;
  target: AgentSessionTranscriptTarget | null;
};

export function useSessionTranscriptSurfaceModel({
  isOpen,
  workspaceRepoPath,
  target,
}: UseSessionTranscriptSurfaceModelArgs) {
  const hasWorkspace = workspaceRepoPath !== null;
  const liveSession = useAgentSession(isOpen ? target : null);
  const visiblePendingInput = useAgentSessionVisiblePendingInput(isOpen ? target : null);
  const { chatSettings, chatSettingsError } = useWorkspaceChatSettings({
    hasWorkspace,
  });

  const runtimeReadiness = useRepoRuntimeReadiness({
    hasWorkspace,
    runtimeTarget: repoRuntimeReadinessTargetForRuntime(target?.runtimeKind ?? null),
  });

  const sessionHistory = useRuntimeTranscriptSessionHistory({
    isOpen,
    repoPath: workspaceRepoPath,
    target,
    repoReadinessState: runtimeReadiness.state,
    liveSession,
  });
  const transientInteractionSession =
    liveSession === null ? sessionHistory.liveInteractionSession : null;
  const pendingApprovalRequests =
    transientInteractionSession?.pendingApprovals ?? visiblePendingInput.pendingApprovals;
  const pendingQuestionRequests =
    transientInteractionSession?.pendingQuestions ?? visiblePendingInput.pendingQuestions;
  const transcriptInteractions = useRuntimeTranscriptInteractions({
    target,
    pendingApprovalRequests,
    pendingQuestionRequests,
    isRuntimeReady: runtimeReadiness.state === "ready",
    replyAgentApproval: sessionHistory.replyAgentApproval,
    answerAgentQuestion: sessionHistory.answerAgentQuestion,
  });

  const transcriptSurfaceState = deriveRuntimeTranscriptSurfaceState({
    transcriptState: sessionHistory.transcriptState,
    chatSettingsError,
  });
  const sessionKey = target ? agentSessionIdentityKey(target) : null;

  const model = useAgentChatSurfaceModel({
    sessionKey,
    session: sessionHistory.session,
    transcriptState: sessionHistory.transcriptState,
    chatSettings,
    sessionAuxiliaryError: transcriptSurfaceState.loadError,
    runtimeReadiness,
    emptyState: transcriptSurfaceState.emptyState,
    pendingApprovalRequests: transcriptInteractions.pendingApprovalRequests,
    pendingQuestionRequests: transcriptInteractions.pendingQuestionRequests,
    todos: EMPTY_TODOS,
    pendingQuestions: transcriptInteractions.pendingQuestions,
    approvals: transcriptInteractions.approvals,
  });

  return {
    model,
  };
}
