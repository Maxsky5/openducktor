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
import { deriveRepoRuntimeReadiness } from "@/lib/repo-runtime-health";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { useAgentSession } from "@/state/app-state-provider";
import type { SessionRuntimeDataState } from "@/state/operations/agent-orchestrator/hooks/use-session-runtime-data";
import { useSessionRuntimeData } from "@/state/operations/agent-orchestrator/hooks/use-session-runtime-data";
import { shouldLoadSelectedSessionHistory } from "@/state/operations/agent-orchestrator/lifecycle/session-history-loader";
import type { SelectedAgentSessionViewLifecycle } from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import { deriveSelectedAgentSessionViewLifecycle } from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace, ChecksStateContextValue } from "@/types/state-slices";
import { resolveAgentStudioViewSessionSelection } from "../agents-page-selection";

type UseAgentStudioSelectedSessionViewArgs = {
  activeWorkspace: ActiveWorkspace | null;
  selectedTask: TaskCard | null;
  sessionSummaries: AgentSessionSummary[];
  externalSessionId: string | null;
  hasExplicitRoleSelection: boolean;
  roleSelection: AgentRole;
  fallbackRole: AgentRole;
  keepExplicitRoleSessionless: boolean;
  sessionReadModelError: string | null;
  isLoadingSessionReadModel: boolean;
  runtimeDefinitions: RuntimeDescriptor[];
  isLoadingRuntimeDefinitions: boolean;
  runtimeDefinitionsError: string | null;
  runtimeHealthByRuntime: ChecksStateContextValue["runtimeHealthByRuntime"];
  isLoadingChecks: boolean;
  loadAgentSessionHistory: (input: { session: AgentSessionState }) => Promise<void>;
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
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  isResolving: boolean;
  lifecycle: SelectedAgentSessionViewLifecycle;
};

export function useAgentStudioSelectedSessionView({
  activeWorkspace,
  selectedTask,
  sessionSummaries,
  externalSessionId,
  hasExplicitRoleSelection,
  roleSelection,
  fallbackRole,
  keepExplicitRoleSessionless,
  sessionReadModelError,
  isLoadingSessionReadModel,
  runtimeDefinitions,
  isLoadingRuntimeDefinitions,
  runtimeDefinitionsError,
  runtimeHealthByRuntime,
  isLoadingChecks,
  loadAgentSessionHistory,
  readSessionModelCatalog,
  readSessionTodos,
}: UseAgentStudioSelectedSessionViewArgs): AgentStudioSelectedSessionView {
  const selection = useMemo(() => {
    return resolveAgentStudioViewSessionSelection({
      sessionSummaries,
      externalSessionId,
      hasExplicitRoleParam: hasExplicitRoleSelection,
      roleFromQuery: roleSelection,
      selectedTask,
      fallbackRole,
      keepExplicitRoleSessionless,
    });
  }, [
    externalSessionId,
    fallbackRole,
    hasExplicitRoleSelection,
    keepExplicitRoleSessionless,
    roleSelection,
    selectedTask,
    sessionSummaries,
  ]);

  const sessionRoute = selection.sessionRoute;
  const session = useAgentSession(sessionRoute);
  const repoReadinessState = useMemo(
    () =>
      deriveRepoRuntimeReadiness({
        hasActiveWorkspace: activeWorkspace !== null,
        runtimeDefinitions,
        isLoadingRuntimeDefinitions,
        runtimeDefinitionsError,
        runtimeHealthByRuntime,
        isLoadingChecks,
        runtimeKind: sessionRoute?.runtimeKind ?? null,
      }).readinessState,
    [
      activeWorkspace,
      isLoadingChecks,
      isLoadingRuntimeDefinitions,
      runtimeDefinitions,
      runtimeDefinitionsError,
      runtimeHealthByRuntime,
      sessionRoute?.runtimeKind,
    ],
  );

  const launchActionId: SessionLaunchActionId =
    selection.role === "build"
      ? resolveBuildContinuationLaunchAction(selectedTask)
      : firstLaunchAction(selection.role);

  const isWaitingForSessionReadModel =
    isLoadingSessionReadModel &&
    sessionRoute === null &&
    sessionSummaries.length === 0 &&
    selectedTask !== null;

  const lifecycle = useMemo(() => {
    return deriveSelectedAgentSessionViewLifecycle({
      selectedSessionRoute: sessionRoute,
      session,
      hasSelectedTask: selectedTask !== null,
      repoReadinessState,
      sessionLoadError: sessionReadModelError,
      isLoadingSessionReadModel: isWaitingForSessionReadModel,
    });
  }, [
    isWaitingForSessionReadModel,
    repoReadinessState,
    selectedTask,
    session,
    sessionReadModelError,
    sessionRoute,
  ]);

  const isResolving =
    sessionRoute !== null
      ? session === null && !sessionReadModelError
      : isWaitingForSessionReadModel && repoReadinessState === "ready";

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
  useEffect(() => {
    if (sessionRoute === null || !shouldLoadHistory || !session) {
      return;
    }

    void loadAgentSessionHistory({ session });
  }, [loadAgentSessionHistory, shouldLoadHistory, session, sessionRoute]);

  return useMemo<AgentStudioSelectedSessionView>(
    () => ({
      sessionSummary: selection.sessionSummary,
      session,
      runtimeData: runtimeData.runtimeData,
      runtimeDataError: runtimeData.runtimeDataError,
      role: selection.role,
      launchActionId,
      isResolving,
      lifecycle,
    }),
    [
      isResolving,
      launchActionId,
      lifecycle,
      runtimeData.runtimeData,
      runtimeData.runtimeDataError,
      selection.role,
      selection.sessionSummary,
      session,
    ],
  );
}
