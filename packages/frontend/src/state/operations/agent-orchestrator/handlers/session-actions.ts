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
import { isAgentSessionWaitingInput } from "@/lib/agent-session-waiting-input";
import { errorMessage } from "@/lib/errors";
import { isRoleAvailableForTask, unavailableRoleErrorMessage } from "@/lib/task-agent-workflows";
import {
  type AgentSessionCollection,
  type AgentSessionCollectionUpdater,
  getAgentSessionByExternalSessionId,
} from "@/state/agent-session-collection";
import type {
  AgentSessionIdentity,
  AgentSessionLoadOptions,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import { settleDanglingTodoToolMessages } from "../agent-tool-messages";
import { createEnsureSessionReady } from "../lifecycle/ensure-ready";
import type { EnsureRuntime, TaskDocuments } from "../runtime/runtime";
import { now } from "../support/core";
import { appendSessionMessage } from "../support/messages";
import { toPersistedSessionRecord } from "../support/persistence";
import { annotateQuestionToolMessage } from "../support/question-messages";
import {
  removeSessionListenersByExternalSessionId,
  type SessionListenerRegistry,
} from "../support/session-listener-registry";
import {
  buildUserStoppedNoticeMessage,
  USER_STOPPED_NOTICE,
} from "../support/session-notice-messages";
import {
  type ListenToAgentSession,
  toRuntimeSessionContextRef,
  toRuntimeSessionRef,
} from "../support/session-runtime-ref";
import { isWorkflowAgentSession } from "../support/workflow-session";
import { createStartAgentSession } from "./start-session";

type SessionActionsDependencies = {
  activeWorkspace: ActiveWorkspace | null;
  adapter: AgentEnginePort;
  setSessionCollection: (updater: AgentSessionCollectionUpdater) => void;
  sessionsRef: { current: AgentSessionCollection };
  taskRef: { current: TaskCard[] };
  repoEpochRef: { current: number };
  currentWorkspaceRepoPathRef: { current: string | null };
  inFlightStartsByWorkspaceTaskRef: { current: Map<string, Promise<string>> };
  sessionListenerRegistryRef: { current: SessionListenerRegistry };
  turnModelBySessionRef?: { current: Record<string, AgentSessionState["selectedModel"]> };
  recordTurnUserMessageTimestamp: (
    externalSessionId: string,
    timestamp: string | number,
  ) => number | undefined;
  readTurnUserMessageStartedAtMs: (externalSessionId: string) => number | undefined;
  updateSession: (
    identity: AgentSessionIdentity,
    updater: (current: AgentSessionState) => AgentSessionState,
    options?: { persist?: boolean },
  ) => void;
  listenToAgentSession: ListenToAgentSession;
  resolveTaskWorktree: (repoPath: string, taskId: string) => Promise<TaskWorktreeSummary | null>;
  ensureRuntime: EnsureRuntime;
  loadTaskDocuments: (repoPath: string, taskId: string) => Promise<TaskDocuments>;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;
  clearTurnDuration: (externalSessionId: string, completedTimestamp?: string) => void;
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

const markTurnUserAnchorIfMissing = (
  recordTurnUserMessageTimestamp: SessionActionsDependencies["recordTurnUserMessageTimestamp"],
  readTurnUserMessageStartedAtMs: SessionActionsDependencies["readTurnUserMessageStartedAtMs"],
  turnModelBySessionRef:
    | { current: Record<string, AgentSessionState["selectedModel"]> }
    | undefined,
  sessionsRef: { current: AgentSessionCollection },
  externalSessionId: string,
): void => {
  if (readTurnUserMessageStartedAtMs(externalSessionId) === undefined) {
    recordTurnUserMessageTimestamp(externalSessionId, Date.now());
  }
  if (turnModelBySessionRef) {
    turnModelBySessionRef.current[externalSessionId] =
      getAgentSessionByExternalSessionId(sessionsRef.current, externalSessionId)?.selectedModel ??
      null;
  }
};

const settleStartingSession = (
  externalSessionId: string,
  status: Extract<AgentSessionState["status"], "idle" | "error">,
  sessionsRef: { current: AgentSessionCollection },
  updateSession: SessionActionsDependencies["updateSession"],
): void => {
  const session = getAgentSessionByExternalSessionId(sessionsRef.current, externalSessionId);
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

const ensureSessionReadyForSend = async ({
  externalSessionId,
  ensureSessionReady,
  sessionsRef,
  updateSession,
}: {
  externalSessionId: string;
  ensureSessionReady: (externalSessionId: string) => Promise<void>;
  sessionsRef: { current: AgentSessionCollection };
  updateSession: SessionActionsDependencies["updateSession"];
}): Promise<void> => {
  try {
    await ensureSessionReady(externalSessionId);
  } catch (error) {
    settleStartingSession(externalSessionId, "error", sessionsRef, updateSession);
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
  sessionsRef,
  taskRef,
  repoEpochRef,
  currentWorkspaceRepoPathRef,
  inFlightStartsByWorkspaceTaskRef,
  sessionListenerRegistryRef,
  turnModelBySessionRef,
  recordTurnUserMessageTimestamp,
  readTurnUserMessageStartedAtMs,
  updateSession,
  listenToAgentSession,
  resolveTaskWorktree,
  ensureRuntime,
  loadTaskDocuments,
  loadRepoPromptOverrides,
  loadAgentSessions,
  clearTurnDuration,
  refreshTaskData,
  persistSessionRecord,
  stopAuthoritativeSession,
  invalidateSessionStopQueries,
}: SessionActionsDependencies) => {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const ensureSessionReady = createEnsureSessionReady({
    activeWorkspace,
    adapter,
    repoEpochRef,
    currentWorkspaceRepoPathRef,
    sessionsRef,
    taskRef,
    sessionListenerRegistryRef,
    updateSession,
    listenToAgentSession,
    ensureRuntime,
    loadRepoPromptOverrides,
  });

  const sendAgentMessage = async (
    externalSessionId: string,
    parts: AgentUserMessagePart[],
  ): Promise<void> => {
    const normalizedParts = normalizeAgentUserMessageParts(parts);
    if (!hasMeaningfulAgentUserMessageParts(normalizedParts)) {
      return;
    }

    const currentSession = getAgentSessionByExternalSessionId(
      sessionsRef.current,
      externalSessionId,
    );
    if (currentSession) {
      if (!isWorkflowAgentSession(currentSession)) {
        throw new Error(`Session '${externalSessionId}' is not a workflow session.`);
      }
      const task = taskRef.current.find((entry) => entry.id === currentSession.taskId);
      if (task && !isRoleAvailableForTask(task, currentSession.role)) {
        throw new Error(unavailableRoleErrorMessage(task, currentSession.role));
      }
      if (isAgentSessionWaitingInput(currentSession)) {
        settleStartingSession(externalSessionId, "idle", sessionsRef, updateSession);
        return;
      }
    }

    await ensureSessionReadyForSend({
      externalSessionId,
      ensureSessionReady,
      sessionsRef,
      updateSession,
    });

    const readySession = getAgentSessionByExternalSessionId(sessionsRef.current, externalSessionId);
    if (!readySession || isAgentSessionWaitingInput(readySession)) {
      settleStartingSession(externalSessionId, "idle", sessionsRef, updateSession);
      return;
    }

    const selectedModel = readySession.selectedModel ?? undefined;
    const isBusyQueuedSend = readySession.status === "running";
    let pendingUserMessageStartedAt: number | undefined;
    if (!isBusyQueuedSend) {
      pendingUserMessageStartedAt = recordTurnUserMessageTimestamp(externalSessionId, Date.now());
      if (turnModelBySessionRef) {
        turnModelBySessionRef.current[externalSessionId] = selectedModel ?? null;
      }
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
        externalSessionId,
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
        clearTurnDuration(externalSessionId);
        if (turnModelBySessionRef) {
          delete turnModelBySessionRef.current[externalSessionId];
        }
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
      sessionsRef,
      inFlightStartsByWorkspaceTaskRef,
      loadAgentSessions,
      persistSessionRecord,
      listenToAgentSession,
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

  const stopAgentSession = async (externalSessionId: string): Promise<void> => {
    const session = getAgentSessionByExternalSessionId(sessionsRef.current, externalSessionId);
    if (!session) {
      return;
    }
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
        ...(session.externalSessionId.trim().length > 0
          ? { externalSessionId: session.externalSessionId }
          : {}),
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

    try {
      await adapter.releaseSession(toRuntimeSessionRef(stopRepoPath, session));
    } catch (error) {
      console.warn(
        `Failed to release local session '${externalSessionId}' after authoritative stop: ${errorMessage(error)}`,
      );
    }

    removeSessionListenersByExternalSessionId(
      sessionListenerRegistryRef.current,
      externalSessionId,
    );
    clearTurnDuration(externalSessionId);
    if (turnModelBySessionRef) {
      delete turnModelBySessionRef.current[externalSessionId];
    }

    let stoppedSessionSnapshot: AgentSessionState | null = null;
    const stoppedAt = now();
    updateSession(session, (current) => {
      const shouldAppendUserStoppedNotice = Boolean(current.stopRequestedAt);
      const nextSession: AgentSessionState = {
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
      stoppedSessionSnapshot = nextSession;
      return nextSession;
    });

    const nextStoppedSession = stoppedSessionSnapshot as AgentSessionState | null;
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
    externalSessionId: string,
    selection: AgentModelSelection | null,
  ): void => {
    const session = getAgentSessionByExternalSessionId(sessionsRef.current, externalSessionId);
    if (!session) {
      return;
    }

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
    externalSessionId: string,
    requestId: string,
    outcome: RuntimeApprovalReplyOutcome,
    message?: string,
  ): Promise<void> => {
    const session = getAgentSessionByExternalSessionId(sessionsRef.current, externalSessionId);
    if (!session) {
      throw new Error(`Session '${externalSessionId}' is not loaded.`);
    }
    markTurnUserAnchorIfMissing(
      recordTurnUserMessageTimestamp,
      readTurnUserMessageStartedAtMs,
      turnModelBySessionRef,
      sessionsRef,
      externalSessionId,
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
    externalSessionId: string,
    requestId: string,
    answers: string[][],
  ): Promise<void> => {
    const session = getAgentSessionByExternalSessionId(sessionsRef.current, externalSessionId);
    if (!session) {
      throw new Error(`Session '${externalSessionId}' is not loaded.`);
    }
    markTurnUserAnchorIfMissing(
      recordTurnUserMessageTimestamp,
      readTurnUserMessageStartedAtMs,
      turnModelBySessionRef,
      sessionsRef,
      externalSessionId,
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
    settleStartedAgentSession: (externalSessionId: string): void => {
      settleStartingSession(externalSessionId, "idle", sessionsRef, updateSession);
    },
    stopAgentSession,
    updateAgentSessionModel,
    replyAgentApproval,
    answerAgentQuestion,
  };
};
