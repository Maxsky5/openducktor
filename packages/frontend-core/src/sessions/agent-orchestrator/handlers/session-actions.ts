import type { RepoPromptOverrides } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { ClientFeedback } from "../../../platform/client-feedback";
import type { AgentMessageQueuesStore } from "../../agent-message-queues-store";
import type { AgentSessionIdentity, AgentSessionState } from "../../../types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import type { SessionTurnState } from "../support/session-turn-state";
import type { PendingInputActionDependencies } from "./pending-input-actions";
import { createPendingInputActions } from "./pending-input-actions";
import { createContinueInterruptedTurn } from "./continue-interrupted-turn";
import { createManageAgentMessageQueue } from "./message-queue-actions";
import { createSendAgentMessage } from "./send-agent-message";
import { createSessionModelActions } from "./session-model-actions";
import { createStopAgentSession } from "./stop-session";
import { createRefreshStoppedWorkflowSession } from "./workflow-session-operation-policy";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

type SessionActionsDependencies = {
  feedback: ClientFeedback;
  workspaceRepoPath: string | null;
  workspaceId: string | null;
  adapter: AgentEnginePort;
  messageQueues: AgentMessageQueuesStore;
  readSessionSnapshot: (identity: AgentSessionIdentity) => AgentSessionState | null;
  taskRef: { current: TaskCard[] };
  repoEpochRef: { current: number };
  currentWorkspaceRepoPathRef: { current: string | null };
  sessionTurnState: SessionTurnState;
  updateSession: UpdateSession;
  closeBackgroundQuestions: PendingInputActionDependencies["closeBackgroundQuestions"];
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
  liveSessionHost: PendingInputActionDependencies["liveSessionHost"];
  refreshTaskData: (repoPath: string, taskIdOrIds?: string | string[]) => Promise<void>;
  invalidateSessionStopQueries: (input: { repoPath: string; taskId: string }) => Promise<void>;
};

export const createAgentSessionActions = ({
  feedback,
  workspaceRepoPath,
  adapter,
  messageQueues,
  readSessionSnapshot,
  repoEpochRef,
  currentWorkspaceRepoPathRef,
  sessionTurnState,
  updateSession,
  closeBackgroundQuestions,
  liveSessionHost,
  refreshTaskData,
  invalidateSessionStopQueries,
}: SessionActionsDependencies) => {
  const sendAgentMessage = createSendAgentMessage({
    feedback,
    workspaceRepoPath,
    repoEpochRef,
    currentWorkspaceRepoPathRef,
    adapter,
    messageQueues,
    readSessionSnapshot,
    updateSession,
    turnMetadata: sessionTurnState.metadata,
    clearSessionTurnState: sessionTurnState.clearSession,
    recordTurnUserMessageTimestamp: sessionTurnState.timing.recordTurnUserMessageTimestamp,
  });

  const manageAgentMessageQueue = createManageAgentMessageQueue({
    workspaceRepoPath,
    repoEpochRef,
    currentWorkspaceRepoPathRef,
    adapter,
    messageQueues,
    readSessionSnapshot,
    updateSession,
  });

  const refreshStoppedWorkflowSession = createRefreshStoppedWorkflowSession({
    workspaceRepoPath,
    invalidateSessionStopQueries,
    refreshTaskData,
  });

  const stopAgentSession = createStopAgentSession({
    workspaceRepoPath,
    adapter,
    readSessionSnapshot,
    updateSession,
    clearSessionTurnState: sessionTurnState.clearSession,
    refreshStoppedWorkflowSession,
  });

  const continueInterruptedTurn = createContinueInterruptedTurn({
    workspaceRepoPath,
    adapter,
    readSessionSnapshot,
  });

  const pendingInputActions = createPendingInputActions({
    workspaceRepoPath,
    liveSessionHost,
    readSessionSnapshot,
    updateSession,
    closeBackgroundQuestions,
    turnMetadata: sessionTurnState.metadata,
    recordTurnUserMessageTimestamp: sessionTurnState.timing.recordTurnUserMessageTimestamp,
    readTurnUserMessageStartedAtMs: sessionTurnState.timing.readTurnUserMessageStartedAtMs,
  });

  const modelActions = createSessionModelActions({
    workspaceRepoPath,
    adapter,
    readSessionSnapshot,
    updateSession,
  });

  return {
    sendAgentMessage,
    manageAgentMessageQueue,
    stopAgentSession,
    continueInterruptedTurn,
    updateAgentSessionModel: modelActions.updateAgentSessionModel,
    replyAgentApproval: pendingInputActions.replyAgentApproval,
    answerAgentQuestion: pendingInputActions.answerAgentQuestion,
  };
};
