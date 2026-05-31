import { type RefObject, useCallback, useMemo } from "react";
import { toAgentSessionSummary } from "@/state/agent-sessions-store";
import type {
  useAgentOperations,
  useTasksState,
  useWorkspaceState,
} from "@/state/app-state-provider";
import { useAgentStudioOrchestrationController } from "../use-agent-studio-orchestration-controller";
import { useAgentStudioRebaseConflictResolution } from "../use-agent-studio-rebase-conflict-resolution";
import type { AgentStudioGitConflictQuickActionContext } from "../use-agents-page-right-panel-model";
import type { AgentsPageRouteSessionModel } from "./use-agents-page-route-session-model";

type UseAgentsPageOrchestrationShellModelArgs = {
  activeWorkspace: ReturnType<typeof useWorkspaceState>["activeWorkspace"];
  branches: ReturnType<typeof useWorkspaceState>["branches"];
  runtimeDefinitions: Parameters<
    typeof useAgentStudioOrchestrationController
  >[0]["runtimeDefinitions"];
  isForegroundLoadingTasks: boolean;
  routeSession: AgentsPageRouteSessionModel;
  hasActiveGitConflict: boolean;
  gitConflictQuickActionContext: AgentStudioGitConflictQuickActionContext | null;
  gitConflictQuickActionContextRef: RefObject<AgentStudioGitConflictQuickActionContext | null>;
  openTaskDetails: () => void;
  agentOperations: Pick<
    ReturnType<typeof useAgentOperations>,
    | "bootstrapTaskSessions"
    | "hydrateRequestedTaskSessionHistory"
    | "readSessionFileSearch"
    | "readSessionSlashCommands"
    | "readSessionSkills"
    | "startAgentSession"
    | "settleStartedAgentSession"
    | "sendAgentMessage"
    | "stopAgentSession"
    | "updateAgentSessionModel"
    | "replyAgentApproval"
    | "answerAgentQuestion"
  >;
  humanRequestChangesTask: ReturnType<typeof useTasksState>["humanRequestChangesTask"];
  setTaskTargetBranch: ReturnType<typeof useTasksState>["setTaskTargetBranch"];
};

export type AgentsPageOrchestrationShellModel = {
  orchestration: ReturnType<typeof useAgentStudioOrchestrationController>;
  orchestrationSelection: Parameters<typeof useAgentStudioOrchestrationController>[0]["selection"];
  handleResolveRebaseConflict: ReturnType<
    typeof useAgentStudioRebaseConflictResolution
  >["handleResolveRebaseConflict"];
  agentStudioHeaderModel: ReturnType<
    typeof useAgentStudioOrchestrationController
  >["agentStudioHeaderModel"];
};

