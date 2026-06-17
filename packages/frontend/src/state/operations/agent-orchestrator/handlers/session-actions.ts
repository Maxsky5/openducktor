import type { RepoPromptOverrides, TaskCard, TaskWorktreeSummary } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { SessionStartGate } from "@/features/session-start/session-start-gate";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import type { EnsureRuntime, TaskDocuments } from "../runtime/runtime";
import type { SessionObservers } from "../support/session-observers";
import type { ObserveAgentSession } from "../support/session-runtime-ref";
import type { SessionTurnState } from "../support/session-turn-state";
import { createPendingInputActions } from "./pending-input-actions";
import { createPrepareSessionSend } from "./prepare-session-send";
import { createSendAgentMessage } from "./send-agent-message";
import { createSessionModelActions } from "./session-model-actions";
import { createStartAgentSession } from "./start-session";
import { createStopAgentSession, type StopAgentSessionDependencies } from "./stop-session";

type SessionActionsDependencies = {
  workspaceRepoPath: string | null;
  workspaceId: string | null;
  adapter: AgentEnginePort;
  replaceSession: (session: AgentSessionState) => void;
  removeSession: (identity: AgentSessionIdentity) => void;
  readSessionSnapshot: (identity: AgentSessionIdentity) => AgentSessionState | null;
  taskRef: { current: TaskCard[] };
  repoEpochRef: { current: number };
  currentWorkspaceRepoPathRef: { current: string | null };
  sessionStartGateRef: { current: SessionStartGate<AgentSessionIdentity> };
  sessionObserversRef: { current: SessionObservers };
  sessionTurnState: SessionTurnState;
  updateSession: UpdateSession;
  observeAgentSession: ObserveAgentSession;
  resolveTaskWorktree: (repoPath: string, taskId: string) => Promise<TaskWorktreeSummary | null>;
  ensureRuntime: EnsureRuntime;
  loadTaskDocuments: (repoPath: string, taskId: string) => Promise<TaskDocuments>;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
  loadAgentSessions: (taskId: string) => Promise<void>;
  loadAgentSessionHistory: (session: AgentSessionIdentity) => Promise<unknown>;
  refreshTaskData: (
    repoPath: string,
    taskIdOrIds?: string | string[],
    options?: { forceFreshTaskList?: boolean },
  ) => Promise<void>;
  persistSessionRecord: StopAgentSessionDependencies["persistSessionRecord"];
  stopAuthoritativeSession: StopAgentSessionDependencies["stopAuthoritativeSession"];
  invalidateSessionStopQueries: StopAgentSessionDependencies["invalidateSessionStopQueries"];
};

export const createAgentSessionActions = ({
  workspaceRepoPath,
  workspaceId,
  adapter,
  replaceSession,
  removeSession,
  readSessionSnapshot,
  taskRef,
  repoEpochRef,
  currentWorkspaceRepoPathRef,
  sessionStartGateRef,
  sessionObserversRef,
  sessionTurnState,
  updateSession,
  observeAgentSession,
  resolveTaskWorktree,
  ensureRuntime,
  loadTaskDocuments,
  loadRepoPromptOverrides,
  loadAgentSessions,
  loadAgentSessionHistory,
  refreshTaskData,
  persistSessionRecord,
  stopAuthoritativeSession,
  invalidateSessionStopQueries,
}: SessionActionsDependencies) => {
  const prepareSessionSend = createPrepareSessionSend({
    workspaceRepoPath,
    workspaceId,
    repoEpochRef,
    currentWorkspaceRepoPathRef,
    taskRef,
    sessionObserversRef,
    observeAgentSession,
    ensureRuntime,
    loadRepoPromptOverrides,
  });

  const sendAgentMessage = createSendAgentMessage({
    workspaceRepoPath,
    adapter,
    readSessionSnapshot,
    taskRef,
    updateSession,
    prepareSessionSend,
    turnMetadata: sessionTurnState.metadata,
    clearSessionTurnState: sessionTurnState.clearSession,
    recordTurnUserMessageTimestamp: sessionTurnState.timing.recordTurnUserMessageTimestamp,
  });

  const startAgentSession = createStartAgentSession({
    repo: {
      workspaceRepoPath,
      workspaceId,
      repoEpochRef,
      currentWorkspaceRepoPathRef,
    },
    session: {
      replaceSession,
      removeSession,
      readSessionSnapshot,
      sessionStartGateRef,
      loadAgentSessions,
      loadAgentSessionHistory,
      persistSessionRecord,
      observeAgentSession,
    },
    runtime: {
      adapter,
      resolveTaskWorktree,
      ensureRuntime,
    },
    task: {
      taskRef,
      loadTaskDocuments,
      refreshTaskData,
      sendAgentMessage,
    },
    model: {
      loadRepoPromptOverrides,
    },
  });

  const stopAgentSession = createStopAgentSession({
    workspaceRepoPath,
    adapter,
    readSessionSnapshot,
    updateSession,
    sessionObserversRef,
    clearSessionTurnState: sessionTurnState.clearSession,
    persistSessionRecord,
    stopAuthoritativeSession,
    invalidateSessionStopQueries,
    refreshTaskData,
    loadAgentSessions,
  });

  const pendingInputActions = createPendingInputActions({
    workspaceRepoPath,
    adapter,
    readSessionSnapshot,
    updateSession,
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
    startAgentSession,
    stopAgentSession,
    updateAgentSessionModel: modelActions.updateAgentSessionModel,
    replyAgentApproval: pendingInputActions.replyAgentApproval,
    answerAgentQuestion: pendingInputActions.answerAgentQuestion,
  };
};
