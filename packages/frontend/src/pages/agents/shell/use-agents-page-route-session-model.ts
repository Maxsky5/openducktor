import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentRole,
  AgentSessionRef,
  AgentSessionTodoItem,
} from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useNavigationType, useSearchParams } from "react-router-dom";
import { useRepoRuntimeHealthWarmup } from "@/components/features/agents/use-repo-runtime-health-warmup";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { agentSessionBulkQueryOptions } from "@/state/queries/agent-sessions";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
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
  refreshRepoRuntimeHealthForRepo: (repoPath: string, force?: boolean) => Promise<unknown>;
  hasCachedRepoRuntimeHealth: (repoPath: string, runtimeKinds: RuntimeKind[]) => boolean;
  tasks: Parameters<typeof useAgentStudioSelectionController>[0]["tasks"];
  isForegroundLoadingTasks: boolean;
  sessions: AgentSessionSummary[];
  sessionReadModelError: string | null;
  loadAgentSessionHistory: (input: { session: AgentSessionState }) => Promise<void>;
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
  signalContextSwitchIntent: () => void;
  contextSwitchVersion: number;
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
  refreshRepoRuntimeHealthForRepo,
  hasCachedRepoRuntimeHealth,
  tasks,
  isForegroundLoadingTasks,
  sessions,
  sessionReadModelError,
  loadAgentSessionHistory,
  readSessionModelCatalog,
  readSessionTodos,
}: UseAgentsPageRouteSessionModelArgs): AgentsPageRouteSessionModel {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigationType = useNavigationType();
  const [contextSwitchVersion, setContextSwitchVersion] = useState(0);

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

  const signalContextSwitchIntent = useCallback((): void => {
    setContextSwitchVersion((current) => current + 1);
  }, []);

  const {
    selectionIntentForController,
    isSessionSelectionResolving: isSelectionIntentResolving,
    scheduleSelectionIntent,
  } = useAgentStudioSelectionIntentState({
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
  const taskIds = useMemo(() => tasks.map((task) => task.id), [tasks]);
  const shouldLoadTaskSessionRecords = workspaceRepoPath !== null && taskIds.length > 0;
  const taskSessionRecordsQuery = useQuery({
    ...agentSessionBulkQueryOptions(workspaceRepoPath ?? "", taskIds),
    enabled: shouldLoadTaskSessionRecords,
  });
  const taskSessionRecordsByTaskId = taskSessionRecordsQuery.data ?? {};
  const taskSessionRecordsError = taskSessionRecordsQuery.error
    ? `Failed to load agent session records for repo '${workspaceRepoPath}': ${errorMessage(
        taskSessionRecordsQuery.error,
      )}`
    : null;

  const selection = useAgentStudioSelectionController({
    activeWorkspace,
    isRepoNavigationBoundaryPending,
    tasks,
    isLoadingTasks: isForegroundLoadingTasks,
    taskSessionRecordsByTaskId,
    isLoadingTaskSessionRecords:
      shouldLoadTaskSessionRecords &&
      taskSessionRecordsQuery.data === undefined &&
      taskSessionRecordsQuery.isFetching,
    sessions,
    sessionReadModelError: sessionReadModelError ?? taskSessionRecordsError,
    taskIdParam,
    sessionParam,
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
    readSessionModelCatalog,
    readSessionTodos,
    clearComposerInput: signalContextSwitchIntent,
    onContextSwitchIntent: signalContextSwitchIntent,
  });
  const isSessionSelectionResolving =
    isSelectionIntentResolving || selection.isViewSessionResolving;

  const worktreeRecoverySignal = useAgentStudioWorktreeRecoverySignal({
    workspaceRepoPath,
    selection,
    isForegroundLoadingTasks,
  });

  useRepoRuntimeHealthWarmup({
    workspaceRepoPath,
    runtimeDefinitions,
    isLoadingChecks,
    hasCachedRepoRuntimeHealth,
    refreshRepoRuntimeHealthForRepo,
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
    signalContextSwitchIntent,
    contextSwitchVersion,
    selection,
    readiness,
    isSessionSelectionResolving,
    worktreeRecoverySignal,
    scheduleSelectionIntent,
  };
}
