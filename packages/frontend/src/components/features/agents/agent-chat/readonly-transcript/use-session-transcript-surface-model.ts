import { useMemo } from "react";
import { isAgentSessionWorkingStatus } from "@/lib/agent-session-status";
import {
  useChecksOperationsContext,
  useRuntimeDefinitionsContext,
} from "@/state/app-state-contexts";
import { useAgentOperations, useAgentSession, useChecksState } from "@/state/app-state-provider";
import { isAgentSessionTranscriptLoading } from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import { useWorkspaceChatSettings } from "@/state/queries/use-workspace-chat-settings";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import { useRepoRuntimeHealthWarmup } from "../../use-repo-runtime-health-warmup";
import { useAgentChatSurfaceModel } from "../use-agent-chat-surface-model";
import { useRepoRuntimeReadiness } from "../use-repo-runtime-readiness";
import { errorMessageFromUnknown } from "./runtime-transcript-error";
import { useRuntimeTranscriptInteractions } from "./use-runtime-transcript-interactions";
import { useRuntimeTranscriptSessionHistory } from "./use-runtime-transcript-session-history";

type UseSessionTranscriptSurfaceModelArgs = {
  isOpen: boolean;
  activeWorkspace: ActiveWorkspace | null;
  target: AgentSessionIdentity | null;
};

export function useSessionTranscriptSurfaceModel({
  isOpen,
  activeWorkspace,
  target,
}: UseSessionTranscriptSurfaceModelArgs) {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const { runtimeDefinitions, isLoadingRuntimeDefinitions, runtimeDefinitionsError } =
    useRuntimeDefinitionsContext();
  const { refreshRepoRuntimeHealthForRepo, hasCachedRepoRuntimeHealth } =
    useChecksOperationsContext();
  const { runtimeHealthByRuntime, isLoadingChecks, refreshChecks } = useChecksState();
  const { readSessionHistory, replyAgentApproval, answerAgentQuestion } = useAgentOperations();
  const liveSession = useAgentSession(isOpen ? target : null);
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
    target,
    repoReadinessState: runtimeReadiness.readinessState,
    liveSession,
    readSessionHistory,
  });
  const transcriptInteractions = useRuntimeTranscriptInteractions({
    session: sessionHistory.session,
    target,
    isRuntimeReady: runtimeReadiness.isReady,
    replyAgentApproval,
    answerAgentQuestion,
  });

  const isSessionWorking = transcriptInteractions.session
    ? isAgentSessionWorkingStatus(transcriptInteractions.session.status)
    : false;
  const sessionLifecycle = sessionHistory.lifecycle;
  const transcriptState = sessionLifecycle.transcriptState;
  const isResolvingTranscript =
    Boolean(isOpen && activeWorkspace && target) &&
    transcriptInteractions.session === null &&
    isAgentSessionTranscriptLoading(transcriptState);
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
    if (target && activeWorkspace) {
      return {
        title: "Conversation unavailable.",
      };
    }
    return {
      title: "Select a repository and session to view the conversation.",
    };
  }, [activeWorkspace, isResolvingTranscript, loadError, target]);

  const model = useAgentChatSurfaceModel({
    mode: "non_interactive",
    session: transcriptInteractions.session,
    sessionLifecycle,
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
