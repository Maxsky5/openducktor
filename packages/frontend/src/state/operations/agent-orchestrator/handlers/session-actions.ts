import type {
  AgentSessionRecord,
  AgentSessionStopTarget,
  RepoPromptOverrides,
  RuntimeApprovalReplyOutcome,
  RuntimeKind,
  TaskCard,
  TaskWorktreeSummary,
} from "@openducktor/contracts";
import {
  type AgentEnginePort,
  type AgentModelSelection,
  type AgentUserMessagePart,
  hasMeaningfulAgentUserMessageParts,
  normalizeAgentUserMessageParts,
} from "@openducktor/core";
import type { SessionStartGate } from "@/features/session-start/session-start-gate";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { isAgentSessionWaitingInput } from "@/lib/agent-session-waiting-input";
import { errorMessage } from "@/lib/errors";
import { isRoleAvailableForTask, unavailableRoleErrorMessage } from "@/lib/task-agent-workflows";
import type { AgentSessionCollectionUpdater } from "@/state/agent-session-collection";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import { settleDanglingTodoToolMessages } from "../agent-tool-messages";
import { createEnsureSessionReady } from "../lifecycle/ensure-ready";
import type { EnsureRuntime, TaskDocuments } from "../runtime/runtime";
import { now } from "../support/core";
import { appendSessionMessage } from "../support/messages";
import { toPersistedSessionRecord } from "../support/persistence";
import { annotateQuestionToolMessage } from "../support/question-messages";
import {
  buildUserStoppedNoticeMessage,
  USER_STOPPED_NOTICE,
} from "../support/session-notice-messages";
import type { SessionObservers } from "../support/session-observers";
import {
  type ObserveAgentSession,
  toRuntimeSessionContextRef,
  toRuntimeSessionRef,
} from "../support/session-runtime-ref";
import {
  clearSessionTransientState,
  type SessionTransientState,
} from "../support/session-transient-state";
import { isWorkflowAgentSession } from "../support/workflow-session";
import { createStartAgentSession } from "./start-session";

type SessionActionsDependencies = {
  activeWorkspace: ActiveWorkspace | null;
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
  persistSessionRecord: (taskId: string, record: AgentSessionRecord) => Promise<void>;
  stopAuthoritativeSession: (target: AgentSessionStopTarget) => Promise<void>;
  invalidateSessionStopQueries: (input: {
    repoPath: string;
    taskId: string;
    runtimeKind?: RuntimeKind;
  }) => Promise<void>;
};

type ReadSessionSnapshot = SessionActionsDependencies["readSessionSnapshot"];

const markTurnUserAnchorIfMissing = (
  recordTurnUserMessageTimestamp: SessionActionsDependencies["recordTurnUserMessageTimestamp"],
  readTurnUserMessageStartedAtMs: SessionActionsDependencies["readTurnUserMessageStartedAtMs"],
  turnMetadata: SessionTransientState["turnMetadata"],
  session: AgentSessionState,
): void => {
  const sessionKey = agentSessionIdentityKey(session);
  if (readTurnUserMessageStartedAtMs(sessionKey) === undefined) {
    recordTurnUserMessageTimestamp(sessionKey, Date.now());
  }
  turnMetadata.recordModel(sessionKey, session.selectedModel ?? null);
};

const settleStartingSession = (
  identity: AgentSessionIdentity,
  status: Extract<AgentSessionState["status"], "idle" | "error">,
  readSessionSnapshot: ReadSessionSnapshot,
  updateSession: SessionActionsDependencies["updateSession"],
): void => {
  const session = readSessionSnapshot(identity);
  if (session?.status !== "starting") {
    return;
  }

  updateSession(
    session,
    (current) => ({
      ...current,
      status,
    }),
    { persist: false },
  );
};

const requireWorkspaceRepoPath = (workspaceRepoPath: string | null): string => {
  if (!workspaceRepoPath) {
    throw new Error("Active workspace repo path is unavailable.");
  }
  return workspaceRepoPath;
};

