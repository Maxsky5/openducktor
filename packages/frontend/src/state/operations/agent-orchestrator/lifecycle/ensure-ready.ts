import type { RepoPromptOverrides, RuntimeKind, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort, AgentRole } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import { requireActiveRepo } from "../../tasks/task-operations-model";
import {
  type RuntimeInfo,
  resolveRuntimeConnection,
  runtimeRouteToConnection,
} from "../runtime/runtime";
import { runOrchestratorTask } from "../support/async-side-effects";
import { shouldReattachListenerForAttachedSession, throwIfRepoStale } from "../support/core";
import { loadSessionPromptContext } from "../support/session-prompt";
import { isWorkflowAgentSession } from "../support/session-purpose";
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
    externalSessionId: string,
    updater: (current: AgentSessionState) => AgentSessionState,
    options?: { persist?: boolean },
  ) => void;
  attachSessionListener: (repoPath: string, externalSessionId: string) => void;
  ensureRuntime: (
    repoPath: string,
    taskId: string,
    role: AgentRole,
    options?: {
      workspaceId?: string | null;
      targetWorkingDirectory?: string | null;
      runtimeKind?: RuntimeKind | null;
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
    externalSessionId: string,
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
      externalSessionId: targetExternalSessionId,
      taskId,
      role,
    }: {
      operation: string;
      cleanupErrorMessage: string;
      externalSessionId: string;
      taskId: string;
      role: AgentSessionState["role"];
    }): Promise<void> => {
      try {
        await runOrchestratorTask(
          operation,
          async () => adapter.stopSession(targetExternalSessionId),
          {
            tags: { repoPath, externalSessionId: targetExternalSessionId, taskId, role },
          },
        );
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
    const session = sessionsRef.current[externalSessionId];
    if (!session) {
      throw new Error(`Session not found: ${externalSessionId}`);
    }
    if (!isWorkflowAgentSession(session)) {
      throw new Error(`Session '${externalSessionId}' is not a workflow session.`);
    }

    if (adapter.hasSession(externalSessionId)) {
      if (
        shouldReattachListenerForAttachedSession(
          session.status,
          unsubscribersRef.current.has(externalSessionId),
        )
      ) {
        attachSessionListener(repoPath, externalSessionId);
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
            externalSessionId: session.externalSessionId,
            requestedRuntimeKind,
            ensuredRuntimeKind: runtime.runtimeKind,
          });

          attachedRuntimeId = runtime.runtimeId;
          attachedRuntimeRoute = runtime.runtimeRoute;
          attachedWorkingDirectory = runtime.workingDirectory;

          updateSession(
            externalSessionId,
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
          externalSessionId,
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
      const existingUnsubscriber = unsubscribersRef.current.get(externalSessionId);
      await stopSessionOrThrow({
        operation: "ensure-ready-stop-attached-error-session",
        cleanupErrorMessage: `Failed to stop attached error session '${externalSessionId}' before preparing it`,
        externalSessionId,
        taskId: session.taskId,
        role: session.role,
      });
      if (existingUnsubscriber) {
        existingUnsubscriber();
        unsubscribersRef.current.delete(externalSessionId);
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
      externalSessionId: session.externalSessionId,
      requestedRuntimeKind,
      ensuredRuntimeKind: runtime.runtimeKind,
    });
    const runtimeConnection = resolveRuntimeConnection(runtime);
    await adapter.resumeSession({
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
        cleanupErrorMessage: `${STALE_PREPARE_ERROR} Failed to stop stale resumed session '${externalSessionId}'`,
        externalSessionId,
        taskId: session.taskId,
        role: session.role,
      });
      throw new Error(STALE_PREPARE_ERROR);
    }

    if (!unsubscribersRef.current.has(externalSessionId)) {
      attachSessionListener(repoPath, externalSessionId);
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

    updateSession(externalSessionId, (current) => ({
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
