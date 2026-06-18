import { useCallback } from "react";
import { useNavigationType, useSearchParams } from "react-router-dom";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { RepoSettingsInput } from "@/types/state-slices";
import type { AgentStudioQueryUpdate } from "../query-sync/agent-studio-navigation";
import { useAgentStudioQuerySessionSync } from "../query-sync/use-agent-studio-query-session-sync";
import { useAgentStudioQuerySync } from "../query-sync/use-agent-studio-query-sync";
import { useAgentStudioSelectionController } from "../use-agent-studio-selection-controller";
import type { AgentStudioSelectionIntent } from "./agent-studio-selection-intent";
import { useAgentStudioSelectionIntentState } from "./use-agent-studio-selection-intent-state";

type UseAgentsPageRouteSessionModelArgs = {
  activeWorkspaceId: string | null;
  workspaceRepoPath: string | null;
  tasks: Parameters<typeof useAgentStudioSelectionController>[0]["tasks"];
  isForegroundLoadingTasks: boolean;
  sessions: AgentSessionSummary[];
  repoSettings: RepoSettingsInput | null;
  isLoadingRepoSettings: boolean;
};

export type AgentsPageRouteSessionModel = {
  navigationPersistenceError: Error | null;
  retryNavigationPersistence: () => void;
  scheduleQueryUpdate: (updates: AgentStudioQueryUpdate) => void;
  selection: ReturnType<typeof useAgentStudioSelectionController>;
  scheduleSelectionIntent: (intent: AgentStudioSelectionIntent) => void;
};

export function useAgentsPageRouteSessionModel({
  activeWorkspaceId,
  workspaceRepoPath,
  tasks,
  isForegroundLoadingTasks,
  sessions,
  repoSettings,
  isLoadingRepoSettings,
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
    activeWorkspaceId,
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
    activeWorkspaceId,
    workspaceRepoPath,
    isRepoNavigationBoundaryPending,
    tasks,
    isLoadingTasks: isForegroundLoadingTasks,
    sessions,
    taskIdParam,
    sessionKeyParam,
    hasExplicitRoleParam,
    roleFromQuery,
    selectionIntent: selectionIntentForController,
    repoSettings,
    isLoadingRepoSettings,
    updateQuery: scheduleQueryUpdate,
  });

  useAgentStudioQuerySessionSync({
    isRepoNavigationBoundaryPending,
    isLoadingTasks: isForegroundLoadingTasks,
    tasks,
    taskIdParam,
    sessionKeyParam,
    sessionFromQuery: selection.selectedSessionFromRoute,
    resolvedTaskId: selection.taskId,
    resolvedSession: selection.resolvedRouteSession,
    roleFromQuery,
    scheduleQueryUpdate,
  });

  return {
    navigationPersistenceError,
    retryNavigationPersistence,
    scheduleQueryUpdate,
    selection,
    scheduleSelectionIntent,
  };
}
