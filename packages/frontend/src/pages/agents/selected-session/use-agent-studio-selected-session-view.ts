import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useMemo } from "react";
import {
  firstLaunchAction,
  resolveBuildContinuationLaunchAction,
  type SessionLaunchActionId,
} from "@/features/session-start";
import { useRepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { useRuntimeAvailabilityContext } from "@/state/app-state-contexts";
import {
  useAgentOperations,
  useAgentSession,
  useAgentSessionReadModelState,
  useChecksState,
} from "@/state/app-state-provider";
import { useSessionRuntimeData } from "@/state/operations/agent-orchestrator/hooks/use-session-runtime-data";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  type AgentStudioViewSessionSelectionIntent,
  resolveAgentStudioViewSessionSelection,
} from "../agents-page-selection";
import type { AgentStudioSelectedSessionState } from "./selected-session-state";
import {
  deriveSelectedSessionTranscriptState,
  projectSelectedSessionViewSource,
  resolveSelectedSessionViewSource,
} from "./selected-session-view-source";

type UseAgentStudioSelectedSessionViewArgs = {
  workspaceRepoPath: string | null;
  selectedTask: TaskCard | null;
  sessionSummaries: AgentSessionSummary[];
  sessionKey: string | null;
  hasExplicitRoleSelection: boolean;
  roleSelection: AgentRole;
  sessionlessRole: AgentRole;
  keepExplicitRoleSessionless: boolean;
  selectionIntent: AgentStudioViewSessionSelectionIntent | null;
  sessionIdentityFromRoute: AgentSessionIdentity | null;
  repoSettings: RepoSettingsInput | null;
  isLoadingRepoSettings: boolean;
};

export type AgentStudioSelectedSessionView = {
  selectedSession: AgentStudioSelectedSessionState;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
};

export function useAgentStudioSelectedSessionView({
  workspaceRepoPath,
  selectedTask,
  sessionSummaries,
  sessionKey,
  hasExplicitRoleSelection,
  roleSelection,
  sessionlessRole,
  keepExplicitRoleSessionless,
  selectionIntent,
  sessionIdentityFromRoute,
  repoSettings,
  isLoadingRepoSettings,
}: UseAgentStudioSelectedSessionViewArgs): AgentStudioSelectedSessionView {
  const { readSessionTodos } = useAgentOperations();
  const {
    allRuntimeDefinitions: runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    loadRepoRuntimeCatalog,
  } = useRuntimeAvailabilityContext();
  const { runtimeHealthByRuntime, isLoadingChecks, refreshChecks } = useChecksState();
  const selection = useMemo(() => {
    return resolveAgentStudioViewSessionSelection({
      sessionSummaries,
      sessionKey,
      sessionIdentity: sessionIdentityFromRoute,
      hasExplicitRoleParam: hasExplicitRoleSelection,
      roleFromQuery: roleSelection,
      selectedTask,
      sessionlessRole,
      keepExplicitRoleSessionless,
      selectionIntent,
    });
  }, [
    sessionKey,
    hasExplicitRoleSelection,
    keepExplicitRoleSessionless,
    roleSelection,
    sessionlessRole,
    sessionIdentityFromRoute,
    selectionIntent,
    selectedTask,
    sessionSummaries,
  ]);

  const selectedSessionIdentity = selection.sessionIdentity;
  const session = useAgentSession(selectedSessionIdentity);
  const { sessionReadModelLoadState } = useAgentSessionReadModelState();
  const selectedSessionViewSource = useMemo(
    () =>
      resolveSelectedSessionViewSource({
        selectedSessionIdentity,
        session,
        sessionSummary: selection.sessionSummary,
        selectedTask,
        readModelLoadState: sessionReadModelLoadState,
      }),
    [
      selectedSessionIdentity,
      selectedTask,
      session,
      selection.sessionSummary,
      sessionReadModelLoadState,
    ],
  );
  const selectedSessionViewProjection = useMemo(
    () =>
      projectSelectedSessionViewSource({
        source: selectedSessionViewSource,
        role: selection.role,
        repoSettings,
        isLoadingRepoSettings,
      }),
    [isLoadingRepoSettings, repoSettings, selectedSessionViewSource, selection.role],
  );
  const selectedSessionActivityState = selectedSessionViewProjection.activityState;
  const selectedSessionModel = selectedSessionViewProjection.selectedModel;
  const runtimeTarget = selectedSessionViewProjection.runtimeTarget;
  const runtimeReadiness = useRepoRuntimeReadiness({
    hasWorkspace: workspaceRepoPath !== null,
    runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    runtimeHealthByRuntime,
    isLoadingChecks,
    refreshChecks,
    runtimeTarget,
  });
  const repoReadinessState = runtimeReadiness.state;

  const launchActionId: SessionLaunchActionId =
    selection.role === "build"
      ? resolveBuildContinuationLaunchAction(selectedTask)
      : firstLaunchAction(selection.role);

  const transcriptState = useMemo(() => {
    return deriveSelectedSessionTranscriptState({
      source: selectedSessionViewSource,
      repoReadinessState,
    });
  }, [repoReadinessState, selectedSessionViewSource]);
  const runtimeData = useSessionRuntimeData({
    repoPath: workspaceRepoPath,
    selectedSessionIdentity,
    runtimeDefinitions,
    repoReadinessState,
    loadRuntimeCatalog: loadRepoRuntimeCatalog,
    readSessionTodos,
  });

  const selectedSession = useMemo<AgentStudioSelectedSessionState>(
    () => ({
      identity: selectedSessionIdentity,
      activityState: selectedSessionActivityState,
      selectedModel: selectedSessionModel,
      loadedSession: session,
      runtimeData,
      runtimeReadiness,
      transcriptState,
    }),
    [
      transcriptState,
      runtimeReadiness,
      runtimeData,
      selectedSessionActivityState,
      selectedSessionIdentity,
      selectedSessionModel,
      session,
    ],
  );

  return useMemo<AgentStudioSelectedSessionView>(
    () => ({
      selectedSession,
      role: selection.role,
      launchActionId,
    }),
    [launchActionId, selectedSession, selection.role],
  );
}
