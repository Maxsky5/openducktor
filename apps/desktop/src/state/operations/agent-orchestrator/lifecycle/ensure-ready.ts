import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { requireActiveRepo } from "../../tasks/task-operations-model";
import {
  type RuntimeInfo,
  resolveRuntimeConnection,
  runtimeRouteToConnection,
} from "../runtime/runtime";
import { runOrchestratorTask } from "../support/async-side-effects";
import {
  createRepoStaleGuard,
  shouldReattachListenerForAttachedSession,
  throwIfRepoStale,
} from "../support/core";
import { loadSessionPromptContext } from "../support/session-prompt";

type EnsureSessionReadyDependencies = {
  activeRepo: string | null;
  adapter: AgentEnginePort;
  repoEpochRef: { current: number };
  activeRepoRef?: { current: string | null };
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
      targetWorkingDirectory?: string | null;
      runtimeKind?: AgentSessionState["selectedModel"] extends infer T
        ? T extends { runtimeKind?: infer K }
          ? K | null
          : never
        : never;
    },
  ) => Promise<RuntimeInfo>;
  loadRepoPromptOverrides: (repoPath: string) => Promise<RepoPromptOverrides>;
};

const STALE_PREPARE_ERROR = "Workspace changed while preparing session.";
const PENDING_INPUT_NOT_READY_ERROR = "Session is waiting for pending runtime input.";

const toLiveSessionState = (
  status: Awaited<ReturnType<AgentEnginePort["listLiveAgentSessionSnapshots"]>>[number]["status"],
): AgentSessionState["status"] => {
  if (status.type === "busy" || status.type === "retry") {
    return "running";
  }
  return "idle";
};

const hasPendingInput = (
  session: Pick<AgentSessionState, "pendingPermissions" | "pendingQuestions">,
) => {
  return session.pendingPermissions.length > 0 || session.pendingQuestions.length > 0;
};

