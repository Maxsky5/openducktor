import type { RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentSessionRef, AgentSessionTodoItem } from "@openducktor/core";
import { useCallback } from "react";
import { useNavigationType, useSearchParams } from "react-router-dom";
import type { useChecksState } from "@/state";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { AgentStudioQueryUpdate } from "../query-sync/agent-studio-navigation";
import { useAgentStudioQuerySessionSync } from "../query-sync/use-agent-studio-query-session-sync";
import { useAgentStudioQuerySync } from "../query-sync/use-agent-studio-query-sync";
import { useAgentStudioSelectionController } from "../use-agent-studio-selection-controller";
import type { AgentStudioSelectionIntent } from "./agent-studio-selection-intent";
import { buildAgentStudioWorktreeRecoveryKey } from "./agent-studio-worktree-recovery-key";
import { useAgentStudioSelectionIntentState } from "./use-agent-studio-selection-intent-state";

type UseAgentsPageRouteSessionModelArgs = {
  activeWorkspace: ActiveWorkspace | null;
  workspaceRepoPath: string | null;
  runtimeDefinitions: RuntimeDescriptor[];
  isLoadingRuntimeDefinitions: boolean;
  runtimeDefinitionsError: string | null;
  runtimeHealthByRuntime: ReturnType<typeof useChecksState>["runtimeHealthByRuntime"];
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
  tasks: Parameters<typeof useAgentStudioSelectionController>[0]["tasks"];
  isForegroundLoadingTasks: boolean;
  sessions: AgentSessionSummary[];
  isLoadingSessionReadModel: boolean;
  sessionReadModelError: string | null;
  loadAgentSessionHistory: (session: AgentSessionIdentity) => Promise<void>;
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
  worktreeRecoveryKey: string;
  scheduleSelectionIntent: (intent: AgentStudioSelectionIntent) => void;
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
  loadAgentSessionHistory,
  readSessionModelCatalog,
  readSessionTodos,
}: UseAgentsPageRouteSessionModelArgs): AgentsPageRouteSessionModel {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigationType = useNavigationType();

  const {
    taskIdParam,
    sessionKeyParam,
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

  const { selectionIntentForController, scheduleSelectionIntent } =
    useAgentStudioSelectionIntentState({
      isRepoNavigationBoundaryPending,
      taskIdParam,
      sessionKeyParam,
      roleFromQuery,
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
    sessionKeyParam,
    hasExplicitRoleParam,
    roleFromQuery,
    selectionIntent: selectionIntentForController,
    updateQuery: scheduleQueryUpdate,
    loadAgentSessionHistory,
    runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    runtimeHealthByRuntime,
    isLoadingChecks,
    refreshChecks,
    readSessionModelCatalog,
    readSessionTodos,
  });
  const worktreeRecoveryKey = buildAgentStudioWorktreeRecoveryKey({
    workspaceRepoPath,
    selection,
    isForegroundLoadingTasks,
  });

  useAgentStudioQuerySessionSync({
    isRepoNavigationBoundaryPending,
    isLoadingTasks: isForegroundLoadingTasks,
    tasks,
    taskIdParam,
    sessionKeyParam,
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
    worktreeRecoveryKey,
    scheduleSelectionIntent,
  };
}
