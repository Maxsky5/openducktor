import type { RepoPromptOverrides, TaskCard, TaskWorktreeSummary } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { SessionStartGate } from "@/features/session-start/session-start-gate";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import type {
  EnsureExistingSessionRuntime,
  EnsureRuntime,
  TaskDocuments,
} from "../runtime/runtime";
import type { LoadSourceSession } from "../session-read-model/source-session-loader";
import type { LoadSettingsSnapshotForRuntimePolicy } from "../support/session-runtime-policy";
import type { SessionTurnState } from "../support/session-turn-state";
import type { PendingInputActionDependencies } from "./pending-input-actions";
import { createPendingInputActions } from "./pending-input-actions";
import { createPrepareSessionSend } from "./prepare-session-send";
import { createSendAgentMessage } from "./send-agent-message";
import { createSessionModelActions } from "./session-model-actions";
import { createStartAgentSession } from "./start-session";
import type { RuntimeDependencies, SessionDependencies } from "./start-session.types";
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
  sessionTurnState: SessionTurnState;
  updateSession: UpdateSession;
  canonicalizePath: RuntimeDependencies["canonicalizePath"];
  prepareTaskSessionStartupLease: RuntimeDependencies["prepareTaskSessionStartupLease"];
  completeTaskSessionStartupLease: RuntimeDependencies["completeTaskSessionStartupLease"];
  abortTaskSessionStartupLease: RuntimeDependencies["abortTaskSessionStartupLease"];
  resolveTaskWorktree: (repoPath: string, taskId: string) => Promise<TaskWorktreeSummary | null>;
  ensureRuntime: EnsureRuntime;
  ensureExistingSessionRuntime: EnsureExistingSessionRuntime;
  loadTaskDocuments: (repoPath: string, taskId: string) => Promise<TaskDocuments>;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
  loadSettingsSnapshot: LoadSettingsSnapshotForRuntimePolicy;
  liveSessionHost: PendingInputActionDependencies["liveSessionHost"];
  loadSourceSession: LoadSourceSession;
  loadAgentSessionHistory: (session: AgentSessionIdentity) => Promise<AgentSessionState | null>;
  refreshTaskData: (repoPath: string, taskIdOrIds?: string | string[]) => Promise<void>;
  persistSessionRecord: StopAgentSessionDependencies["persistSessionRecord"];
  deleteSessionRecord: SessionDependencies["deleteSessionRecord"];
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
  sessionTurnState,
  updateSession,
  canonicalizePath,
  prepareTaskSessionStartupLease,
  completeTaskSessionStartupLease,
  abortTaskSessionStartupLease,
  resolveTaskWorktree,
  ensureRuntime,
  ensureExistingSessionRuntime,
  loadTaskDocuments,
  loadRepoPromptOverrides,
  loadSettingsSnapshot,
  liveSessionHost,
  loadSourceSession,
  loadAgentSessionHistory,
  refreshTaskData,
  persistSessionRecord,
  deleteSessionRecord,
  invalidateSessionStopQueries,
}: SessionActionsDependencies) => {
  const prepareSessionSend = createPrepareSessionSend({
    workspaceRepoPath,
    workspaceId,
    repoEpochRef,
    currentWorkspaceRepoPathRef,
    taskRef,
    ensureExistingSessionRuntime,
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
      loadSourceSession,
      loadAgentSessionHistory,
      persistSessionRecord,
      deleteSessionRecord,
      clearSessionObservationState: sessionTurnState.clearSession,
    },
    runtime: {
      adapter,
      canonicalizePath,
      prepareTaskSessionStartupLease,
      completeTaskSessionStartupLease,
      abortTaskSessionStartupLease,
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
    clearSessionTurnState: sessionTurnState.clearSession,
    persistSessionRecord,
    invalidateSessionStopQueries,
    refreshTaskData,
  });

  const pendingInputActions = createPendingInputActions({
    workspaceRepoPath,
    liveSessionHost,
    readSessionSnapshot,
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
