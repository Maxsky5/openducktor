import type { RepoPromptOverrides, TaskCard, TaskWorktreeSummary } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { SessionStartGate } from "@/features/session-start/session-start-gate";
import type { AgentSessionCollectionUpdater } from "@/state/agent-session-collection";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { EnsureRuntime, TaskDocuments } from "../runtime/runtime";
import type { SessionObservers } from "../support/session-observers";
import type { ObserveAgentSession } from "../support/session-runtime-ref";
import type { SessionTransientState } from "../support/session-transient-state";
import { createPendingInputActions } from "./pending-input-actions";
import { createPrepareSessionSend } from "./prepare-session-send";
import { createSendAgentMessage, settleStartingSession } from "./send-agent-message";
import { createSessionModelActions } from "./session-model-actions";
import { createStartAgentSession } from "./start-session";
import { createStopAgentSession, type StopAgentSessionDependencies } from "./stop-session";

type SessionActionsDependencies = {
  workspaceRepoPath: string | null;
  workspaceId: string | null;
  adapter: AgentEnginePort;
  setSessionCollection: (updater: AgentSessionCollectionUpdater) => void;
  readSessionSnapshot: (identity: AgentSessionIdentity) => AgentSessionState | null;
  taskRef: { current: TaskCard[] };
  repoEpochRef: { current: number };
  currentWorkspaceRepoPathRef: { current: string | null };
  sessionStartGateRef: { current: SessionStartGate<AgentSessionIdentity> };
  sessionObserversRef: { current: SessionObservers };
  sessionTransientState: SessionTransientState;
  recordTurnUserMessageTimestamp: (
    sessionKey: string,
    timestamp: string | number,
  ) => number | undefined;
  readTurnUserMessageStartedAtMs: (sessionKey: string) => number | undefined;
  updateSession: (
    identity: AgentSessionIdentity,
    updater: (current: AgentSessionState) => AgentSessionState,
    options?: { persist?: boolean },
  ) => AgentSessionState | null;
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
  setSessionCollection,
  readSessionSnapshot,
  taskRef,
  repoEpochRef,
  currentWorkspaceRepoPathRef,
  sessionStartGateRef,
  sessionObserversRef,
  sessionTransientState,
  recordTurnUserMessageTimestamp,
  readTurnUserMessageStartedAtMs,
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
  const { turnMetadata } = sessionTransientState;
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
    sessionTransientState,
    recordTurnUserMessageTimestamp,
  });

  const startAgentSession = createStartAgentSession({
    repo: {
      workspaceRepoPath,
      workspaceId,
      repoEpochRef,
      currentWorkspaceRepoPathRef,
    },
    session: {
      setSessionCollection,
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
    sessionTransientState,
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
    turnMetadata,
    recordTurnUserMessageTimestamp,
    readTurnUserMessageStartedAtMs,
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
    settleStartedAgentSession: (session: AgentSessionIdentity): void => {
      settleStartingSession(session, "idle", readSessionSnapshot, updateSession);
    },
    stopAgentSession,
    updateAgentSessionModel: modelActions.updateAgentSessionModel,
    replyAgentApproval: pendingInputActions.replyAgentApproval,
    answerAgentQuestion: pendingInputActions.answerAgentQuestion,
  };
};
