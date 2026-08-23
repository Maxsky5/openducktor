import type { AgentModelCatalog, AgentSessionTodoItem } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
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
import { deriveAgentChatReadiness } from "../agent-chat-readiness";
import { resolveAgentChatRuntimePresentation } from "../agent-chat-runtime-presentation";
import { resolveAgentChatTranscriptPresentation } from "../agent-chat-transcript-presentation";
import type { AgentSessionTranscriptTarget } from "../agent-session-transcript-target";
import { useAgentChatSurfaceModel } from "../use-agent-chat-surface-model";
import { deriveRuntimeTranscriptSurfaceState } from "./runtime-transcript-surface-state";
import { useRuntimeTranscriptInteractions } from "./use-runtime-transcript-interactions";
import { useRuntimeTranscriptSessionHistory } from "./use-runtime-transcript-session-history";

const EMPTY_TODOS = Object.freeze(new Array<AgentSessionTodoItem>());

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
  const { refreshChecks: refreshRuntimeChecks } = runtimeReadiness;

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
        void refreshRuntimeChecks();
      },
      disabled: runtimeReadiness.isLoadingChecks,
      isPending: runtimeReadiness.isLoadingChecks,
    }),
    [refreshRuntimeChecks, runtimeReadiness.isLoadingChecks],
  );
  const failedTranscriptAction = useMemo(
    () =>
      sessionHistory.retryHistory
        ? {
            label: "Retry",
            onAction: sessionHistory.retryHistory,
            disabled: sessionHistory.isRetryingHistory,
            isPending: sessionHistory.isRetryingHistory,
          }
        : null,
    [sessionHistory.isRetryingHistory, sessionHistory.retryHistory],
  );
  const chatReadiness = useMemo(
    () =>
      deriveAgentChatReadiness({
        transcriptState: sessionHistory.transcriptState,
        runtimeReadiness: {
          state: runtimeReadiness.state,
          message: runtimeReadiness.message,
        },
        runtimeBlockedAction,
        failedTranscriptAction,
      }),
    [
      failedTranscriptAction,
      runtimeBlockedAction,
      runtimeReadiness.message,
      runtimeReadiness.state,
      sessionHistory.transcriptState,
    ],
  );
  const runtimePresentation = useMemo(
    () =>
      resolveAgentChatRuntimePresentation({
        runtimeDefinitions,
        runtimeKind: target?.runtimeKind ?? null,
      }),
    [runtimeDefinitions, target?.runtimeKind],
  );
  const transcript = useMemo(
    () =>
      resolveAgentChatTranscriptPresentation({
        sessionKey,
        session: sessionHistory.session,
        target,
        state: sessionHistory.transcriptState,
        notice: chatReadiness.transcriptNotice,
      }),
    [
      chatReadiness.transcriptNotice,
      sessionHistory.session,
      sessionHistory.transcriptState,
      sessionKey,
      target,
    ],
  );

  const model = useAgentChatSurfaceModel({
    modelCatalog: modelCatalogQuery.data ?? null,
    transcript,
    chatSettings,
    sessionAuxiliaryError: transcriptSurfaceState.loadError,
    interactionEnabled: chatReadiness.interactionEnabled,
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
