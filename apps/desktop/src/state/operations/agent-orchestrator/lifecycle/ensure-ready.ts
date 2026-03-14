import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import {
  type AgentEnginePort,
  type AgentRuntimeConnection,
  buildAgentSystemPrompt,
} from "@openducktor/core";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { requireActiveRepo } from "../../task-operations-model";
import { type RuntimeInfo, resolveRuntimeConnection, type TaskDocuments } from "../runtime/runtime";
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
      runtimeKind?: AgentSessionState["selectedModel"] extends infer T
        ? T extends { runtimeKind?: infer K }
          ? K | null
          : never
        : never;
    },
  ) => Promise<RuntimeInfo>;
  loadTaskDocuments: (repoPath: string, taskId: string) => Promise<TaskDocuments>;
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
        ...(session.selectedModel?.runtimeKind
          ? { runtimeKind: session.selectedModel.runtimeKind }
          : {}),
      }),
      loadRepoPromptOverrides(repoPath),
    ]);
    assertNotStale();
    const resolvedRuntimeKind =
      runtime.runtimeKind ??
      session.selectedModel?.runtimeKind ??
      session.runtimeKind ??
      DEFAULT_RUNTIME_KIND;
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
      runtimeKind: resolvedRuntimeKind,
      runtimeConnection: resolveRuntimeConnection(runtime),
      workingDirectory: runtime.workingDirectory,
      taskId: session.taskId,
      role: session.role,
      scenario: session.scenario,
      systemPrompt,
      ...(session.selectedModel ? { model: session.selectedModel } : {}),
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
      runtimeKind: resolvedRuntimeKind,
      runtimeId: runtime.runtimeId,
      runId: runtime.runId,
      runtimeEndpoint: runtime.runtimeEndpoint,
      workingDirectory: runtime.workingDirectory,
      promptOverrides,
    }));

    if (isStaleRepoOperation()) {
      return;
    }

    const activeSession = sessionsRef.current[sessionId];
    const runtimeConnection = resolveRuntimeConnection(runtime);
    const warmSessionData = (targetSession: AgentSessionState): void => {
      const targetRuntimeKind =
        targetSession.runtimeKind ?? targetSession.selectedModel?.runtimeKind;
      if (!targetRuntimeKind) {
        throw new Error(`Runtime kind is required to warm session '${sessionId}'.`);
      }
      runOrchestratorSideEffect(
        "ensure-ready-warm-session-todos",
        loadSessionTodos(
          sessionId,
          targetRuntimeKind,
          runtimeConnection,
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
          loadSessionModelCatalog(sessionId, targetRuntimeKind, runtimeConnection),
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
