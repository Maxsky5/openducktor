import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import { requireActiveRepo } from "../../tasks/task-operations-model";
import {
  type RuntimeInfo,
  requireRuntimeConnectionSupport,
  resolveRuntimeConnection,
  runtimeRouteToConnection,
} from "../runtime/runtime";
import { runOrchestratorTask } from "../support/async-side-effects";
import { shouldReattachListenerForAttachedSession, throwIfRepoStale } from "../support/core";
import { loadSessionPromptContext } from "../support/session-prompt";
import {
  assertSessionRuntimeKindMatchesEnsuredRuntime,
  requireSessionRuntimeKind,
} from "../support/session-runtime-metadata";

type EnsureSessionReadyDependencies = {
  activeWorkspace: ActiveWorkspace | null;
  adapter: AgentEnginePort;
  repoEpochRef: { current: number };
  activeWorkspaceRef?: { current: ActiveWorkspace | null };
  currentWorkspaceRepoPathRef: { current: string | null };
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
      workspaceId?: string | null;
      targetWorkingDirectory?: string | null;
      runtimeKind?: AgentSessionState["selectedModel"] extends infer T
        ? T extends { runtimeKind?: infer K }
          ? K | null
          : never
        : never;
    },
  ) => Promise<RuntimeInfo>;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
};

const STALE_PREPARE_ERROR = "Workspace changed while preparing session.";
const PENDING_INPUT_NOT_READY_ERROR = "Session is waiting for pending runtime input.";
const normalizeLiveSessionTitle = (title: string | undefined): string | undefined => {
  const trimmed = title?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

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
  activeWorkspace,
  adapter,
  repoEpochRef,
  activeWorkspaceRef,
  currentWorkspaceRepoPathRef,
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
    const repoPath = requireActiveRepo(activeWorkspace?.repoPath ?? null);
    const workspaceId = activeWorkspace?.workspaceId;
    if (!workspaceId) {
      throw new Error("Active workspace is required.");
    }
    const repoEpochAtStart = repoEpochRef.current;
    const isStaleRepoOperation = (): boolean => {
      const currentRepoPath =
        currentWorkspaceRepoPathRef.current ?? activeWorkspaceRef?.current?.repoPath ?? null;
      return repoEpochRef.current !== repoEpochAtStart || currentRepoPath !== repoPath;
    };
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
        let attachedRuntimeKind: NonNullable<AgentSessionState["runtimeKind"]> =
          session.runtimeKind ?? requireSessionRuntimeKind(session);
        let attachedRuntimeId = session.runtimeId;
        let attachedRuntimeRoute = session.runtimeRoute;
        let attachedWorkingDirectory = session.workingDirectory;

        if (!attachedRuntimeKind || attachedRuntimeRoute === null) {
          const requestedRuntimeKind = requireSessionRuntimeKind(session);
          const runtime = await ensureRuntime(repoPath, session.taskId, session.role, {
            workspaceId,
            targetWorkingDirectory: session.workingDirectory,
            runtimeKind: requestedRuntimeKind,
          });
          assertNotStale();
          attachedRuntimeKind = assertSessionRuntimeKindMatchesEnsuredRuntime({
            sessionId: session.sessionId,
            requestedRuntimeKind,
            ensuredRuntimeKind: runtime.runtimeKind,
          });

          attachedRuntimeId = runtime.runtimeId;
          attachedRuntimeRoute = runtime.runtimeRoute;
          attachedWorkingDirectory = runtime.workingDirectory;

          updateSession(
            sessionId,
            (current) => ({
              ...current,
              runtimeId: attachedRuntimeId,
              runtimeRoute: attachedRuntimeRoute,
              workingDirectory: attachedWorkingDirectory,
              runtimeKind: attachedRuntimeKind,
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
        const liveSessionTitle = normalizeLiveSessionTitle(liveSnapshot?.title);
        updateSession(
          sessionId,
          (current) => ({
            ...current,
            status: liveSnapshot ? toLiveSessionState(liveSnapshot.status) : current.status,
            runtimeId: attachedRuntimeId,
            runtimeRoute: attachedRuntimeRoute,
            workingDirectory: attachedWorkingDirectory,
            ...(liveSessionTitle ? { title: liveSessionTitle } : {}),
            pendingPermissions,
            pendingQuestions,
            runtimeKind: attachedRuntimeKind,
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
      workspaceId,
      role: session.role,
      scenario: session.scenario,
      task,
      loadRepoPromptOverrides,
    });
    assertNotStale();
    const requestedRuntimeKind = requireSessionRuntimeKind(session);
    const runtime = await ensureRuntime(repoPath, session.taskId, session.role, {
      workspaceId,
      targetWorkingDirectory: session.workingDirectory,
      runtimeKind: requestedRuntimeKind,
    });
    assertNotStale();
    const resolvedRuntimeKind = assertSessionRuntimeKindMatchesEnsuredRuntime({
      sessionId: session.sessionId,
      requestedRuntimeKind,
      ensuredRuntimeKind: runtime.runtimeKind,
    });
    const runtimeConnection = requireRuntimeConnectionSupport(
      resolvedRuntimeKind,
      resolveRuntimeConnection(runtime),
      "resume session",
    );
    await adapter.resumeSession({
      sessionId: session.sessionId,
      externalSessionId: session.externalSessionId,
      repoPath,
      runtimeKind: resolvedRuntimeKind,
      runtimeConnection,
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
      runtimeConnection,
      workingDirectory: runtime.workingDirectory,
      externalSessionId: session.externalSessionId,
    });
    assertNotStale();
    const pendingPermissions = liveSnapshot?.pendingPermissions ?? [];
    const pendingQuestions = liveSnapshot?.pendingQuestions ?? [];
    const liveSessionTitle = normalizeLiveSessionTitle(liveSnapshot?.title);

    updateSession(sessionId, (current) => ({
      ...current,
      status: liveSnapshot ? toLiveSessionState(liveSnapshot.status) : "idle",
      runtimeKind: resolvedRuntimeKind,
      runtimeId: runtime.runtimeId,
      runtimeRoute: runtime.runtimeRoute,
      workingDirectory: runtime.workingDirectory,
      ...(liveSessionTitle ? { title: liveSessionTitle } : {}),
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
