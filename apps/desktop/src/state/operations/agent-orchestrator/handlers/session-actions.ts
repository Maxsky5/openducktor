import type {
  AgentSessionRecord,
  BuildContinuationTarget,
  RepoPromptOverrides,
  RuntimeKind,
  TaskCard,
} from "@openducktor/contracts";
import {
  type AgentEnginePort,
  type AgentModelSelection,
  type AgentRole,
  type AgentUserMessagePart,
  hasMeaningfulAgentUserMessageParts,
  normalizeAgentUserMessageParts,
} from "@openducktor/core";
import { isAgentSessionWaitingInput } from "@/lib/agent-session-waiting-input";
import { errorMessage } from "@/lib/errors";
import { isRoleAvailableForTask, unavailableRoleErrorMessage } from "@/lib/task-agent-workflows";
import type { AgentSessionLoadOptions, AgentSessionState } from "@/types/agent-orchestrator";
import { createEnsureSessionReady } from "../lifecycle/ensure-ready";
import type { RuntimeInfo, TaskDocuments } from "../runtime/runtime";
import { now } from "../support/core";
import { requiresHydratedAgentSessionHistory } from "../support/history-hydration";
import { toPersistedSessionRecord } from "../support/persistence";
import { annotateQuestionToolMessage } from "../support/question-messages";
import { createStartAgentSession } from "./start-session";

type SessionActionsDependencies = {
  activeRepo: string | null;
  adapter: AgentEnginePort;
  setSessionsById: (
    updater:
      | Record<string, AgentSessionState>
      | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
  ) => void;
  sessionsRef: { current: Record<string, AgentSessionState> };
  taskRef: { current: TaskCard[] };
  repoEpochRef: { current: number };
  activeRepoRef?: { current: string | null };
  previousRepoRef: { current: string | null };
  inFlightStartsByRepoTaskRef: { current: Map<string, Promise<string>> };
  unsubscribersRef: { current: Map<string, () => void> };
  turnStartedAtBySessionRef: { current: Record<string, number> };
  turnModelBySessionRef?: { current: Record<string, AgentSessionState["selectedModel"]> };
  updateSession: (
    sessionId: string,
    updater: (current: AgentSessionState) => AgentSessionState,
    options?: { persist?: boolean },
  ) => void;
  attachSessionListener: (repoPath: string, sessionId: string) => void;
  resolveBuildContinuationTarget?: (
    repoPath: string,
    taskId: string,
  ) => Promise<BuildContinuationTarget | null>;
  ensureRuntime: (repoPath: string, taskId: string, role: AgentRole) => Promise<RuntimeInfo>;
  loadTaskDocuments: (repoPath: string, taskId: string) => Promise<TaskDocuments>;
  loadRepoDefaultModel: (repoPath: string, role: AgentRole) => Promise<AgentModelSelection | null>;
  loadRepoPromptOverrides: (repoPath: string) => Promise<RepoPromptOverrides>;
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;
  clearTurnDuration: (sessionId: string) => void;
  refreshTaskData: (repoPath: string, taskId?: string) => Promise<void>;
  persistSessionRecord: (taskId: string, record: AgentSessionRecord) => Promise<void>;
  stopBuildRun?: (runId: string) => Promise<void>;
  invalidateSessionStopQueries?: (input: {
    repoPath: string;
    taskId: string;
    runtimeKind?: RuntimeKind;
  }) => Promise<void>;
};

const markTurnStartedIfMissing = (
  turnStartedAtBySessionRef: { current: Record<string, number> },
  turnModelBySessionRef:
    | { current: Record<string, AgentSessionState["selectedModel"]> }
    | undefined,
  sessionsRef: { current: Record<string, AgentSessionState> },
  sessionId: string,
): void => {
  if (turnStartedAtBySessionRef.current[sessionId] === undefined) {
    turnStartedAtBySessionRef.current[sessionId] = Date.now();
  }
  if (turnModelBySessionRef) {
    turnModelBySessionRef.current[sessionId] =
      sessionsRef.current[sessionId]?.selectedModel ?? null;
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
      session.messages,
      requestId,
      answeredQuestionsWithAnswers,
      answers,
    ),
  };
};

