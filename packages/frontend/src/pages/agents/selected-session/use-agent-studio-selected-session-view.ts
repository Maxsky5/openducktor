import type { RuntimeDescriptor, TaskCard } from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentRole,
  AgentSessionRef,
  AgentSessionTodoItem,
} from "@openducktor/core";
import { useEffect, useMemo } from "react";
import {
  firstLaunchAction,
  resolveBuildContinuationLaunchAction,
  type SessionLaunchActionId,
} from "@/features/session-start";
import type { RepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import { useRepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { useAgentSession } from "@/state/app-state-provider";
import type { SessionRuntimeDataState } from "@/state/operations/agent-orchestrator/hooks/use-session-runtime-data";
import { useSessionRuntimeData } from "@/state/operations/agent-orchestrator/hooks/use-session-runtime-data";
import { shouldLoadSelectedSessionHistory } from "@/state/operations/agent-orchestrator/lifecycle/session-history-loader";
import type { AgentSessionViewLifecycle } from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import { deriveSelectedAgentSessionViewLifecycle } from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace, ChecksStateContextValue } from "@/types/state-slices";
import {
  type AgentStudioViewSessionSelectionIntent,
  resolveAgentStudioViewSessionSelection,
} from "../agents-page-selection";

type UseAgentStudioSelectedSessionViewArgs = {
  activeWorkspace: ActiveWorkspace | null;
  selectedTask: TaskCard | null;
  sessionSummaries: AgentSessionSummary[];
  sessionKey: string | null;
  hasExplicitRoleSelection: boolean;
  roleSelection: AgentRole;
  fallbackRole: AgentRole;
  keepExplicitRoleSessionless: boolean;
  selectionIntent: AgentStudioViewSessionSelectionIntent | null;
  sessionIdentityFromRoute: AgentSessionIdentity | null;
  sessionReadModelError: string | null;
  isLoadingSessionReadModel: boolean;
  runtimeDefinitions: RuntimeDescriptor[];
  isLoadingRuntimeDefinitions: boolean;
  runtimeDefinitionsError: string | null;
  runtimeHealthByRuntime: ChecksStateContextValue["runtimeHealthByRuntime"];
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
  loadAgentSessionHistory: (session: AgentSessionIdentity) => Promise<void>;
  readSessionModelCatalog: (
    repoPath: string,
    runtimeKind: NonNullable<AgentSessionState["runtimeKind"]>,
  ) => Promise<AgentModelCatalog>;
  readSessionTodos: (session: AgentSessionRef) => Promise<AgentSessionTodoItem[]>;
};

export type AgentStudioSelectedSessionView = {
  sessionSummary: AgentSessionSummary | null;
  session: AgentSessionState | null;
  runtimeData: SessionRuntimeDataState["runtimeData"];
  runtimeDataError: string | null;
  runtimeReadiness: RepoRuntimeReadiness;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  lifecycle: AgentSessionViewLifecycle;
};

export function useAgentStudioSelectedSessionView({
  activeWorkspace,
  selectedTask,
  sessionSummaries,
  sessionKey,
  hasExplicitRoleSelection,
  roleSelection,
  fallbackRole,
  keepExplicitRoleSessionless,
  selectionIntent,
  sessionIdentityFromRoute,
  sessionReadModelError,
  isLoadingSessionReadModel,
  runtimeDefinitions,
  isLoadingRuntimeDefinitions,
  runtimeDefinitionsError,
  runtimeHealthByRuntime,
  isLoadingChecks,
  refreshChecks,
  loadAgentSessionHistory,
  readSessionModelCatalog,
  readSessionTodos,
}: UseAgentStudioSelectedSessionViewArgs): AgentStudioSelectedSessionView {
  const selection = useMemo(() => {
    return resolveAgentStudioViewSessionSelection({
      sessionSummaries,
      sessionKey,
      sessionIdentity: sessionIdentityFromRoute,
      hasExplicitRoleParam: hasExplicitRoleSelection,
      roleFromQuery: roleSelection,
      selectedTask,
      fallbackRole,
      keepExplicitRoleSessionless,
      selectionIntent,
    });
  }, [
    sessionKey,
    fallbackRole,
    hasExplicitRoleSelection,
    keepExplicitRoleSessionless,
    roleSelection,
    sessionIdentityFromRoute,
    selectionIntent,
    selectedTask,
    sessionSummaries,
  ]);

  const selectedSessionIdentity = selection.sessionIdentity;
  const session = useAgentSession(selectedSessionIdentity);
  const runtimeReadiness = useRepoRuntimeReadiness({
    activeWorkspace,
    runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    runtimeHealthByRuntime,
    isLoadingChecks,
    refreshChecks,
    runtimeKind: selectedSessionIdentity?.runtimeKind ?? null,
  });
  const repoReadinessState = runtimeReadiness.readinessState;

  const launchActionId: SessionLaunchActionId =
    selection.role === "build"
      ? resolveBuildContinuationLaunchAction(selectedTask)
      : firstLaunchAction(selection.role);

  const lifecycle = useMemo(() => {
    return deriveSelectedAgentSessionViewLifecycle({
      selectedSessionIdentity,
      session,
      hasSelectedTask: selectedTask !== null,
      repoReadinessState,
      sessionLoadError: sessionReadModelError,
      isLoadingSessionReadModel,
    });
  }, [
    isLoadingSessionReadModel,
    repoReadinessState,
    selectedTask,
    session,
    sessionReadModelError,
    selectedSessionIdentity,
  ]);

  const runtimeData = useSessionRuntimeData({
    repoPath: activeWorkspace?.repoPath ?? null,
    session,
    runtimeDefinitions,
    repoReadinessState,
    readSessionModelCatalog,
    readSessionTodos,
  });

  const shouldLoadHistory = shouldLoadSelectedSessionHistory({
    repoReadinessState,
    session,
  });
  const hasSession = session !== null;
  useEffect(() => {
    if (selectedSessionIdentity === null || !shouldLoadHistory || !hasSession) {
      return;
    }

    void loadAgentSessionHistory(selectedSessionIdentity);
  }, [hasSession, loadAgentSessionHistory, selectedSessionIdentity, shouldLoadHistory]);

  return useMemo<AgentStudioSelectedSessionView>(
    () => ({
      sessionSummary: selection.sessionSummary,
      session,
      runtimeData: runtimeData.runtimeData,
      runtimeDataError: runtimeData.runtimeDataError,
      runtimeReadiness,
      role: selection.role,
      launchActionId,
      lifecycle,
    }),
    [
      launchActionId,
      lifecycle,
      runtimeReadiness,
      runtimeData.runtimeData,
      runtimeData.runtimeDataError,
      selection.role,
      selection.sessionSummary,
      session,
    ],
  );
}
