import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentRole, AgentSessionTodoItem } from "@openducktor/core";
import { useCallback, useState } from "react";
import { useNavigationType, useSearchParams } from "react-router-dom";
import { useRepoRuntimeHealthWarmup } from "@/components/features/agents/use-repo-runtime-health-warmup";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { SessionRepoReadinessState } from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import type {
  AgentSessionState,
  EnsureSessionReadyForViewResult,
} from "@/types/agent-orchestrator";
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
  ensureSessionReadyForView: (input: {
    taskId: string;
    externalSessionId: string;
    repoReadinessState: SessionRepoReadinessState;
  }) => Promise<EnsureSessionReadyForViewResult>;
  readSessionModelCatalog: (
    repoPath: string,
    runtimeKind: NonNullable<AgentSessionState["runtimeKind"]>,
  ) => Promise<AgentModelCatalog>;
  readSessionTodos: (
    repoPath: string,
    runtimeKind: NonNullable<AgentSessionState["runtimeKind"]>,
    workingDirectory: string,
    externalSessionId: string,
  ) => Promise<AgentSessionTodoItem[]>;
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
  ensureSessionReadyForView,
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

  const selection = useAgentStudioSelectionController({
    activeWorkspace,
    isRepoNavigationBoundaryPending,
    tasks,
    isLoadingTasks: isForegroundLoadingTasks,
    sessions,
    sessionReadModelError,
    taskIdParam,
    sessionParam,
    hasExplicitRoleParam,
    roleFromQuery,
    selectionIntent: selectionIntentForController,
    updateQuery: scheduleQueryUpdate,
    ensureSessionReadyForView,
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
    isSelectionIntentResolving || selection.viewSessionLifecycle.isResolvingSession;

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
    selectedSessionById: selection.selectedSessionById,
    taskId: selection.taskId,
    activeSession: selection.activeSession,
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
