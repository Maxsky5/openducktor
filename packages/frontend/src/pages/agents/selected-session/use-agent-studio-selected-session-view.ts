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
  deriveSelectedSessionRuntimeTarget,
  deriveSelectedSessionViewProjection,
} from "./selected-session-view-projection";

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
  const { allRuntimeDefinitions: runtimeDefinitions, loadRepoRuntimeCatalog } =
    useRuntimeAvailabilityContext();
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
  const runtimeTarget = useMemo(
    () =>
      deriveSelectedSessionRuntimeTarget({
        selectedSessionIdentity,
        selectedTask,
        role: selection.role,
        repoSettings,
        isLoadingRepoSettings,
      }),
    [isLoadingRepoSettings, repoSettings, selectedSessionIdentity, selectedTask, selection.role],
  );
  const runtimeReadiness = useRepoRuntimeReadiness({
    hasWorkspace: workspaceRepoPath !== null,
    runtimeTarget,
  });
  const repoReadinessState = runtimeReadiness.state;
  const selectedSessionViewProjection = useMemo(
    () =>
      deriveSelectedSessionViewProjection({
        selectedSessionIdentity,
        session,
        sessionSummary: selection.sessionSummary,
        selectedTask,
        readModelLoadState: sessionReadModelLoadState,
        repoReadinessState,
      }),
    [
      repoReadinessState,
      selectedSessionIdentity,
      selectedTask,
      session,
      selection.sessionSummary,
      sessionReadModelLoadState,
    ],
  );
  const selectedSessionActivityState = selectedSessionViewProjection.activityState;
  const selectedSessionModel = selectedSessionViewProjection.selectedModel;
  const transcriptState = selectedSessionViewProjection.transcriptState;

  const launchActionId: SessionLaunchActionId =
    selection.role === "build"
      ? resolveBuildContinuationLaunchAction(selectedTask)
      : firstLaunchAction(selection.role);

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
