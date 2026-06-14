import { useMemo } from "react";
import { isAgentSessionWorkingStatus } from "@/lib/agent-session-status";
import {
  useChecksOperationsContext,
  useRuntimeDefinitionsContext,
} from "@/state/app-state-contexts";
import { useAgentOperations, useAgentSession, useChecksState } from "@/state/app-state-provider";
import { useWorkspaceChatSettings } from "@/state/queries/use-workspace-chat-settings";
import type { ActiveWorkspace } from "@/types/state-slices";
import { useRepoRuntimeHealthWarmup } from "../../use-repo-runtime-health-warmup";
import { useAgentChatSurfaceModel } from "../use-agent-chat-surface-model";
import { useRepoRuntimeReadiness } from "../use-repo-runtime-readiness";
import type { RuntimeSessionTranscriptSource } from "./runtime-session-transcript-source";
import { errorMessageFromUnknown } from "./runtime-transcript-error";
import { useRuntimeTranscriptInteractions } from "./use-runtime-transcript-interactions";
import { useRuntimeTranscriptSessionHistory } from "./use-runtime-transcript-session-history";

type UseSessionTranscriptSurfaceModelArgs = {
  isOpen: boolean;
  activeWorkspace: ActiveWorkspace | null;
  externalSessionId: string | null;
  source: RuntimeSessionTranscriptSource | null;
};

export function useSessionTranscriptSurfaceModel({
  isOpen,
  activeWorkspace,
  externalSessionId: requestedExternalSessionId,
  source,
}: UseSessionTranscriptSurfaceModelArgs) {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const { runtimeDefinitions, isLoadingRuntimeDefinitions, runtimeDefinitionsError } =
    useRuntimeDefinitionsContext();
  const { refreshRepoRuntimeHealthForRepo, hasCachedRepoRuntimeHealth } =
    useChecksOperationsContext();
  const { runtimeHealthByRuntime, isLoadingChecks, refreshChecks } = useChecksState();
  const { readSessionHistory, replyAgentApproval, answerAgentQuestion } = useAgentOperations();
  const externalSessionId = requestedExternalSessionId ?? null;
  const liveSession = useAgentSession(isOpen ? externalSessionId : null);
  const { chatSettings, chatSettingsError } = useWorkspaceChatSettings({
    activeWorkspace,
  });

  useRepoRuntimeHealthWarmup({
    workspaceRepoPath,
    runtimeDefinitions,
    isLoadingChecks,
    hasCachedRepoRuntimeHealth,
    refreshRepoRuntimeHealthForRepo,
  });

  const runtimeReadiness = useRepoRuntimeReadiness({
    activeWorkspace,
    runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    runtimeHealthByRuntime,
    isLoadingChecks,
    refreshChecks,
  });

  const sessionHistory = useRuntimeTranscriptSessionHistory({
    isOpen,
    activeWorkspace,
    externalSessionId,
    source,
    liveSession,
    readSessionHistory,
  });
  const transcriptInteractions = useRuntimeTranscriptInteractions({
    session: sessionHistory.session,
    externalSessionId,
    isRuntimeReady: runtimeReadiness.isReady,
    replyAgentApproval,
    answerAgentQuestion,
  });

  const isSessionWorking = transcriptInteractions.session
    ? isAgentSessionWorkingStatus(transcriptInteractions.session.status)
    : false;
  const isTranscriptLoading = sessionHistory.isHistoryLoading;
  const isResolvingTranscript =
    Boolean(isOpen && activeWorkspace && externalSessionId && source) &&
    transcriptInteractions.session === null &&
    isTranscriptLoading;
  const chatSettingsLoadError =
    chatSettingsError && activeWorkspace
      ? `Failed to load chat settings: ${errorMessageFromUnknown(
          chatSettingsError,
          "Settings read failed.",
        )}`
      : null;
  const loadError = chatSettingsLoadError ?? sessionHistory.historyError;
  const emptyState = useMemo(() => {
    if (loadError) {
      return {
        title: `Failed to load conversation: ${loadError}`,
      };
    }
    if (isResolvingTranscript) {
      return null;
    }
    if (externalSessionId && activeWorkspace) {
      return {
        title: "Conversation unavailable.",
      };
    }
    return {
      title: "Select a repository and session to view the conversation.",
    };
  }, [activeWorkspace, isResolvingTranscript, loadError, externalSessionId]);

  const model = useAgentChatSurfaceModel({
    mode: "non_interactive",
    session: transcriptInteractions.session,
    sessionLifecycle: {
      phase: isTranscriptLoading ? "loading_history" : "ready",
      repoReadinessState: runtimeReadiness.readinessState,
    },
    isContextSwitching: isResolvingTranscript,
    chatSettings,
    isSessionWorking,
    runtimeDefinitions,
    sessionRuntimeDataError: loadError,
    runtimeReadiness,
    emptyState,
    pendingQuestions: transcriptInteractions.pendingQuestions,
    approvals: transcriptInteractions.approvals,
  });

  return {
    model,
    session: transcriptInteractions.session,
    runtimeDataError: loadError,
  };
}
