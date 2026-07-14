import type { RepoPromptOverrides, TaskCard, TaskWorktreeSummary } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { SessionStartGate } from "@/features/session-start/session-start-gate";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { host } from "../../shared/host";
import type { UpdateSession } from "../events/session-event-types";
import type {
  EnsureExistingSessionRuntime,
  EnsureRuntime,
  TaskDocuments,
} from "../runtime/runtime";
import type { LoadSourceSession } from "../session-read-model/source-session-loader";
import type { SessionObservers } from "../support/session-observers";
import type { LoadSettingsSnapshotForRuntimePolicy } from "../support/session-runtime-policy";
import type { ObserveAgentSession } from "../support/session-runtime-ref";
import type { SessionTurnState } from "../support/session-turn-state";
import { createPendingInputActions } from "./pending-input-actions";
import { createPrepareSessionSend } from "./prepare-session-send";
import { createSendAgentMessage } from "./send-agent-message";
import { createSessionModelActions } from "./session-model-actions";
import { createStartAgentSession } from "./start-session";
import type { SessionDependencies } from "./start-session.types";
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
  ensureExistingSessionRuntime: EnsureExistingSessionRuntime;
  loadTaskDocuments: (repoPath: string, taskId: string) => Promise<TaskDocuments>;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
  loadSettingsSnapshot: LoadSettingsSnapshotForRuntimePolicy;
  loadSourceSession: LoadSourceSession;
  loadAgentSessionHistory: (session: AgentSessionIdentity) => Promise<AgentSessionState | null>;
  refreshTaskData: (
    repoPath: string,
    taskIdOrIds?: string | string[],
    options?: { forceFreshTaskList?: boolean },
  ) => Promise<void>;
  persistSessionRecord: StopAgentSessionDependencies["persistSessionRecord"];
  deleteSessionRecord: SessionDependencies["deleteSessionRecord"];
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
  ensureExistingSessionRuntime,
  loadTaskDocuments,
  loadRepoPromptOverrides,
  loadSettingsSnapshot,
  loadSourceSession,
  loadAgentSessionHistory,
  refreshTaskData,
  persistSessionRecord,
  deleteSessionRecord,
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
    ensureExistingSessionRuntime,
    loadRepoPromptOverrides,
    loadSettingsSnapshot,
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
    loadSettingsSnapshot,
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
      loadSourceSession,
      loadAgentSessionHistory,
      persistSessionRecord,
      deleteSessionRecord,
      observeAgentSession,
      clearSessionObservationState: (identity) => {
        sessionObserversRef.current.remove(identity);
        sessionTurnState.clearSession(identity);
      },
    },
    runtime: {
      adapter,
      canonicalizePath: (path) => host.gitCanonicalizePath(path),
      prepareTaskSessionStartupLease: (repoPath, taskId, role) =>
        host.taskSessionStartupLeasePrepare(repoPath, taskId, role),
      completeTaskSessionStartupLease: (repoPath, taskId, leaseId) =>
        host.taskSessionStartupLeaseComplete(repoPath, taskId, leaseId),
      abortTaskSessionStartupLease: (repoPath, taskId, leaseId) =>
        host.taskSessionStartupLeaseAbort(repoPath, taskId, leaseId),
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
      loadSettingsSnapshot,
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
  });

  const pendingInputActions = createPendingInputActions({
    workspaceRepoPath,
    adapter,
    readSessionSnapshot,
    updateSession,
    turnMetadata: sessionTurnState.metadata,
    recordTurnUserMessageTimestamp: sessionTurnState.timing.recordTurnUserMessageTimestamp,
    readTurnUserMessageStartedAtMs: sessionTurnState.timing.readTurnUserMessageStartedAtMs,
    loadSettingsSnapshot,
  });

  const modelActions = createSessionModelActions({
    workspaceRepoPath,
    adapter,
    readSessionSnapshot,
    updateSession,
    isSessionObserved: (identity) => sessionObserversRef.current.has(identity),
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