export function useAgentsPageOrchestrationShellModel({
  activeWorkspace,
  branches,
  runtimeDefinitions,
  isForegroundLoadingTasks,
  routeSession,
  hasActiveGitConflict,
  gitConflictQuickActionContext,
  gitConflictQuickActionContextRef,
  openTaskDetails,
  agentOperations,
  humanRequestChangesTask,
  setTaskTargetBranch,
}: UseAgentsPageOrchestrationShellModelArgs): AgentsPageOrchestrationShellModel {
  const {
    selection,
    readiness,
    contextSwitchVersion,
    isSessionSelectionResolving,
    scheduleQueryUpdate,
    signalContextSwitchIntent,
    scheduleSelectionIntent,
  } = routeSession;

  const draftStateKey = useMemo(
    () =>
      [
        selection.viewTaskId,
        selection.viewRole,
        selection.viewActiveSession?.externalSessionId ?? "new",
        contextSwitchVersion,
      ].join(":"),
    [
      contextSwitchVersion,
      selection.viewActiveSession?.externalSessionId,
      selection.viewRole,
      selection.viewTaskId,
    ],
  );

  const orchestrationSelection = useMemo<
    AgentsPageOrchestrationShellModel["orchestrationSelection"]
  >(
    () => ({
      selectedSessionById: selection.selectedSessionById,
      taskId: selection.taskId,
      selectedTask: selection.selectedTask,
      allSessionSummaries: selection.allSessionSummaries,
      sessionsForTask: selection.sessionsForTask,
      activeSessionSummary: selection.activeSessionSummary,
      activeSession: selection.activeSession,
      ...(selection.activeSessionRuntimeDataError !== undefined
        ? { activeSessionRuntimeDataError: selection.activeSessionRuntimeDataError }
        : {}),
      isLoadingTasks: isForegroundLoadingTasks,
      activeTaskTabId: selection.activeTaskTabId,
      availableTabTasks: selection.availableTabTasks,
      taskTabs: selection.taskTabs,
      handleSelectTab: selection.handleSelectTab,
      handleCreateTab: selection.handleCreateTab,
      handleCloseTab: selection.handleCloseTab,
      handleReorderTab: selection.handleReorderTab,
      viewTaskId: selection.viewTaskId,
      viewSelectedTask: selection.viewSelectedTask,
      viewSessionsForTask: selection.viewSessionsForTask,
      viewActiveSessionSummary: selection.viewActiveSessionSummary,
      viewActiveSession: selection.viewActiveSession,
      ...(selection.viewSessionRuntimeDataError !== undefined
        ? { viewSessionRuntimeDataError: selection.viewSessionRuntimeDataError }
        : {}),
      viewRole: selection.viewRole,
      viewLaunchActionId: selection.viewLaunchActionId,
      isActiveTaskHydrated: selection.isActiveTaskHydrated,
      isActiveTaskHydrationFailed: selection.isActiveTaskHydrationFailed,
      isViewSessionHistoryHydrated: selection.isViewSessionHistoryHydrated,
      isViewSessionHistoryHydrationFailed: selection.isViewSessionHistoryHydrationFailed,
      isViewSessionHistoryHydrating: selection.isViewSessionHistoryHydrating,
      isViewSessionWaitingForRuntimeReadiness: selection.isViewSessionWaitingForRuntimeReadiness,
      contextSwitchVersion,
      isSessionSelectionResolving,
    }),
    [
      contextSwitchVersion,
      isForegroundLoadingTasks,
      isSessionSelectionResolving,
      selection.activeSession,
      selection.activeSessionRuntimeDataError,
      selection.activeSessionSummary,
      selection.activeTaskTabId,
      selection.allSessionSummaries,
      selection.availableTabTasks,
      selection.handleCloseTab,
      selection.handleCreateTab,
      selection.handleReorderTab,
      selection.handleSelectTab,
      selection.isActiveTaskHydrated,
      selection.isActiveTaskHydrationFailed,
      selection.isViewSessionHistoryHydrated,
      selection.isViewSessionHistoryHydrationFailed,
      selection.isViewSessionHistoryHydrating,
      selection.isViewSessionWaitingForRuntimeReadiness,
      selection.selectedSessionById,
      selection.selectedTask,
      selection.sessionsForTask,
      selection.taskId,
      selection.taskTabs,
      selection.viewActiveSession,
      selection.viewActiveSessionSummary,
      selection.viewLaunchActionId,
      selection.viewRole,
      selection.viewSelectedTask,
      selection.viewSessionRuntimeDataError,
      selection.viewSessionsForTask,
      selection.viewTaskId,
    ],
  );

  const orchestration = useAgentStudioOrchestrationController({
    activeWorkspace,
    branches,
    runtimeDefinitions,
    selection: orchestrationSelection,
    readiness,
    hasActiveGitConflict,
    draftStateKey,
    actions: {
      updateQuery: scheduleQueryUpdate,
      onContextSwitchIntent: signalContextSwitchIntent,
      openTaskDetails,
      startAgentSession: agentOperations.startAgentSession,
      settleStartedAgentSession: agentOperations.settleStartedAgentSession,
      sendAgentMessage: agentOperations.sendAgentMessage,
      stopAgentSession: agentOperations.stopAgentSession,
      updateAgentSessionModel: agentOperations.updateAgentSessionModel,
      readSessionFileSearch: agentOperations.readSessionFileSearch,
      readSessionSlashCommands: agentOperations.readSessionSlashCommands,
      readSessionSkills: agentOperations.readSessionSkills,
      bootstrapTaskSessions: agentOperations.bootstrapTaskSessions,
      hydrateRequestedTaskSessionHistory: agentOperations.hydrateRequestedTaskSessionHistory,
      humanRequestChangesTask,
      setTaskTargetBranch,
      replyAgentApproval: agentOperations.replyAgentApproval,
      answerAgentQuestion: agentOperations.answerAgentQuestion,
      scheduleSelectionIntent,
    },
  });

  const activeSessionSummary = useMemo(
    () =>
      selection.activeSessionSummary ??
      (selection.activeSession ? toAgentSessionSummary(selection.activeSession) : null),
    [selection.activeSession, selection.activeSessionSummary],
  );
  const viewActiveSessionSummary = useMemo(
    () =>
      selection.viewActiveSessionSummary ??
      (selection.viewActiveSession ? toAgentSessionSummary(selection.viewActiveSession) : null),
    [selection.viewActiveSession, selection.viewActiveSessionSummary],
  );
  const rebaseConflictSelection = useMemo(
    () => ({
      viewTaskId: selection.viewTaskId,
      viewSelectedTask: selection.viewSelectedTask,
      viewActiveSession: viewActiveSessionSummary,
      activeSession: activeSessionSummary,
      selectedSessionById: selection.selectedSessionById,
      viewSessionsForTask: selection.viewSessionsForTask,
      sessionsForTask: selection.sessionsForTask,
    }),
    [
      activeSessionSummary,
      selection.selectedSessionById,
      selection.sessionsForTask,
      selection.viewSelectedTask,
      selection.viewSessionsForTask,
      selection.viewTaskId,
      viewActiveSessionSummary,
    ],
  );

  const { handleResolveRebaseConflict } = useAgentStudioRebaseConflictResolution({
    activeWorkspace,
    selection: rebaseConflictSelection,
    scheduleQueryUpdate,
    onContextSwitchIntent: signalContextSwitchIntent,
    startSessionRequest: orchestration.startSessionRequest,
  });

  const handleResolveGitConflictQuickAction = useCallback(() => {
    void gitConflictQuickActionContextRef.current?.resolveWithBuilder();
  }, [gitConflictQuickActionContextRef]);

  const agentStudioHeaderModel = useMemo(
    () => ({
      ...orchestration.agentStudioHeaderModel,
      onResolveGitConflictQuickAction: gitConflictQuickActionContext
        ? handleResolveGitConflictQuickAction
        : null,
    }),
    [
      gitConflictQuickActionContext,
      handleResolveGitConflictQuickAction,
      orchestration.agentStudioHeaderModel,
    ],
  );

  return {
    orchestration,
    orchestrationSelection,
    handleResolveRebaseConflict,
    agentStudioHeaderModel,
  };
}
