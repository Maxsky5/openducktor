import type { RequestNewSessionStart } from "@/features/session-start";
import type { AgentStudioQueryUpdate } from "./agent-studio-navigation";
import type {
  AgentStudioOrchestrationActionsContext,
  AgentStudioOrchestrationComposerContext,
  AgentStudioOrchestrationReadinessContext,
  AgentStudioOrchestrationSelectionContext,
  AgentStudioOrchestrationWorkspaceContext,
} from "./use-agent-studio-orchestration-controller";

export type BuildAgentsPageOrchestrationContextsArgs = {
  activeRepo: string | null;
  selection: AgentStudioOrchestrationSelectionContext;
  readiness: AgentStudioOrchestrationReadinessContext;
  composer: AgentStudioOrchestrationComposerContext;
  actions: {
    updateQuery: (updates: AgentStudioQueryUpdate) => void;
    onContextSwitchIntent: () => void;
    startAgentSession: AgentStudioOrchestrationActionsContext["startAgentSession"];
    sendAgentMessage: AgentStudioOrchestrationActionsContext["sendAgentMessage"];
    stopAgentSession: AgentStudioOrchestrationActionsContext["stopAgentSession"];
    updateAgentSessionModel: AgentStudioOrchestrationActionsContext["updateAgentSessionModel"];
    loadAgentSessions: AgentStudioOrchestrationActionsContext["loadAgentSessions"];
    humanRequestChangesTask: AgentStudioOrchestrationActionsContext["humanRequestChangesTask"];
    replyAgentPermission: AgentStudioOrchestrationActionsContext["replyAgentPermission"];
    answerAgentQuestion: AgentStudioOrchestrationActionsContext["answerAgentQuestion"];
    requestNewSessionStart?: RequestNewSessionStart;
    openTaskDetails: () => void;
  };
};

export function buildAgentsPageOrchestrationContexts({
  activeRepo,
  selection,
  readiness,
  composer,
  actions,
}: BuildAgentsPageOrchestrationContextsArgs) {
  return {
    workspace: {
      activeRepo,
    } satisfies AgentStudioOrchestrationWorkspaceContext,
    selection,
    readiness,
    composer,
    actions: {
      updateQuery: actions.updateQuery,
      onContextSwitchIntent: actions.onContextSwitchIntent,
      startAgentSession: actions.startAgentSession,
      sendAgentMessage: actions.sendAgentMessage,
      stopAgentSession: actions.stopAgentSession,
      updateAgentSessionModel: actions.updateAgentSessionModel,
      loadAgentSessions: actions.loadAgentSessions,
      humanRequestChangesTask: actions.humanRequestChangesTask,
      replyAgentPermission: actions.replyAgentPermission,
      answerAgentQuestion: actions.answerAgentQuestion,
      ...(actions.requestNewSessionStart
        ? { requestNewSessionStart: actions.requestNewSessionStart }
        : {}),
      openTaskDetails: actions.openTaskDetails,
    } satisfies AgentStudioOrchestrationActionsContext,
  };
}
