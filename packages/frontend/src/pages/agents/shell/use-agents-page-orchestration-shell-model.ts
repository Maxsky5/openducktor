import { useAgentMessageSendPolicy } from "@/lib/use-agent-message-send-policy";
import { useMemo } from "react";
import type { RepositoryGitProviderContext } from "@openducktor/contracts";
import type { RunSessionStartWorkflow } from "@/features/session-start";
import type { useAgentOperations } from "@/state/app-state-provider";
import type { RepoSettingsInput } from "@/types/state-slices";
import type { AgentStudioChatDraftScope } from "../agent-studio-chat-draft";
import { useAgentStudioOrchestrationController } from "../use-agent-studio-orchestration-controller";
import { useAgentStudioRebaseConflictResolution } from "../use-agent-studio-rebase-conflict-resolution";
import type { AgentsPageRouteSessionModel } from "./use-agents-page-route-session-model";

type UseAgentsPageOrchestrationShellModelArgs = {
  activeWorkspaceId: string | null;
  branches: Parameters<typeof useAgentStudioOrchestrationController>[0]["branches"];
  runtimeDefinitions: Parameters<
    typeof useAgentStudioOrchestrationController
  >[0]["runtimeDefinitions"];
  repoSettings: RepoSettingsInput | null;
  gitProviderContext: RepositoryGitProviderContext | undefined;
  gitProviderReadError: string | null;
  workspaceRepoPath: string | null;
  isForegroundLoadingTasks: boolean;
  routeSession: AgentsPageRouteSessionModel;
  openTaskDetails: () => void;
  runSessionStartWorkflow: RunSessionStartWorkflow;
  agentOperations: Pick<
    ReturnType<typeof useAgentOperations>,
    | "sendAgentMessage"
    | "continueInterruptedTurn"
    | "stopAgentSession"
    | "loadAgentSessionHistory"
    | "updateAgentSessionModel"
    | "replyAgentApproval"
    | "updateAgentSessionSpeed"
    | "answerAgentQuestion"
  >;
};

export type AgentsPageOrchestrationShellModel = {
  orchestration: ReturnType<typeof useAgentStudioOrchestrationController>;
  orchestrationSelection: Parameters<typeof useAgentStudioOrchestrationController>[0]["selection"];
  handleResolveRebaseConflict: ReturnType<
    typeof useAgentStudioRebaseConflictResolution
  >["handleResolveRebaseConflict"];
};

export function useAgentsPageOrchestrationShellModel({
  activeWorkspaceId,
  branches,
  runtimeDefinitions,
  repoSettings,
  gitProviderContext,
  gitProviderReadError,
  workspaceRepoPath,
  isForegroundLoadingTasks,
  routeSession,
  openTaskDetails,
  runSessionStartWorkflow,
  agentOperations,
}: UseAgentsPageOrchestrationShellModelArgs): AgentsPageOrchestrationShellModel {
  const { selection, scheduleQueryUpdate, selectAgentStudioSelection } = routeSession;

  const composer = useMemo(
    () =>
      ({
        workspaceId: activeWorkspaceId,
        draftScope: {
          taskId: selection.view.taskId,
          role: selection.view.role,
          session: selection.view.selectedSession.identity,
        },
      }) satisfies { draftScope: AgentStudioChatDraftScope; workspaceId: string | null },
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
    gitProviderContext,
    gitProviderReadError,
    workspaceRepoPath,
    selection: orchestrationSelection,
    taskExecutionFilePreview: routeSession.taskExecutionFilePreview,
    composer,
    actions: {
      scheduleQueryUpdate,
      openTaskDetails,
      runSessionStartWorkflow,
      sendAgentMessage: agentOperations.sendAgentMessage,
      continueInterruptedTurn: agentOperations.continueInterruptedTurn,
      stopAgentSession: agentOperations.stopAgentSession,
      loadAgentSessionHistory: agentOperations.loadAgentSessionHistory,
      updateAgentSessionModel: agentOperations.updateAgentSessionModel,
      updateAgentSessionSpeed: agentOperations.updateAgentSessionSpeed,
      replyAgentApproval: agentOperations.replyAgentApproval,
      answerAgentQuestion: agentOperations.answerAgentQuestion,
      selectAgentStudioSelection,
    },
  });

  const assertSessionCanSend = useAgentMessageSendPolicy();
  const { handleResolveRebaseConflict } = useAgentStudioRebaseConflictResolution({
    workspaceId: activeWorkspaceId,
    assertSessionCanSend,
    selection,
    scheduleQueryUpdate,
    startSessionRequest: orchestration.startSessionRequest,
  });

  return {
    orchestration,
    orchestrationSelection,
    handleResolveRebaseConflict,
  };
}
