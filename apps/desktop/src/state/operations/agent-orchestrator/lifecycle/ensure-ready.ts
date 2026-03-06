import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import { type AgentEnginePort, buildAgentSystemPrompt } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { requireActiveRepo } from "../../task-operations-model";
import type { RuntimeInfo, TaskDocuments } from "../runtime/runtime";
import {
  captureOrchestratorFallback,
  runOrchestratorSideEffect,
} from "../support/async-side-effects";
import {
  createRepoStaleGuard,
  shouldReattachListenerForAttachedSession,
  throwIfRepoStale,
} from "../support/utils";

type EnsureSessionReadyDependencies = {
  activeRepo: string | null;
  adapter: AgentEnginePort;
  repoEpochRef: { current: number };
  previousRepoRef: { current: string | null };
  sessionsRef: { current: Record<string, AgentSessionState> };
  taskRef: { current: TaskCard[] };
  unsubscribersRef: { current: Map<string, () => void> };
  updateSession: (
    sessionId: string,
    updater: (current: AgentSessionState) => AgentSessionState,
    options?: { persist?: boolean },
  ) => void;
  attachSessionListener: (repoPath: string, sessionId: string) => void;
  ensureRuntime: (
    repoPath: string,
    taskId: string,
    role: AgentSessionState["role"],
    options?: {
      workingDirectoryOverride?: string | null;
    },
  ) => Promise<RuntimeInfo>;
  loadTaskDocuments: (repoPath: string, taskId: string) => Promise<TaskDocuments>;
  loadRepoPromptOverrides: (repoPath: string) => Promise<RepoPromptOverrides>;
  loadSessionTodos: (
    sessionId: string,
    baseUrl: string,
    workingDirectory: string,
    externalSessionId: string,
  ) => Promise<void>;
  loadSessionModelCatalog: (
    sessionId: string,
    baseUrl: string,
    workingDirectory: string,
  ) => Promise<void>;
};

const STALE_PREPARE_ERROR = "Workspace changed while preparing session.";

export const createEnsureSessionReady = ({
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
}: EnsureSessionReadyDependencies) => {
  return async (sessionId: string): Promise<void> => {
    const repoPath = requireActiveRepo(activeRepo);
    const isStaleRepoOperation = createRepoStaleGuard({
      repoPath,
      repoEpochRef,
      previousRepoRef,
    });
    const assertNotStale = (): void => {
      throwIfRepoStale(isStaleRepoOperation, STALE_PREPARE_ERROR);
    };

    assertNotStale();
    const session = sessionsRef.current[sessionId];
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (adapter.hasSession(sessionId)) {
      if (
        shouldReattachListenerForAttachedSession(
          session.status,
          unsubscribersRef.current.has(sessionId),
        )
      ) {
        attachSessionListener(repoPath, sessionId);
      }
      if (session.status !== "error") {
        return;
      }
      const existingUnsubscriber = unsubscribersRef.current.get(sessionId);
      if (existingUnsubscriber) {
        existingUnsubscriber();
        unsubscribersRef.current.delete(sessionId);
      }
      await captureOrchestratorFallback(
        "ensure-ready-stop-attached-error-session",
        async () => adapter.stopSession(sessionId),
        {
          tags: { repoPath, sessionId, taskId: session.taskId, role: session.role },
          fallback: () => undefined,
        },
      );
      assertNotStale();
    }

    const task = taskRef.current.find((entry) => entry.id === session.taskId);
    if (!task) {
      throw new Error(`Task not found: ${session.taskId}`);
    }

    const [docs, runtime, promptOverrides] = await Promise.all([
      loadTaskDocuments(repoPath, session.taskId),
      ensureRuntime(repoPath, session.taskId, session.role, {
        workingDirectoryOverride: session.workingDirectory,
      }),
      loadRepoPromptOverrides(repoPath),
    ]);
    assertNotStale();
    const systemPrompt = buildAgentSystemPrompt({
      role: session.role,
      scenario: session.scenario,
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

    await adapter.resumeSession({
      sessionId: session.sessionId,
      externalSessionId: session.externalSessionId,
      repoPath,
      workingDirectory: runtime.workingDirectory,
      taskId: session.taskId,
      role: session.role,
      scenario: session.scenario,
      systemPrompt,
      baseUrl: runtime.baseUrl,
    });

    if (isStaleRepoOperation()) {
      await captureOrchestratorFallback(
        "ensure-ready-stop-session-after-stale-resume",
        async () => adapter.stopSession(sessionId),
        {
          tags: { repoPath, sessionId, taskId: session.taskId, role: session.role },
          fallback: () => undefined,
        },
      );
      throw new Error(STALE_PREPARE_ERROR);
    }

    if (!unsubscribersRef.current.has(sessionId)) {
      attachSessionListener(repoPath, sessionId);
    }

    assertNotStale();

    updateSession(sessionId, (current) => ({
      ...current,
      status: "idle",
      pendingPermissions: [],
      pendingQuestions: [],
      runtimeId: runtime.runtimeId,
      runId: runtime.runId,
      baseUrl: runtime.baseUrl,
      workingDirectory: runtime.workingDirectory,
      promptOverrides,
    }));

    if (isStaleRepoOperation()) {
      return;
    }

    const activeSession = sessionsRef.current[sessionId];
    const warmSessionData = (targetSession: AgentSessionState): void => {
      runOrchestratorSideEffect(
        "ensure-ready-warm-session-todos",
        loadSessionTodos(
          sessionId,
          runtime.baseUrl,
          runtime.workingDirectory,
          targetSession.externalSessionId,
        ),
        {
          tags: {
            repoPath,
            sessionId,
            taskId: targetSession.taskId,
            role: targetSession.role,
            externalSessionId: targetSession.externalSessionId,
          },
        },
      );
      if (!targetSession.modelCatalog && !targetSession.isLoadingModelCatalog) {
        runOrchestratorSideEffect(
          "ensure-ready-warm-session-model-catalog",
          loadSessionModelCatalog(sessionId, runtime.baseUrl, runtime.workingDirectory),
          {
            tags: {
              repoPath,
              sessionId,
              taskId: targetSession.taskId,
              role: targetSession.role,
            },
          },
        );
      }
    };
    if (activeSession) {
      warmSessionData(activeSession);
    }
  };
};