const requireLoadedSession = (
  readSessionSnapshot: ReadSessionSnapshot,
  identity: AgentSessionIdentity,
): AgentSessionState => {
  const session = readSessionSnapshot(identity);
  if (!session) {
    throw new Error(`Session '${identity.externalSessionId}' is not loaded.`);
  }
  return session;
};

const ensureSessionReadyForSend = async ({
  session,
  ensureSessionReady,
  readSessionSnapshot,
  updateSession,
}: {
  session: AgentSessionState;
  ensureSessionReady: (session: AgentSessionIdentity) => Promise<AgentSessionIdentity>;
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: SessionActionsDependencies["updateSession"];
}): Promise<AgentSessionIdentity> => {
  try {
    return await ensureSessionReady(session);
  } catch (error) {
    settleStartingSession(session, "error", readSessionSnapshot, updateSession);
    throw error;
  }
};

const applyQuestionAnswerToSession = (
  session: AgentSessionState,
  requestId: string,
  answers: string[][],
): Pick<AgentSessionState, "pendingQuestions" | "messages"> => {
  const answeredRequest = session.pendingQuestions.find((entry) => entry.requestId === requestId);
  const pendingQuestions = session.pendingQuestions.filter(
    (entry) => entry.requestId !== requestId,
  );
  if (!answeredRequest || answeredRequest.questions.length === 0) {
    return {
      pendingQuestions,
      messages: session.messages,
    };
  }

  const answeredQuestionsWithAnswers = answeredRequest.questions.map((question, index) => ({
    ...question,
    answers: answers[index] ?? [],
  }));
  return {
    pendingQuestions,
    messages: annotateQuestionToolMessage(
      session,
      requestId,
      answeredQuestionsWithAnswers,
      answers,
    ),
  };
};

const appendUserStoppedNotice = (
  session: AgentSessionState,
  timestamp: string,
): AgentSessionState["messages"] =>
  appendSessionMessage(
    {
      externalSessionId: session.externalSessionId,
      messages: settleDanglingTodoToolMessages(session, timestamp, {
        outcome: "error",
        errorMessage: USER_STOPPED_NOTICE,
      }),
    },
    buildUserStoppedNoticeMessage(timestamp),
  );

