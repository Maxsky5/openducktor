import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import type { SessionTurnState } from "../support/session-turn-state";
import type { PendingInputActionDependencies } from "./pending-input-actions";
import { createPendingInputActions } from "./pending-input-actions";
import { createContinueInterruptedTurn } from "./continue-interrupted-turn";
import { createPrepareSessionSend } from "./prepare-session-send";
import { createSendAgentMessage } from "./send-agent-message";
import { createSessionModelActions } from "./session-model-actions";
import { createStopAgentSession } from "./stop-session";
import { createRefreshStoppedWorkflowSession } from "./workflow-session-operation-policy";

type SessionActionsDependencies = {
  workspaceRepoPath: string | null;
  workspaceId: string | null;
  adapter: AgentEnginePort;
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
  workspaceRepoPath,
  workspaceId,
  adapter,
  readSessionSnapshot,
  taskRef,
  repoEpochRef,
  currentWorkspaceRepoPathRef,
  sessionTurnState,
  updateSession,
  closeBackgroundQuestions,
  loadRepoPromptOverrides,
  liveSessionHost,
  refreshTaskData,
  invalidateSessionStopQueries,
}: SessionActionsDependencies) => {
  const prepareSessionSend = createPrepareSessionSend({
    workspaceRepoPath,
    workspaceId,
    repoEpochRef,
    currentWorkspaceRepoPathRef,
    taskRef,
    loadRepoPromptOverrides,
  });

  const sendAgentMessage = createSendAgentMessage({
    workspaceRepoPath,
    repoEpochRef,
    currentWorkspaceRepoPathRef,
    adapter,
    readSessionSnapshot,
    updateSession,
    prepareSessionSend,
    turnMetadata: sessionTurnState.metadata,
    clearSessionTurnState: sessionTurnState.clearSession,
    recordTurnUserMessageTimestamp: sessionTurnState.timing.recordTurnUserMessageTimestamp,
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
    prepareSessionSend,
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
    stopAgentSession,
    continueInterruptedTurn,
    updateAgentSessionModel: modelActions.updateAgentSessionModel,
    replyAgentApproval: pendingInputActions.replyAgentApproval,
    answerAgentQuestion: pendingInputActions.answerAgentQuestion,
  };
};
