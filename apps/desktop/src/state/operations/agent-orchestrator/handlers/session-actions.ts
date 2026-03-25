import type { AgentSessionRecord, RepoPromptOverrides, RuntimeKind, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort, AgentModelSelection, AgentRole } from "@openducktor/core";
import { isAgentSessionWaitingInput } from "@/lib/agent-session-waiting-input";
import { errorMessage } from "@/lib/errors";
import { isRoleAvailableForTask, unavailableRoleErrorMessage } from "@/lib/task-agent-workflows";
import type { AgentSessionLoadOptions, AgentSessionState } from "@/types/agent-orchestrator";
import { createEnsureSessionReady } from "../lifecycle/ensure-ready";
import type { RuntimeInfo, TaskDocuments } from "../runtime/runtime";
import { createRepoStaleGuard, now, throwIfRepoStale } from "../support/core";
import { toPersistedSessionRecord } from "../support/persistence";
import { annotateQuestionToolMessage } from "../support/question-messages";
import { buildSessionPreludeMessages, loadSessionPromptContext } from "../support/session-prompt";
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
  resolveBuildContinuationTarget?: (repoPath: string, taskId: string) => Promise<string>;
  ensureRuntime: (repoPath: string, taskId: string, role: AgentRole) => Promise<RuntimeInfo>;
  loadTaskDocuments: (repoPath: string, taskId: string) => Promise<TaskDocuments>;
  loadRepoDefaultModel: (repoPath: string, role: AgentRole) => Promise<AgentModelSelection | null>;
  loadRepoPromptOverrides: (repoPath: string) => Promise<RepoPromptOverrides>;
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;
  clearTurnDuration: (sessionId: string) => void;
  refreshTaskData: (repoPath: string) => Promise<void>;
  persistSessionRecord: (taskId: string, record: AgentSessionRecord) => Promise<void>;
  stopBuildRun?: (runId: string) => Promise<void>;
  invalidateSessionStopQueries?: (input: {
    repoPath: string;
    taskId: string;
    runtimeKind?: RuntimeKind;
  }) => Promise<void>;
};

export type ForkAgentSessionActionInput = {
  parentSessionId: string;
  selectedModel?: AgentModelSelection | null;
};

const STALE_FORK_ERROR = "Workspace changed while forking session.";

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
  loadRepoDefaultModel,
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
    loadTaskDocuments,
    loadRepoPromptOverrides,
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
      if (isAgentSessionWaitingInput(currentSession)) {
        return;
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
      }),
      { persist: false },
    );

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
          draftAssistantMessageId: null,
          draftReasoningText: "",
          draftReasoningMessageId: null,
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
      if (turnModelBySessionRef) {
        delete turnModelBySessionRef.current[sessionId];
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

  const forkAgentSession = async ({
    parentSessionId,
    selectedModel,
  }: ForkAgentSessionActionInput): Promise<string> => {
    if (!activeRepo) {
      throw new Error("No active repository selected.");
    }
    const repoPath = activeRepo;
    const isStaleRepoOperation = createRepoStaleGuard({
      repoPath,
      repoEpochRef,
      activeRepoRef,
      previousRepoRef,
    });
    throwIfRepoStale(isStaleRepoOperation, STALE_FORK_ERROR);

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

    const promptContext = await loadSessionPromptContext({
      repoPath,
      taskId: parentSession.taskId,
      role: parentSession.role,
      scenario: parentSession.scenario,
      task,
      loadTaskDocuments,
      loadRepoPromptOverrides,
    });
    throwIfRepoStale(isStaleRepoOperation, STALE_FORK_ERROR);
    const modelSelection =
      selectedModel ??
      parentSession.selectedModel ??
      (await loadRepoDefaultModel(repoPath, parentSession.role));
    throwIfRepoStale(isStaleRepoOperation, STALE_FORK_ERROR);
    const runtimeKind = parentSession.runtimeKind ?? modelSelection?.runtimeKind;
    if (!runtimeKind) {
      throw new Error(`Runtime kind is required to fork session '${parentSessionId}'.`);
    }
    const { promptOverrides, systemPrompt } = promptContext;
    const summary = await adapter.forkSession({
      repoPath,
      runtimeKind,
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
    throwIfRepoStale(isStaleRepoOperation, STALE_FORK_ERROR);

    const nextSession: AgentSessionState = {
      sessionId: summary.sessionId,
      externalSessionId: summary.externalSessionId,
      taskId: parentSession.taskId,
      runtimeKind,
      role: parentSession.role,
      scenario: parentSession.scenario,
      status: "idle",
      startedAt: summary.startedAt,
      runtimeId: parentSession.runtimeId,
      runId: parentSession.runId,
      runtimeEndpoint: parentSession.runtimeEndpoint,
      workingDirectory: parentSession.workingDirectory,
      messages: buildSessionPreludeMessages({
        sessionId: summary.sessionId,
        role: parentSession.role,
        scenario: parentSession.scenario,
        systemPrompt,
        startedAt: summary.startedAt,
        eventLabel: "forked",
      }),
      draftAssistantText: "",
      draftAssistantMessageId: null,
      draftReasoningText: "",
      draftReasoningMessageId: null,
      pendingPermissions: [],
      pendingQuestions: [],
      todos: [],
      modelCatalog: null,
      selectedModel: modelSelection ?? null,
      isLoadingModelCatalog: true,
      promptOverrides,
    };

    throwIfRepoStale(isStaleRepoOperation, STALE_FORK_ERROR);
    setSessionsById((current) => ({
      ...current,
      [summary.sessionId]: nextSession,
    }));
    attachSessionListener(repoPath, summary.sessionId);
    void persistSessionRecord(nextSession.taskId, toPersistedSessionRecord(nextSession));
    return summary.sessionId;
  };

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
    forkAgentSession,
    stopAgentSession,
    updateAgentSessionModel,
    replyAgentPermission,
    answerAgentQuestion,
  };
};
