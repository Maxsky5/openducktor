import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentModelSelection,
  AgentRole,
  AgentRuntimeConnection,
} from "@openducktor/core";
import { buildAgentSystemPrompt } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import { isRoleAvailableForTask, unavailableRoleErrorMessage } from "@/lib/task-agent-workflows";
import type { AgentSessionLoadOptions, AgentSessionState } from "@/types/agent-orchestrator";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
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
  resolveQaReviewTarget?: (repoPath: string, taskId: string) => Promise<string>;
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

export type ForkAgentSessionActionInput = {
  parentSessionId: string;
  selectedModel?: AgentModelSelection | null;
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
  resolveQaReviewTarget,
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
      resolveQaReviewTarget:
        resolveQaReviewTarget ??
        (async () => {
          throw new Error("QA review target resolution is unavailable.");
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
      loadRepoDefaultModel,
      loadRepoPromptOverrides,
      loadSessionTodos,
      loadSessionModelCatalog,
    },
  });

  const forkAgentSession = async ({
    parentSessionId,
    selectedModel,
  }: ForkAgentSessionActionInput): Promise<string> => {
    if (!activeRepo) {
      throw new Error("No active repository selected.");
    }

    const parentSession = sessionsRef.current[parentSessionId];
    if (!parentSession) {
      throw new Error(`Unknown session: ${parentSessionId}`);
    }

    const task = taskRef.current.find((entry) => entry.id === parentSession.taskId);
    if (!task) {
      throw new Error(`Task not found: ${parentSession.taskId}`);
    }
    if (!isRoleAvailableForTask(task, parentSession.role)) {
      throw new Error(unavailableRoleErrorMessage(task, parentSession.role));
    }

    const [docs, promptOverrides] = await Promise.all([
      loadTaskDocuments(activeRepo, parentSession.taskId),
      loadRepoPromptOverrides(activeRepo),
    ]);
    const modelSelection =
      selectedModel ?? parentSession.selectedModel ?? (await loadRepoDefaultModel(activeRepo, parentSession.role));
    const systemPrompt = buildAgentSystemPrompt({
      role: parentSession.role,
      scenario: parentSession.scenario,
      task: {
        taskId: task.id,
        title: task.title,
        issueType: task.issueType,
        status: task.status,
        qaRequired: task.aiReviewEnabled,
        description: task.description,
        acceptanceCriteria: task.acceptanceCriteria,
        specMarkdown: docs.specMarkdown,
        planMarkdown: docs.planMarkdown,
        latestQaReportMarkdown: docs.qaMarkdown,
      },
      overrides: promptOverrides,
    });

    const summary = await adapter.forkSession({
      repoPath: activeRepo,
      runtimeKind: (parentSession.runtimeKind ?? modelSelection?.runtimeKind ?? DEFAULT_RUNTIME_KIND) as string,
      runtimeConnection: {
        endpoint: parentSession.runtimeEndpoint,
        workingDirectory: parentSession.workingDirectory,
      },
      workingDirectory: parentSession.workingDirectory,
      taskId: parentSession.taskId,
      role: parentSession.role,
      scenario: parentSession.scenario,
      systemPrompt,
      ...(parentSession.runtimeId ? { runtimeId: parentSession.runtimeId } : {}),
      ...(modelSelection ? { model: modelSelection } : {}),
      parentExternalSessionId: parentSession.externalSessionId,
    });

    const nextSession: AgentSessionState = {
      sessionId: summary.sessionId,
      externalSessionId: summary.externalSessionId,
      taskId: parentSession.taskId,
      runtimeKind:
        parentSession.runtimeKind ?? modelSelection?.runtimeKind ?? DEFAULT_RUNTIME_KIND,
      role: parentSession.role,
      scenario: parentSession.scenario,
      status: "idle",
      startedAt: summary.startedAt,
      runtimeId: parentSession.runtimeId,
      runId: parentSession.runId,
      runtimeEndpoint: parentSession.runtimeEndpoint,
      workingDirectory: parentSession.workingDirectory,
      messages: [
        {
          id: crypto.randomUUID(),
          role: "system",
          content: `Session forked (${parentSession.role} - ${parentSession.scenario})`,
          timestamp: summary.startedAt,
        },
        {
          id: crypto.randomUUID(),
          role: "system",
          content: `System prompt:\n\n${systemPrompt}`,
          timestamp: summary.startedAt,
        },
      ],
      draftAssistantText: "",
      pendingPermissions: [],
      pendingQuestions: [],
      todos: [],
      modelCatalog: null,
      selectedModel: modelSelection ?? null,
      isLoadingModelCatalog: true,
      promptOverrides,
    };

    setSessionsById((current) => ({
      ...current,
      [summary.sessionId]: nextSession,
    }));
    attachSessionListener(activeRepo, summary.sessionId);
    void persistSessionSnapshot(nextSession);
    void loadSessionModelCatalog(
      summary.sessionId,
      nextSession.runtimeKind ?? DEFAULT_RUNTIME_KIND,
      {
        endpoint: nextSession.runtimeEndpoint,
        workingDirectory: nextSession.workingDirectory,
      },
    );
    void loadSessionTodos(
      summary.sessionId,
      nextSession.runtimeKind ?? DEFAULT_RUNTIME_KIND,
      {
        endpoint: nextSession.runtimeEndpoint,
        workingDirectory: nextSession.workingDirectory,
      },
      summary.externalSessionId,
    );
    return summary.sessionId;
  };

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
    forkAgentSession,
    stopAgentSession,
    updateAgentSessionModel,
    replyAgentPermission,
    answerAgentQuestion,
  };
};