export const createEnsureSessionReady = ({
  activeRepo,
  adapter,
  repoEpochRef,
  activeRepoRef,
  previousRepoRef,
  sessionsRef,
  taskRef,
  unsubscribersRef,
  updateSession,
  attachSessionListener,
  ensureRuntime,
  loadRepoPromptOverrides,
}: EnsureSessionReadyDependencies) => {
  return async (
    sessionId: string,
    options?: {
      allowPendingInput?: boolean;
    },
  ): Promise<void> => {
    const allowPendingInput = options?.allowPendingInput === true;
    const repoPath = requireActiveRepo(activeRepo);
    const isStaleRepoOperation = createRepoStaleGuard({
      repoPath,
      repoEpochRef,
      activeRepoRef,
      previousRepoRef,
    });
    const assertNotStale = (): void => {
      throwIfRepoStale(isStaleRepoOperation, STALE_PREPARE_ERROR);
    };
    const stopSessionOrThrow = async ({
      operation,
      cleanupErrorMessage,
      sessionId: targetSessionId,
      taskId,
      role,
    }: {
      operation: string;
      cleanupErrorMessage: string;
      sessionId: string;
      taskId: string;
      role: AgentSessionState["role"];
    }): Promise<void> => {
      try {
        await runOrchestratorTask(operation, async () => adapter.stopSession(targetSessionId), {
          tags: { repoPath, sessionId: targetSessionId, taskId, role },
        });
      } catch (error) {
        throw new Error(`${cleanupErrorMessage}: ${errorMessage(error)}`, { cause: error });
      }
    };

    const loadLiveSnapshot = async ({
      runtimeKind,
      runtimeConnection,
      workingDirectory,
      externalSessionId,
    }: {
      runtimeKind: AgentSessionState["runtimeKind"];
      runtimeConnection: import("@openducktor/core").AgentRuntimeConnection | null;
      workingDirectory: string;
      externalSessionId: string;
    }) => {
      if (!runtimeKind || runtimeConnection === null || workingDirectory.trim().length === 0) {
        return null;
      }
      const snapshots = await adapter.listLiveAgentSessionSnapshots({
        runtimeKind,
        runtimeConnection,
        directories: [workingDirectory],
      });
      return snapshots.find((entry) => entry.externalSessionId === externalSessionId) ?? null;
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
        let attachedRuntimeKind = session.runtimeKind;
        let attachedRuntimeId = session.runtimeId;
        let attachedRunId = session.runId;
        let attachedRuntimeRoute = session.runtimeRoute;
        let attachedWorkingDirectory = session.workingDirectory;

        if (!attachedRuntimeKind || attachedRuntimeRoute === null) {
          const runtime = await ensureRuntime(repoPath, session.taskId, session.role, {
            targetWorkingDirectory: session.workingDirectory,
            ...(session.selectedModel?.runtimeKind
              ? { runtimeKind: session.selectedModel.runtimeKind }
              : {}),
          });
          assertNotStale();

          attachedRuntimeKind =
            runtime.runtimeKind ??
            session.selectedModel?.runtimeKind ??
            session.runtimeKind ??
            DEFAULT_RUNTIME_KIND;
          attachedRuntimeId = runtime.runtimeId;
          attachedRunId = runtime.runId;
          attachedRuntimeRoute = runtime.runtimeRoute;
          attachedWorkingDirectory = runtime.workingDirectory;

          updateSession(
            sessionId,
            (current) => ({
              ...current,
              runtimeId: attachedRuntimeId,
              runId: attachedRunId,
              runtimeRoute: attachedRuntimeRoute,
              workingDirectory: attachedWorkingDirectory,
              ...(attachedRuntimeKind ? { runtimeKind: attachedRuntimeKind } : {}),
            }),
            { persist: false },
          );
        }

        const liveSnapshot = await loadLiveSnapshot({
          runtimeKind: attachedRuntimeKind,
          runtimeConnection:
            attachedRuntimeRoute === null
              ? null
              : runtimeRouteToConnection(attachedRuntimeRoute, attachedWorkingDirectory),
          workingDirectory: attachedWorkingDirectory,
          externalSessionId: session.externalSessionId,
        });
        assertNotStale();
        const pendingPermissions = liveSnapshot?.pendingPermissions ?? [];
        const pendingQuestions = liveSnapshot?.pendingQuestions ?? [];
        updateSession(
          sessionId,
          (current) => ({
            ...current,
            status: liveSnapshot ? toLiveSessionState(liveSnapshot.status) : current.status,
            runtimeId: attachedRuntimeId,
            runId: attachedRunId,
            runtimeRoute: attachedRuntimeRoute,
            workingDirectory: attachedWorkingDirectory,
            pendingPermissions,
            pendingQuestions,
            ...(attachedRuntimeKind ? { runtimeKind: attachedRuntimeKind } : {}),
          }),
          { persist: false },
        );
        if (!allowPendingInput && hasPendingInput({ pendingPermissions, pendingQuestions })) {
          throw new Error(PENDING_INPUT_NOT_READY_ERROR);
        }
        return;
      }
      const existingUnsubscriber = unsubscribersRef.current.get(sessionId);
      await stopSessionOrThrow({
        operation: "ensure-ready-stop-attached-error-session",
        cleanupErrorMessage: `Failed to stop attached error session '${sessionId}' before preparing it`,
        sessionId,
        taskId: session.taskId,
        role: session.role,
      });
      if (existingUnsubscriber) {
        existingUnsubscriber();
        unsubscribersRef.current.delete(sessionId);
      }
      assertNotStale();
    }

    const task = taskRef.current.find((entry) => entry.id === session.taskId);
    if (!task) {
      throw new Error(`Task not found: ${session.taskId}`);
    }

    const promptContext = await loadSessionPromptContext({
      repoPath,
      role: session.role,
      scenario: session.scenario,
      task,
      loadRepoPromptOverrides,
    });
    assertNotStale();
    const runtime = await ensureRuntime(repoPath, session.taskId, session.role, {
      targetWorkingDirectory: session.workingDirectory,
      ...(session.selectedModel?.runtimeKind
        ? { runtimeKind: session.selectedModel.runtimeKind }
        : {}),
    });
    assertNotStale();
    const resolvedRuntimeKind =
      runtime.runtimeKind ??
      session.selectedModel?.runtimeKind ??
      session.runtimeKind ??
      DEFAULT_RUNTIME_KIND;
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
      systemPrompt: promptContext.systemPrompt,
      ...(session.selectedModel ? { model: session.selectedModel } : {}),
    });

    if (isStaleRepoOperation()) {
      await stopSessionOrThrow({
        operation: "ensure-ready-stop-session-after-stale-resume",
        cleanupErrorMessage: `${STALE_PREPARE_ERROR} Failed to stop stale resumed session '${sessionId}'`,
        sessionId,
        taskId: session.taskId,
        role: session.role,
      });
      throw new Error(STALE_PREPARE_ERROR);
    }

    if (!unsubscribersRef.current.has(sessionId)) {
      attachSessionListener(repoPath, sessionId);
    }

    assertNotStale();

    const liveSnapshot = await loadLiveSnapshot({
      runtimeKind: resolvedRuntimeKind,
      runtimeConnection: resolveRuntimeConnection(runtime),
      workingDirectory: runtime.workingDirectory,
      externalSessionId: session.externalSessionId,
    });
    assertNotStale();
    const pendingPermissions = liveSnapshot?.pendingPermissions ?? [];
    const pendingQuestions = liveSnapshot?.pendingQuestions ?? [];

    updateSession(sessionId, (current) => ({
      ...current,
      status: liveSnapshot ? toLiveSessionState(liveSnapshot.status) : "idle",
      runtimeKind: resolvedRuntimeKind,
      runtimeId: runtime.runtimeId,
      runId: runtime.runId,
      runtimeRoute: runtime.runtimeRoute,
      workingDirectory: runtime.workingDirectory,
      promptOverrides: promptContext.promptOverrides,
      pendingPermissions,
      pendingQuestions,
    }));

    if (!allowPendingInput && hasPendingInput({ pendingPermissions, pendingQuestions })) {
      throw new Error(PENDING_INPUT_NOT_READY_ERROR);
    }

    if (isStaleRepoOperation()) {
      return;
    }
  };
};
