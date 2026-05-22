import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentRole, AgentSessionTodoItem } from "@openducktor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigationType, useSearchParams } from "react-router-dom";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { AgentStudioQueryUpdate } from "../agent-studio-navigation";
import { useAgentStudioQuerySessionSync } from "../use-agent-studio-query-session-sync";
import { useAgentStudioQuerySync } from "../use-agent-studio-query-sync";
import { useAgentStudioSelectionController } from "../use-agent-studio-selection-controller";
import { useAgentStudioReadiness } from "../use-agents-page-readiness";
import {
  type AgentStudioSelectionIntent,
  isSelectionIntentResolved,
} from "./agent-studio-selection-intent";

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
  hydrateRequestedTaskSessionHistory: (input: {
    taskId: string;
    externalSessionId: string;
  }) => Promise<void>;
  ensureSessionReadyForView: (input: {
    taskId: string;
    externalSessionId: string;
    repoReadinessState: Parameters<
      typeof useAgentStudioSelectionController
    >[0]["agentStudioReadinessState"];
    recoveryDedupKey?: string | null;
  }) => Promise<boolean>;
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
  hydrateRequestedTaskSessionHistory,
  ensureSessionReadyForView,
  readSessionModelCatalog,
  readSessionTodos,
}: UseAgentsPageRouteSessionModelArgs): AgentsPageRouteSessionModel {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigationType = useNavigationType();
  const [contextSwitchVersion, setContextSwitchVersion] = useState(0);
  const [selectionIntent, setSelectionIntent] = useState<AgentStudioSelectionIntent | null>(null);
  const [sessionlessSelection, setSessionlessSelection] =
    useState<AgentStudioSelectionIntent | null>(null);
  const [worktreeRecoverySignal, setWorktreeRecoverySignal] = useState(0);
  const lastWorktreeRecoveryKeyRef = useRef<string | null>(null);

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

  const scheduleSelectionIntent = useCallback(
    (intent: { taskId: string; externalSessionId: string | null; role: AgentRole }): void => {
      setSelectionIntent(intent);
      setSessionlessSelection(intent.externalSessionId === null ? intent : null);
    },
    [],
  );

  const activeSessionlessSelection =
    sessionlessSelection &&
    sessionlessSelection.taskId === taskIdParam &&
    sessionlessSelection.role === roleFromQuery &&
    sessionParam === null
      ? sessionlessSelection
      : null;

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
    taskIdParam,
    sessionParam,
    hasExplicitRoleParam,
    roleFromQuery,
    selectionIntent: selectionIntent ?? activeSessionlessSelection,
    updateQuery: scheduleQueryUpdate,
    agentStudioReadinessState: readiness.agentStudioReadinessState,
    hydrateRequestedTaskSessionHistory,
    ensureSessionReadyForView,
    runtimeDefinitions,
    readSessionModelCatalog,
    readSessionTodos,
    clearComposerInput: signalContextSwitchIntent,
    onContextSwitchIntent: signalContextSwitchIntent,
  });

  useEffect(() => {
    if (isRepoNavigationBoundaryPending) {
      setSelectionIntent(null);
      return;
    }

    if (!selectionIntent) {
      return;
    }

    const selectionIntentResolved = isSelectionIntentResolved({
      selectionIntent,
      taskIdParam,
      sessionParam,
      roleFromQuery,
    });

    if (selectionIntentResolved) {
      setSelectionIntent(null);
    }
  }, [isRepoNavigationBoundaryPending, roleFromQuery, selectionIntent, sessionParam, taskIdParam]);

  const isSessionSelectionResolving = Boolean(
    selectionIntent &&
      !isRepoNavigationBoundaryPending &&
      !isSelectionIntentResolved({
        selectionIntent,
        taskIdParam,
        sessionParam,
        roleFromQuery,
      }),
  );

  useEffect(() => {
    const nextRecoveryKey = [
      workspaceRepoPath ?? "",
      selection.viewTaskId ?? "",
      selection.viewSelectedTask?.updatedAt ?? "",
      selection.viewSelectedTask?.status ?? "",
      selection.viewActiveSession?.externalSessionId ?? "",
      selection.viewActiveSession?.status ?? "",
      selection.viewActiveSession?.workingDirectory ?? "",
      selection.isViewSessionHistoryHydrating ? "1" : "0",
      isForegroundLoadingTasks ? "1" : "0",
    ].join(":");

    if (lastWorktreeRecoveryKeyRef.current === null) {
      lastWorktreeRecoveryKeyRef.current = nextRecoveryKey;
      return;
    }

    if (lastWorktreeRecoveryKeyRef.current === nextRecoveryKey) {
      return;
    }

    lastWorktreeRecoveryKeyRef.current = nextRecoveryKey;
    setWorktreeRecoverySignal((previous) => previous + 1);
  }, [
    isForegroundLoadingTasks,
    selection.isViewSessionHistoryHydrating,
    selection.viewActiveSession?.externalSessionId,
    selection.viewActiveSession?.status,
    selection.viewActiveSession?.workingDirectory,
    selection.viewSelectedTask?.status,
    selection.viewSelectedTask?.updatedAt,
    selection.viewTaskId,
    workspaceRepoPath,
  ]);

  useEffect(() => {
    if (!workspaceRepoPath || runtimeDefinitions.length === 0 || isLoadingChecks) {
      return;
    }

    const runtimeKinds = runtimeDefinitions.map((definition) => definition.kind);
    if (hasCachedRepoRuntimeHealth(workspaceRepoPath, runtimeKinds)) {
      return;
    }

    void refreshRepoRuntimeHealthForRepo(workspaceRepoPath, false);
  }, [
    workspaceRepoPath,
    hasCachedRepoRuntimeHealth,
    isLoadingChecks,
    refreshRepoRuntimeHealthForRepo,
    runtimeDefinitions,
  ]);

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
    isActiveTaskHydrated: selection.isActiveTaskHydrated,
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
