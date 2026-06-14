import type { RuntimeDescriptor } from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentRole,
  AgentSessionRef,
  AgentSessionTodoItem,
} from "@openducktor/core";
import { useCallback } from "react";
import { useNavigationType, useSearchParams } from "react-router-dom";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace, LoadAgentSessionsOptions } from "@/types/state-slices";
import type { AgentStudioQueryUpdate } from "../agent-studio-navigation";
import { useAgentStudioQuerySessionSync } from "../use-agent-studio-query-session-sync";
import { useAgentStudioQuerySync } from "../use-agent-studio-query-sync";
import { useAgentStudioSelectionController } from "../use-agent-studio-selection-controller";
import { useAgentStudioReadiness } from "../use-agents-page-readiness";
import { useAgentStudioSelectionIntentState } from "./use-agent-studio-selection-intent-state";
import { useAgentStudioWorktreeRecoverySignal } from "./use-agent-studio-worktree-recovery-signal";

type UseAgentsPageRouteSessionModelArgs = {
  activeWorkspace: ActiveWorkspace | null;
  workspaceRepoPath: string | null;
  runtimeDefinitions: RuntimeDescriptor[];
  isLoadingRuntimeDefinitions: boolean;
  runtimeDefinitionsError: string | null;
  runtimeHealthByRuntime: Parameters<typeof useAgentStudioReadiness>[0]["runtimeHealthByRuntime"];
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
  tasks: Parameters<typeof useAgentStudioSelectionController>[0]["tasks"];
  isForegroundLoadingTasks: boolean;
  sessions: AgentSessionSummary[];
  isLoadingSessionReadModel: boolean;
  sessionReadModelError: string | null;
  loadAgentSessions: (taskId: string, options?: LoadAgentSessionsOptions) => Promise<void>;
  readSessionModelCatalog: (
    repoPath: string,
    runtimeKind: NonNullable<AgentSessionState["runtimeKind"]>,
  ) => Promise<AgentModelCatalog>;
  readSessionTodos: (session: AgentSessionRef) => Promise<AgentSessionTodoItem[]>;
};

export type AgentsPageRouteSessionModel = {
  navigationPersistenceError: Error | null;
  retryNavigationPersistence: () => void;
  scheduleQueryUpdate: (updates: AgentStudioQueryUpdate) => void;
  selection: ReturnType<typeof useAgentStudioSelectionController>;
  readiness: ReturnType<typeof useAgentStudioReadiness>;
  isSessionSelectionResolving: boolean;
  worktreeRecoverySignal: number;
  scheduleSelectionIntent: (intent: {
    taskId: string;
    externalSessionId: string | null;
    role: AgentRole;
  }) => void;
};

export function useAgentsPageRouteSessionModel({
  activeWorkspace,
  workspaceRepoPath,
  runtimeDefinitions,
  isLoadingRuntimeDefinitions,
  runtimeDefinitionsError,
  runtimeHealthByRuntime,
  isLoadingChecks,
  refreshChecks,
  tasks,
  isForegroundLoadingTasks,
  sessions,
  isLoadingSessionReadModel,
  sessionReadModelError,
  loadAgentSessions,
  readSessionModelCatalog,
  readSessionTodos,
}: UseAgentsPageRouteSessionModelArgs): AgentsPageRouteSessionModel {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigationType = useNavigationType();

  const {
    taskIdParam,
    sessionParam,
    hasExplicitRoleParam,
    roleFromQuery,
    isRepoNavigationBoundaryPending,
    navigationPersistenceError,
    retryNavigationPersistence,
    updateQuery,
  } = useAgentStudioQuerySync({
    activeWorkspace,
    navigationType,
    searchParams,
    setSearchParams,
  });

  const scheduleQueryUpdate = useCallback(
    (updates: AgentStudioQueryUpdate): void => {
      updateQuery(updates);
    },
    [updateQuery],
  );

  const { selectionIntentForController, isSessionSelectionResolving, scheduleSelectionIntent } =
    useAgentStudioSelectionIntentState({
      isRepoNavigationBoundaryPending,
      taskIdParam,
      sessionParam,
      roleFromQuery,
    });

  const readiness = useAgentStudioReadiness({
    activeWorkspace,
    runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    runtimeHealthByRuntime,
    isLoadingChecks,
    refreshChecks,
  });

  const selection = useAgentStudioSelectionController({
    activeWorkspace,
    isRepoNavigationBoundaryPending,
    tasks,
    isLoadingTasks: isForegroundLoadingTasks,
    sessions,
    isLoadingSessionReadModel,
    sessionReadModelError,
    taskIdParam,
    sessionParam,
    hasExplicitRoleParam,
    roleFromQuery,
    selectionIntent: selectionIntentForController,
    updateQuery: scheduleQueryUpdate,
    loadAgentSessions,
    runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    runtimeHealthByRuntime,
    isLoadingChecks,
    readSessionModelCatalog,
    readSessionTodos,
  });
  const worktreeRecoverySignal = useAgentStudioWorktreeRecoverySignal({
    workspaceRepoPath,
    selection,
    isForegroundLoadingTasks,
  });

  useAgentStudioQuerySessionSync({
    isRepoNavigationBoundaryPending,
    isLoadingTasks: isForegroundLoadingTasks,
    tasks,
    taskIdParam,
    sessionParam,
    sessionFromQuery: selection.selectedSessionFromRoute,
    resolvedTaskId: selection.taskId,
    resolvedSession: selection.activeSessionSummary,
    roleFromQuery,
    scheduleQueryUpdate,
  });

  return {
    navigationPersistenceError,
    retryNavigationPersistence,
    scheduleQueryUpdate,
    selection,
    readiness,
    isSessionSelectionResolving,
    worktreeRecoverySignal,
    scheduleSelectionIntent,
  };
}
