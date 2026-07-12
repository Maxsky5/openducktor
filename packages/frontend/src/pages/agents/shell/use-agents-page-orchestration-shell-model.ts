import { type RefObject, useCallback, useMemo } from "react";
import type { AgentChatDraftScope } from "@/components/features/agents/agent-chat/agent-chat-draft-scope";
import type { RunSessionStartWorkflow } from "@/features/session-start";
import type { useAgentOperations, useTasksState } from "@/state/app-state-provider";
import type { RepoSettingsInput } from "@/types/state-slices";
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
  repoSettings: RepoSettingsInput | null;
  githubIntegrationEnabled: boolean;
  workspaceRepoPath: string | null;
  isForegroundLoadingTasks: boolean;
  routeSession: AgentsPageRouteSessionModel;
  hasActiveGitConflict: boolean;
  gitConflictQuickActionContext: AgentStudioGitConflictQuickActionContext | null;
  gitConflictQuickActionContextRef: RefObject<AgentStudioGitConflictQuickActionContext | null>;
  openTaskDetails: () => void;
  runSessionStartWorkflow: RunSessionStartWorkflow;
  agentOperations: Pick<
    ReturnType<typeof useAgentOperations>,
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
  repoSettings,
  githubIntegrationEnabled,
  workspaceRepoPath,
  isForegroundLoadingTasks,
  routeSession,
  hasActiveGitConflict,
  gitConflictQuickActionContext,
  gitConflictQuickActionContextRef,
  openTaskDetails,
  runSessionStartWorkflow,
  agentOperations,
  humanRequestChangesTask,
  setTaskTargetBranch,
}: UseAgentsPageOrchestrationShellModelArgs): AgentsPageOrchestrationShellModel {
  const { selection, scheduleQueryUpdate, selectAgentStudioSelection } = routeSession;

  const composer = useMemo(
    (): { draftScope: AgentChatDraftScope; workspaceId: string | null } => ({
      workspaceId: activeWorkspaceId,
      draftScope: {
        taskId: selection.view.taskId,
        role: selection.view.role,
        session: selection.view.selectedSession.identity,
      },
    }),
    [
      activeWorkspaceId,
      selection.view.role,
      selection.view.selectedSession.identity,
      selection.view.taskId,
    ],
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
    repoSettings,
    githubIntegrationEnabled,
    workspaceRepoPath,
    selection: orchestrationSelection,
    hasActiveGitConflict,
    composer,
    actions: {
      scheduleQueryUpdate,
      openTaskDetails,
      runSessionStartWorkflow,
      sendAgentMessage: agentOperations.sendAgentMessage,
      stopAgentSession: agentOperations.stopAgentSession,
      updateAgentSessionModel: agentOperations.updateAgentSessionModel,
      humanRequestChangesTask,
      setTaskTargetBranch,
      replyAgentApproval: agentOperations.replyAgentApproval,
      answerAgentQuestion: agentOperations.answerAgentQuestion,
      selectAgentStudioSelection,
    },
  });

  const { handleResolveRebaseConflict } = useAgentStudioRebaseConflictResolution({
    workspaceId: activeWorkspaceId,
    selection,
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
