import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentModelSelection,
  AgentRole,
  AgentRuntimeConnection,
} from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import { isRoleAvailableForTask, unavailableRoleErrorMessage } from "@/lib/task-agent-workflows";
import type { AgentSessionLoadOptions, AgentSessionState } from "@/types/agent-orchestrator";
import { createEnsureSessionReady } from "../lifecycle/ensure-ready";
import type { RuntimeInfo, TaskDocuments } from "../runtime/runtime";
import { annotateQuestionToolMessage } from "../support/question-messages";
import { now } from "../support/utils";
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
  previousRepoRef: { current: string | null };
  inFlightStartsByRepoTaskRef: { current: Map<string, Promise<string>> };
  unsubscribersRef: { current: Map<string, () => void> };
  turnStartedAtBySessionRef: { current: Record<string, number> };
  updateSession: (
    sessionId: string,
    updater: (current: AgentSessionState) => AgentSessionState,
    options?: { persist?: boolean },
  ) => void;
  attachSessionListener: (repoPath: string, sessionId: string) => void;
  ensureRuntime: (repoPath: string, taskId: string, role: AgentRole) => Promise<RuntimeInfo>;
  loadTaskDocuments: (repoPath: string, taskId: string) => Promise<TaskDocuments>;
  loadRepoDefaultModel: (repoPath: string, role: AgentRole) => Promise<AgentModelSelection | null>;
  loadRepoPromptOverrides: (repoPath: string) => Promise<RepoPromptOverrides>;
  loadSessionTodos: (
    sessionId: string,
    runtimeKind: string,
    runtimeConnection: AgentRuntimeConnection,
    externalSessionId: string,
  ) => Promise<void>;
  loadSessionModelCatalog: (
    sessionId: string,
    runtimeKind: string,
    runtimeConnection: AgentRuntimeConnection,
  ) => Promise<void>;
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;
  clearTurnDuration: (sessionId: string) => void;
  refreshTaskData: (repoPath: string) => Promise<void>;
  persistSessionSnapshot: (session: AgentSessionState) => Promise<void>;
};

const markTurnStartedIfMissing = (
  turnStartedAtBySessionRef: { current: Record<string, number> },
  sessionId: string,
): void => {
  if (turnStartedAtBySessionRef.current[sessionId] === undefined) {
    turnStartedAtBySessionRef.current[sessionId] = Date.now();
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
  previousRepoRef,
  inFlightStartsByRepoTaskRef,
  unsubscribersRef,
  turnStartedAtBySessionRef,
  updateSession,
  attachSessionListener,
  ensureRuntime,
  loadTaskDocuments,
  loadRepoDefaultModel,
  loadRepoPromptOverrides,
  loadSessionTodos,
  loadSessionModelCatalog,
  loadAgentSessions,
  clearTurnDuration,
  refreshTaskData,
  persistSessionSnapshot,
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
    loadTaskDocuments,
    loadRepoPromptOverrides,
    loadSessionTodos,
    loadSessionModelCatalog,
  });

  const sendAgentMessage = async (sessionId: string, content: string): Promise<void> => {
    const trimmed = content.trim();
    if (!trimmed) {
      return;
    }

    const currentSession = sessionsRef.current[sessionId];
    if (currentSession) {
      const task = taskRef.current.find((entry) => entry.id === currentSession.taskId);
      if (task && !isRoleAvailableForTask(task, currentSession.role)) {
        throw new Error(unavailableRoleErrorMessage(task, currentSession.role));
      }
    }

    await ensureSessionReady(sessionId);

    const selectedModel = sessionsRef.current[sessionId]?.selectedModel ?? undefined;
    const userMessageMeta = selectedModel?.profileId
      ? {
          kind: "user" as const,
          ...(selectedModel.providerId ? { providerId: selectedModel.providerId } : {}),
          ...(selectedModel.modelId ? { modelId: selectedModel.modelId } : {}),
          ...(selectedModel.variant ? { variant: selectedModel.variant } : {}),
          ...(selectedModel.profileId ? { profileId: selectedModel.profileId } : {}),
        }
      : undefined;
    turnStartedAtBySessionRef.current[sessionId] = Date.now();

    updateSession(sessionId, (current) => ({
      ...current,
      status: "running",
      draftAssistantText: "",
      messages: [
        ...current.messages,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: trimmed,
          timestamp: now(),
          ...(userMessageMeta ? { meta: userMessageMeta } : {}),
        },
      ],
    }));

    try {
      await adapter.sendUserMessage({
        sessionId,
        content: trimmed,
        ...(selectedModel ? { model: selectedModel } : {}),
      });
    } catch (error) {
      updateSession(
        sessionId,
        (current) => ({
          ...current,
          status: "error",
          draftAssistantText: "",
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
      clearTurnDuration(sessionId);
    }
  };

  const startAgentSession = createStartAgentSession({
    repo: {
      activeRepo,
      repoEpochRef,
      previousRepoRef,
    },
    session: {
      setSessionsById,
      sessionsRef,
      inFlightStartsByRepoTaskRef,
      loadAgentSessions,
      persistSessionSnapshot,
      attachSessionListener,
    },
    runtime: {
      adapter,
      ensureRuntime,
    },
    task: {
      taskRef,
      loadTaskDocuments,
      refreshTaskData,
      sendAgentMessage,
    },
    model: {
      loadRepoDefaultModel,
      loadRepoPromptOverrides,
      loadSessionTodos,
      loadSessionModelCatalog,
    },
  });

  const stopAgentSession = async (sessionId: string): Promise<void> => {
    const session = sessionsRef.current[sessionId];
    if (!session) {
      return;
    }

    const unsubscribe = unsubscribersRef.current.get(sessionId);
    unsubscribe?.();
    unsubscribersRef.current.delete(sessionId);

    try {
      if (adapter.hasSession(sessionId)) {
        await adapter.stopSession(sessionId);
      }
    } catch {
    } finally {
      clearTurnDuration(sessionId);

      updateSession(sessionId, (current) => ({
        ...current,
        status: "stopped",
        draftAssistantText: "",
        pendingPermissions: [],
        pendingQuestions: [],
      }));
    }
  };

  const updateAgentSessionModel = (
    sessionId: string,
    selection: AgentModelSelection | null,
  ): void => {
    updateSession(sessionId, (current) => ({
      ...current,
      selectedModel: selection,
    }));
  };

  const replyAgentPermission = async (
    sessionId: string,
    requestId: string,
    reply: "once" | "always" | "reject",
    message?: string,
  ): Promise<void> => {
    markTurnStartedIfMissing(turnStartedAtBySessionRef, sessionId);
    await adapter.replyPermission({
      sessionId,
      requestId,
      reply,
      ...(message ? { message } : {}),
    });

    updateSession(sessionId, (current) => ({
      ...current,
      pendingPermissions: current.pendingPermissions.filter(
        (entry) => entry.requestId !== requestId,
      ),
    }));
  };

  const answerAgentQuestion = async (
    sessionId: string,
    requestId: string,
    answers: string[][],
  ): Promise<void> => {
    markTurnStartedIfMissing(turnStartedAtBySessionRef, sessionId);
    await adapter.replyQuestion({ sessionId, requestId, answers });
    updateSession(sessionId, (current) => {
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
    });
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
