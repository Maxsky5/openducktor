import type { AgentModelCatalog, AgentSessionTodoItem } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { resolveAgentChatRuntimePresentation } from "@/lib/agent-chat-runtime-presentation";
import { deriveAgentChatRuntimeState } from "@/lib/agent-chat-runtime-state";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { repoRuntimeReadinessTargetForRuntime } from "@/lib/repo-runtime-readiness";
import { useRepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import { useAgentSession, useAgentSessionVisiblePendingInput } from "@/state/app-state-provider";
import {
  RUNTIME_CATALOG_STALE_TIME_MS,
  repoRuntimeCatalogQueryOptions,
  runtimeCatalogQueryKeys,
} from "@/state/queries/runtime-catalog";
import { skippedQueryOptions } from "@/state/queries/skipped-query";
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
  const { loadRepoRuntimeCatalog, runtimeDefinitions } = useRuntimeDefinitionsContext();
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
  const transcriptInteractions = useRuntimeTranscriptInteractions({
    target,
    pendingApprovalRequests: visiblePendingInput.pendingApprovals,
    pendingQuestionRequests: visiblePendingInput.pendingQuestions,
    isRuntimeReady: runtimeReadiness.state === "ready",
    replyAgentApproval: sessionHistory.replyAgentApproval,
    answerAgentQuestion: sessionHistory.answerAgentQuestion,
  });

  const transcriptSurfaceState = deriveRuntimeTranscriptSurfaceState({
    transcriptState: sessionHistory.transcriptState,
    chatSettingsError,
  });
  const sessionKey = target ? agentSessionIdentityKey(target) : null;
  const runtimeRef =
    workspaceRepoPath && target
      ? { repoPath: workspaceRepoPath, runtimeKind: target.runtimeKind }
      : null;
  const modelCatalogQuery = useQuery(
    runtimeRef && runtimeReadiness.state === "ready"
      ? repoRuntimeCatalogQueryOptions(runtimeRef, loadRepoRuntimeCatalog)
      : skippedQueryOptions<AgentModelCatalog>({
          queryKey: runtimeRef
            ? runtimeCatalogQueryKeys.repo(runtimeRef.repoPath, runtimeRef.runtimeKind)
            : runtimeCatalogQueryKeys.all,
          staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
        }),
  );
  const runtimeBlockedAction = useMemo(
    () => ({
      label: "Recheck",
      onAction: () => {
        void runtimeReadiness.refreshChecks();
      },
      disabled: runtimeReadiness.isLoadingChecks,
      isPending: runtimeReadiness.isLoadingChecks,
    }),
    [runtimeReadiness.isLoadingChecks, runtimeReadiness.refreshChecks],
  );
  const runtimeState = deriveAgentChatRuntimeState({
    transcriptState: sessionHistory.transcriptState,
    runtimeReadiness,
    runtimeBlockedAction,
  });
  const runtimePresentation = useMemo(
    () =>
      resolveAgentChatRuntimePresentation({
        runtimeDefinitions,
        runtimeKind: target?.runtimeKind ?? null,
      }),
    [runtimeDefinitions, target?.runtimeKind],
  );

  const model = useAgentChatSurfaceModel({
    sessionKey,
    modelCatalog: modelCatalogQuery.data ?? null,
    session: sessionHistory.session,
    transcriptTarget: target,
    transcriptState: sessionHistory.transcriptState,
    transcriptNotice: runtimeState.transcriptNotice,
    chatSettings,
    sessionAuxiliaryError: transcriptSurfaceState.loadError,
    interactionEnabled: runtimeState.interactionEnabled,
    runtimePresentation,
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
