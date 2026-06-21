import type { AgentSessionTodoItem } from "@openducktor/core";
import { useMemo } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { repoRuntimeReadinessTargetForRuntime } from "@/lib/repo-runtime-readiness";
import { useRepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import {
  useAgentOperations,
  useAgentSession,
  useAgentSessionVisiblePendingInput,
} from "@/state/app-state-provider";
import { useWorkspaceChatSettings } from "@/state/queries/use-workspace-chat-settings";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { useAgentChatSurfaceModel } from "../use-agent-chat-surface-model";
import { deriveRuntimeTranscriptSurfaceState } from "./runtime-transcript-surface-state";
import { useRuntimeTranscriptInteractions } from "./use-runtime-transcript-interactions";
import { useRuntimeTranscriptSessionHistory } from "./use-runtime-transcript-session-history";

const EMPTY_TODOS = Object.freeze([]) as readonly AgentSessionTodoItem[];

const mergePendingRequests = <Entry extends { requestId: string }>(
  primary: readonly Entry[],
  additional: readonly Entry[],
): readonly Entry[] => {
  if (primary.length === 0) {
    return additional;
  }
  if (additional.length === 0) {
    return primary;
  }

  const requestIds = new Set(primary.map((entry) => entry.requestId));
  const merged = [...primary];
  for (const entry of additional) {
    if (requestIds.has(entry.requestId)) {
      continue;
    }
    requestIds.add(entry.requestId);
    merged.push(entry);
  }
  return merged;
};

type UseSessionTranscriptSurfaceModelArgs = {
  isOpen: boolean;
  workspaceRepoPath: string | null;
  target: AgentSessionIdentity | null;
};

export function useSessionTranscriptSurfaceModel({
  isOpen,
  workspaceRepoPath,
  target,
}: UseSessionTranscriptSurfaceModelArgs) {
  const hasWorkspace = workspaceRepoPath !== null;
  const { replyAgentApproval, answerAgentQuestion } = useAgentOperations();
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
  const pendingApprovalRequests = useMemo(
    () =>
      mergePendingRequests(
        visiblePendingInput.pendingApprovals,
        sessionHistory.interactionSession?.pendingApprovals ?? [],
      ),
    [sessionHistory.interactionSession, visiblePendingInput.pendingApprovals],
  );
  const pendingQuestionRequests = useMemo(
    () =>
      mergePendingRequests(
        visiblePendingInput.pendingQuestions,
        sessionHistory.interactionSession?.pendingQuestions ?? [],
      ),
    [sessionHistory.interactionSession, visiblePendingInput.pendingQuestions],
  );
  const transcriptInteractions = useRuntimeTranscriptInteractions({
    target,
    pendingApprovalRequests,
    pendingQuestionRequests,
    isRuntimeReady: runtimeReadiness.state === "ready",
    replyAgentApproval,
    answerAgentQuestion,
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