export const createAgentSessionActions = ({
  activeRepo,
  adapter,
  setSessionsById,
  sessionsRef,
  taskRef,
  repoEpochRef,
  activeRepoRef,
  previousRepoRef,
  inFlightStartsByRepoTaskRef,
  unsubscribersRef,
  turnStartedAtBySessionRef,
  turnModelBySessionRef,
  updateSession,
  attachSessionListener,
  resolveBuildContinuationTarget,
  ensureRuntime,
  loadTaskDocuments,
  loadRepoPromptOverrides,
  loadAgentSessions,
  clearTurnDuration,
  refreshTaskData,
  persistSessionRecord,
  stopBuildRun = async () => {
    throw new Error("Build stop operation is unavailable.");
  },
  invalidateSessionStopQueries,
}: SessionActionsDependencies) => {
  const ensureSessionReady = createEnsureSessionReady({
    activeRepo,
    adapter,
    repoEpochRef,
    previousRepoRef,
    sessionsRef,
    taskRef,
    unsubscribersRef,
    updateSession,
    attachSessionListener,
    ensureRuntime,
    loadRepoPromptOverrides,
  });

  const sendAgentMessage = async (
    sessionId: string,
    parts: AgentUserMessagePart[],
  ): Promise<void> => {
    const normalizedParts = normalizeAgentUserMessageParts(parts);
    if (!hasMeaningfulAgentUserMessageParts(normalizedParts)) {
      return;
    }

    const currentSession = sessionsRef.current[sessionId];
    if (currentSession) {
      const task = taskRef.current.find((entry) => entry.id === currentSession.taskId);
      if (task && !isRoleAvailableForTask(task, currentSession.role)) {
        throw new Error(unavailableRoleErrorMessage(task, currentSession.role));
      }
      if (isAgentSessionWaitingInput(currentSession)) {
        return;
      }
    }

    await ensureSessionReady(sessionId);

    const readySession = sessionsRef.current[sessionId];
    if (readySession && requiresHydratedAgentSessionHistory(readySession)) {
      await loadAgentSessions(readySession.taskId, {
        mode: "requested_history",
        targetSessionId: sessionId,
        historyPolicy: "requested_only",
      });
    }

    const hydratedSession = sessionsRef.current[sessionId];
    if (!hydratedSession || isAgentSessionWaitingInput(hydratedSession)) {
      return;
    }

    const selectedModel = hydratedSession.selectedModel ?? undefined;
    const isBusyQueuedSend = hydratedSession.status === "running";
    if (!isBusyQueuedSend) {
      turnStartedAtBySessionRef.current[sessionId] = Date.now();
      if (turnModelBySessionRef) {
        turnModelBySessionRef.current[sessionId] = selectedModel ?? null;
      }

      updateSession(
        sessionId,
        (current) => ({
          ...current,
          status: "running",
          draftAssistantText: "",
          draftAssistantMessageId: null,
          draftReasoningText: "",
          draftReasoningMessageId: null,
        }),
        { persist: false },
      );
    }

    try {
      await adapter.sendUserMessage({
        sessionId,
        parts: normalizedParts,
        ...(selectedModel ? { model: selectedModel } : {}),
      });
    } catch (error) {
      updateSession(
        sessionId,
        (current) => ({
          ...current,
          status: isBusyQueuedSend ? current.status : "error",
          ...(isBusyQueuedSend
            ? {}
            : {
                draftAssistantText: "",
                draftAssistantMessageId: null,
                draftReasoningText: "",
                draftReasoningMessageId: null,
              }),
          messages: [
            ...current.messages,
            {
              id: crypto.randomUUID(),
              role: "system",
              content: `Failed to send message: ${errorMessage(error)}`,
              timestamp: now(),
            },
          ],
        }),
        { persist: false },
      );
      if (!isBusyQueuedSend) {
        clearTurnDuration(sessionId);
        if (turnModelBySessionRef) {
          delete turnModelBySessionRef.current[sessionId];
        }
      }
    }
  };

  const startAgentSession = createStartAgentSession({
    repo: {
      activeRepo,
      repoEpochRef,
      previousRepoRef,
      ...(activeRepoRef ? { activeRepoRef } : {}),
    },
    session: {
      setSessionsById,
      sessionsRef,
      inFlightStartsByRepoTaskRef,
      loadAgentSessions,
      persistSessionRecord,
      attachSessionListener,
    },
    runtime: {
      adapter,
      resolveBuildContinuationTarget:
        resolveBuildContinuationTarget ??
        (async () => {
          throw new Error("Build continuation target resolution is unavailable.");
        }),
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

  const stopAgentSession = async (sessionId: string): Promise<void> => {
    const session = sessionsRef.current[sessionId];
    if (!session) {
      return;
    }

    const roleRequiresHostStop = session.role === "build" || session.role === "qa";
    const hasLocalRuntimeSession = adapter.hasSession(sessionId);

    try {
      if (roleRequiresHostStop && session.runId) {
        await stopBuildRun(session.runId);
      }
    } catch (error) {
      throw new Error(
        `Failed to stop ${session.role} session '${sessionId}': ${errorMessage(error)}`,
      );
    }

    if (hasLocalRuntimeSession) {
      try {
        await adapter.stopSession(sessionId);
      } catch (error) {
        console.warn(
          "[agent-orchestrator] local session stop failed after host stop",
          sessionId,
          errorMessage(error),
        );
      }
    }

    const unsubscribe = unsubscribersRef.current.get(sessionId);
    unsubscribe?.();
    unsubscribersRef.current.delete(sessionId);
    clearTurnDuration(sessionId);
    if (turnModelBySessionRef) {
      delete turnModelBySessionRef.current[sessionId];
    }

    let stoppedSessionSnapshot: AgentSessionState | null = null;
    updateSession(sessionId, (current) => {
      const nextSession: AgentSessionState = {
        ...current,
        status: "stopped",
        draftAssistantText: "",
        draftAssistantMessageId: null,
        draftReasoningText: "",
        draftReasoningMessageId: null,
        pendingPermissions: [],
        pendingQuestions: [],
      };
      stoppedSessionSnapshot = nextSession;
      return nextSession;
    });

    const nextStoppedSession = stoppedSessionSnapshot as AgentSessionState | null;
    if (nextStoppedSession) {
      await persistSessionRecord(
        nextStoppedSession.taskId,
        toPersistedSessionRecord(nextStoppedSession),
      );
    }

    if (activeRepo) {
      await Promise.all([
        invalidateSessionStopQueries?.({
          repoPath: activeRepo,
          taskId: session.taskId,
          ...(session.runtimeKind ? { runtimeKind: session.runtimeKind } : {}),
        }),
        refreshTaskData(activeRepo),
        loadAgentSessions(session.taskId),
      ]);
    }
  };

  const updateAgentSessionModel = (
    sessionId: string,
    selection: AgentModelSelection | null,
  ): void => {
    if (adapter.hasSession(sessionId)) {
      adapter.updateSessionModel({
        sessionId,
        model: selection,
      });
    }
    updateSession(
      sessionId,
      (current) => ({
        ...current,
        selectedModel: selection,
      }),
      { persist: true },
    );
  };

  const replyAgentPermission = async (
    sessionId: string,
    requestId: string,
    reply: "once" | "always" | "reject",
    message?: string,
  ): Promise<void> => {
    if (!adapter.hasSession(sessionId)) {
      await ensureSessionReady(sessionId, { allowPendingInput: true });
    }
    markTurnStartedIfMissing(
      turnStartedAtBySessionRef,
      turnModelBySessionRef,
      sessionsRef,
      sessionId,
    );
    await adapter.replyPermission({
      sessionId,
      requestId,
      reply,
      ...(message ? { message } : {}),
    });

    updateSession(
      sessionId,
      (current) => ({
        ...current,
        pendingPermissions: current.pendingPermissions.filter(
          (entry) => entry.requestId !== requestId,
        ),
      }),
      { persist: true },
    );
  };

  const answerAgentQuestion = async (
    sessionId: string,
    requestId: string,
    answers: string[][],
  ): Promise<void> => {
    if (!adapter.hasSession(sessionId)) {
      await ensureSessionReady(sessionId, { allowPendingInput: true });
    }
    markTurnStartedIfMissing(
      turnStartedAtBySessionRef,
      turnModelBySessionRef,
      sessionsRef,
      sessionId,
    );
    await adapter.replyQuestion({ sessionId, requestId, answers });
    updateSession(
      sessionId,
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
      { persist: true },
    );
  };

  return {
    ensureSessionReady,
    sendAgentMessage,
    startAgentSession,
    stopAgentSession,
    updateAgentSessionModel,
    replyAgentPermission,
    answerAgentQuestion,
  };
};
