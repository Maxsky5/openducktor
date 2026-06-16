import { isAgentSessionActivityWorking } from "@/lib/agent-session-activity-state";
import { repoRuntimeReadinessTargetForRuntime } from "@/lib/repo-runtime-health";
import { useRepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import { useAgentOperations, useAgentSession, useChecksState } from "@/state/app-state-provider";
import { useWorkspaceChatSettings } from "@/state/queries/use-workspace-chat-settings";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { useAgentChatSurfaceModel } from "../use-agent-chat-surface-model";
import { deriveRuntimeTranscriptSurfaceState } from "./runtime-transcript-surface-state";
import { useRuntimeTranscriptInteractions } from "./use-runtime-transcript-interactions";
import { useRuntimeTranscriptSessionHistory } from "./use-runtime-transcript-session-history";

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
  const { runtimeDefinitions, isLoadingRuntimeDefinitions, runtimeDefinitionsError } =
    useRuntimeDefinitionsContext();
  const { runtimeHealthByRuntime, isLoadingChecks, refreshChecks } = useChecksState();
  const { readSessionHistory, replyAgentApproval, answerAgentQuestion } = useAgentOperations();
  const liveSession = useAgentSession(isOpen ? target : null);
  const { chatSettings, chatSettingsError } = useWorkspaceChatSettings({
    hasWorkspace,
  });

  const runtimeReadiness = useRepoRuntimeReadiness({
    hasWorkspace,
    runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    runtimeHealthByRuntime,
    isLoadingChecks,
    refreshChecks,
    runtimeTarget: repoRuntimeReadinessTargetForRuntime(target?.runtimeKind ?? null),
  });

  const sessionHistory = useRuntimeTranscriptSessionHistory({
    isOpen,
    repoPath: workspaceRepoPath,
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

  const transcriptSurfaceState = deriveRuntimeTranscriptSurfaceState({
    isOpen,
    hasWorkspace,
    hasTarget: target !== null,
    hasSession: transcriptInteractions.session !== null,
    transcriptState: sessionHistory.transcriptState,
    historyError: sessionHistory.historyError,
    chatSettingsError,
  });

  const model = useAgentChatSurfaceModel({
    session: transcriptInteractions.session,
    transcriptState: sessionHistory.transcriptState,
    chatSettings,
    isSessionWorking: isAgentSessionActivityWorking(transcriptInteractions.session?.activityState),
    runtimeDefinitions,
    sessionRuntimeDataError: transcriptSurfaceState.loadError,
    runtimeReadiness,
    emptyState: transcriptSurfaceState.emptyState,
    pendingQuestions: transcriptInteractions.pendingQuestions,
    approvals: transcriptInteractions.approvals,
  });

  return {
    model,
    session: transcriptInteractions.session,
    runtimeDataError: transcriptSurfaceState.loadError,
  };
}