export const createAgentSessionActions = ({
  activeWorkspace,
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
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const { turnMetadata } = sessionTransientState;
  const ensureSessionReady = createEnsureSessionReady({
    activeWorkspace,
    adapter,
    repoEpochRef,
    currentWorkspaceRepoPathRef,
    readSessionSnapshot,
    taskRef,
    sessionObserversRef,
    updateSession,
    observeAgentSession,
    ensureRuntime,
    loadRepoPromptOverrides,
  });

  const sendAgentMessage = async (
    identity: AgentSessionIdentity,
    parts: AgentUserMessagePart[],
  ) => {
    const normalizedParts = normalizeAgentUserMessageParts(parts);
    if (!hasMeaningfulAgentUserMessageParts(normalizedParts)) {
      return;
    }

    const currentSession = requireLoadedSession(readSessionSnapshot, identity);
    const externalSessionId = currentSession.externalSessionId;
    if (!isWorkflowAgentSession(currentSession)) {
      throw new Error(`Session '${externalSessionId}' is not a workflow session.`);
    }
    const task = taskRef.current.find((entry) => entry.id === currentSession.taskId);
    if (task && !isRoleAvailableForTask(task, currentSession.role)) {
      throw new Error(unavailableRoleErrorMessage(task, currentSession.role));
    }
    if (isAgentSessionWaitingInput(currentSession)) {
      settleStartingSession(currentSession, "idle", readSessionSnapshot, updateSession);
      return;
    }

    const readySessionIdentity = await ensureSessionReadyForSend({
      session: currentSession,
      ensureSessionReady,
      readSessionSnapshot,
      updateSession,
    });

    const readySession = readSessionSnapshot(readySessionIdentity);
    if (!readySession || isAgentSessionWaitingInput(readySession)) {
      settleStartingSession(readySessionIdentity, "idle", readSessionSnapshot, updateSession);
      return;
    }

    const readyExternalSessionId = readySession.externalSessionId;
    const readySessionKey = agentSessionIdentityKey(readySession);
    const selectedModel = readySession.selectedModel ?? undefined;
    const isBusyQueuedSend = readySession.status === "running";
    let pendingUserMessageStartedAt: number | undefined;
    if (!isBusyQueuedSend) {
      pendingUserMessageStartedAt = recordTurnUserMessageTimestamp(readySessionKey, Date.now());
      turnMetadata.recordModel(readySessionKey, selectedModel ?? null);
    }

    if (!isBusyQueuedSend) {
      updateSession(
        readySession,
        (current) => ({
          ...current,
          status: "running",
          pendingUserMessageStartedAt,
          draftAssistantText: "",
          draftAssistantMessageId: null,
          draftReasoningText: "",
          draftReasoningMessageId: null,
        }),
        { persist: false },
      );
    }

    try {
      const repoPath = requireWorkspaceRepoPath(workspaceRepoPath);
      await adapter.sendUserMessage({
        ...toRuntimeSessionContextRef(repoPath, readySession),
        externalSessionId: readyExternalSessionId,
        parts: normalizedParts,
        ...(selectedModel ? { model: selectedModel } : {}),
      });
    } catch (error) {
      updateSession(
        readySession,
        (current) => ({
          ...current,
          status: isBusyQueuedSend ? current.status : "error",
          pendingUserMessageStartedAt: undefined,
          ...(isBusyQueuedSend
            ? {}
            : {
                draftAssistantText: "",
                draftAssistantMessageId: null,
                draftReasoningText: "",
                draftReasoningMessageId: null,
              }),
        }),
        { persist: false },
      );
      updateSession(
        readySession,
        (current) => ({
          ...current,
          messages: appendSessionMessage(current, {
            id: crypto.randomUUID(),
            role: "system",
            content: `Failed to send message: ${errorMessage(error)}`,
            timestamp: now(),
            meta: {
              kind: "session_notice",
              tone: "error",
              reason: "session_error",
              title: "Error",
            },
          }),
        }),
        { persist: false },
      );
      if (!isBusyQueuedSend) {
        clearSessionTransientState(sessionTransientState, readySession);
      }
    }
  };

  const startAgentSession = createStartAgentSession({
    repo: {
      activeWorkspace,
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

  const stopAgentSession = async (identity: AgentSessionIdentity): Promise<void> => {
    const session = readSessionSnapshot(identity);
    if (!session) {
      return;
    }
    const externalSessionId = session.externalSessionId;
    let stopRepoPath: string | null = null;

    updateSession(
      session,
      (current) => ({
        ...current,
        stopRequestedAt: now(),
      }),
      { persist: false },
    );

    try {
      stopRepoPath = workspaceRepoPath;
      if (!stopRepoPath) {
        throw new Error("Active workspace repo path is unavailable.");
      }

      await stopAuthoritativeSession({
        repoPath: stopRepoPath,
        taskId: session.taskId,
        externalSessionId: session.externalSessionId,
        runtimeKind: session.runtimeKind,
        workingDirectory: session.workingDirectory,
      });
    } catch (error) {
      updateSession(
        session,
        (current) => ({
          ...current,
          stopRequestedAt: null,
        }),
        { persist: false },
      );
      throw new Error(
        `Failed to stop ${session.role} session '${externalSessionId}': ${errorMessage(error)}`,
      );
    }

    const stoppedSessionRef = toRuntimeSessionRef(stopRepoPath, session);
    try {
      await adapter.releaseSession(stoppedSessionRef);
    } catch (error) {
      console.warn(
        `Failed to release local session '${externalSessionId}' after authoritative stop: ${errorMessage(error)}`,
      );
    }

    sessionObserversRef.current.remove(stoppedSessionRef);
    clearSessionTransientState(sessionTransientState, stoppedSessionRef);

    const stoppedAt = now();
    const nextStoppedSession = updateSession(session, (current) => {
      const shouldAppendUserStoppedNotice = Boolean(current.stopRequestedAt);
      return {
        ...current,
        status: "stopped",
        messages: shouldAppendUserStoppedNotice
          ? appendUserStoppedNotice(current, stoppedAt)
          : current.messages,
        draftAssistantText: "",
        draftAssistantMessageId: null,
        draftReasoningText: "",
        draftReasoningMessageId: null,
        stopRequestedAt: null,
        pendingApprovals: [],
        pendingQuestions: [],
      };
    });

    if (nextStoppedSession && isWorkflowAgentSession(nextStoppedSession)) {
      await persistSessionRecord(
        nextStoppedSession.taskId,
        toPersistedSessionRecord(nextStoppedSession),
      );
    }

    if (stopRepoPath) {
      await Promise.all([
        invalidateSessionStopQueries({
          repoPath: stopRepoPath,
          taskId: session.taskId,
        }),
        refreshTaskData(stopRepoPath),
        loadAgentSessions(session.taskId),
      ]);
    }
  };

  const updateAgentSessionModel = (
    identity: AgentSessionIdentity,
    selection: AgentModelSelection | null,
  ): void => {
    const session = readSessionSnapshot(identity);
    if (!session) {
      return;
    }
    const externalSessionId = session.externalSessionId;

    const repoPath = requireWorkspaceRepoPath(workspaceRepoPath);
    adapter.updateSessionModel({
      ...toRuntimeSessionRef(repoPath, session),
      externalSessionId,
      model: selection,
    });

    updateSession(
      session,
      (current) => ({
        ...current,
        selectedModel: selection,
      }),
      { persist: true },
    );
  };

  const replyAgentApproval = async (
    identity: AgentSessionIdentity,
    requestId: string,
    outcome: RuntimeApprovalReplyOutcome,
    message?: string,
  ): Promise<void> => {
    const session = requireLoadedSession(readSessionSnapshot, identity);
    markTurnUserAnchorIfMissing(
      recordTurnUserMessageTimestamp,
      readTurnUserMessageStartedAtMs,
      turnMetadata,
      session,
    );
    const repoPath = requireWorkspaceRepoPath(workspaceRepoPath);
    await adapter.replyApproval({
      ...toRuntimeSessionContextRef(repoPath, session),
      requestId,
      outcome,
      ...(message ? { message } : {}),
    });

    updateSession(
      session,
      (current) => ({
        ...current,
        pendingApprovals: current.pendingApprovals.filter((entry) => entry.requestId !== requestId),
      }),
      { persist: false },
    );
  };

  const answerAgentQuestion = async (
    identity: AgentSessionIdentity,
    requestId: string,
    answers: string[][],
  ): Promise<void> => {
    const session = requireLoadedSession(readSessionSnapshot, identity);
    markTurnUserAnchorIfMissing(
      recordTurnUserMessageTimestamp,
      readTurnUserMessageStartedAtMs,
      turnMetadata,
      session,
    );
    const repoPath = requireWorkspaceRepoPath(workspaceRepoPath);
    await adapter.replyQuestion({
      ...toRuntimeSessionContextRef(repoPath, session),
      requestId,
      answers,
    });
    updateSession(
      session,
      (current) => {
        const { pendingQuestions, messages } = applyQuestionAnswerToSession(
          current,
          requestId,
          answers,
        );

        return {
          ...current,
          pendingQuestions,
          messages,
        };
      },
      { persist: false },
    );
  };

  return {
    ensureSessionReady,
    sendAgentMessage,
    startAgentSession,
    settleStartedAgentSession: (session: AgentSessionIdentity): void => {
      settleStartingSession(session, "idle", readSessionSnapshot, updateSession);
    },
    stopAgentSession,
    updateAgentSessionModel,
    replyAgentApproval,
    answerAgentQuestion,
  };
};
