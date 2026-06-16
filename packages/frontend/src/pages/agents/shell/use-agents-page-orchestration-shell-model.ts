import { type RefObject, useCallback, useMemo } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { toAgentSessionSummary } from "@/state/agent-sessions-store";
import type { useAgentOperations, useTasksState } from "@/state/app-state-provider";
import { useAgentStudioOrchestrationController } from "../use-agent-studio-orchestration-controller";
import { useAgentStudioRebaseConflictResolution } from "../use-agent-studio-rebase-conflict-resolution";
import type { AgentStudioGitConflictQuickActionContext } from "../use-agents-page-right-panel-model";
import type { AgentsPageRouteSessionModel } from "./use-agents-page-route-session-model";

type UseAgentsPageOrchestrationShellModelArgs = {
  activeWorkspaceId: string | null;
  branches: Parameters<typeof useAgentStudioOrchestrationController>[0]["branches"];
  runtimeDefinitions: Parameters<
    typeof useAgentStudioOrchestrationController
  >[0]["runtimeDefinitions"];
  workspaceRepoPath: string | null;
  isForegroundLoadingTasks: boolean;
  routeSession: AgentsPageRouteSessionModel;
  hasActiveGitConflict: boolean;
  gitConflictQuickActionContext: AgentStudioGitConflictQuickActionContext | null;
  gitConflictQuickActionContextRef: RefObject<AgentStudioGitConflictQuickActionContext | null>;
  openTaskDetails: () => void;
  agentOperations: Pick<
    ReturnType<typeof useAgentOperations>,
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
  activeWorkspaceId,
  branches,
  runtimeDefinitions,
  workspaceRepoPath,
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
  const { selection, scheduleQueryUpdate, scheduleSelectionIntent } = routeSession;

  const draftStateKey = useMemo(
    () =>
      [
        selection.view.taskId,
        selection.view.role,
        selection.view.activeSession
          ? agentSessionIdentityKey(selection.view.activeSession)
          : "new",
      ].join(":"),
    [selection.view.activeSession, selection.view.role, selection.view.taskId],
  );

  const orchestrationSelection = useMemo<
    AgentsPageOrchestrationShellModel["orchestrationSelection"]
  >(
    () => ({
      ...selection,
      isLoadingTasks: isForegroundLoadingTasks,
    }),
    [isForegroundLoadingTasks, selection],
  );

  const orchestration = useAgentStudioOrchestrationController({
    activeWorkspaceId,
    branches,
    runtimeDefinitions,
    workspaceRepoPath,
    selection: orchestrationSelection,
    hasActiveGitConflict,
    draftStateKey,
    actions: {
      updateQuery: scheduleQueryUpdate,
      openTaskDetails,
      startAgentSession: agentOperations.startAgentSession,
      settleStartedAgentSession: agentOperations.settleStartedAgentSession,
      sendAgentMessage: agentOperations.sendAgentMessage,
      stopAgentSession: agentOperations.stopAgentSession,
      updateAgentSessionModel: agentOperations.updateAgentSessionModel,
      readSessionFileSearch: agentOperations.readSessionFileSearch,
      readSessionSlashCommands: agentOperations.readSessionSlashCommands,
      readSessionSkills: agentOperations.readSessionSkills,
      humanRequestChangesTask,
      setTaskTargetBranch,
      replyAgentApproval: agentOperations.replyAgentApproval,
      answerAgentQuestion: agentOperations.answerAgentQuestion,
      scheduleSelectionIntent,
    },
  });

  const activeSessionSummary = selection.activeSessionSummary;
  const selectedViewSessionSummary = useMemo(
    () =>
      selection.view.activeSessionSummary ??
      (selection.view.activeSession ? toAgentSessionSummary(selection.view.activeSession) : null),
    [selection.view.activeSession, selection.view.activeSessionSummary],
  );
  const rebaseConflictSelection = useMemo(
    () => ({
      view: {
        taskId: selection.view.taskId,
        selectedTask: selection.view.selectedTask,
        activeSession: selectedViewSessionSummary,
        sessionsForTask: selection.view.sessionsForTask,
      },
      activeSession: activeSessionSummary,
      selectedSessionFromRoute: selection.selectedSessionFromRoute,
      sessionsForTask: selection.sessionsForTask,
    }),
    [
      activeSessionSummary,
      selection.selectedSessionFromRoute,
      selection.sessionsForTask,
      selection.view.selectedTask,
      selection.view.sessionsForTask,
      selection.view.taskId,
      selectedViewSessionSummary,
    ],
  );

  const { handleResolveRebaseConflict } = useAgentStudioRebaseConflictResolution({
    workspaceId: activeWorkspaceId,
    selection: rebaseConflictSelection,
    scheduleQueryUpdate,
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
