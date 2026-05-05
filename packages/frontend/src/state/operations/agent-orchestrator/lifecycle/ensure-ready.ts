import type { RepoPromptOverrides, RuntimeKind, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort, AgentRole } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import { requireActiveRepo } from "../../tasks/task-operations-model";
import type { RuntimeInfo } from "../runtime/runtime";
import { runOrchestratorTask } from "../support/async-side-effects";
import { shouldReattachListenerForAttachedSession, throwIfRepoStale } from "../support/core";
import { loadSessionPromptContext } from "../support/session-prompt";
import { isWorkflowAgentSession } from "../support/session-purpose";
import { requireSessionRuntimeKindForPersistence } from "../support/session-runtime-metadata";
import {
  type AgentSessionPresenceSnapshot,
  applyAgentSessionPresenceSnapshotToSession,
  sessionPresenceHasPendingInput,
} from "./session-presence";

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

type ConfirmedAgentSessionPresenceSnapshot = Extract<
  AgentSessionPresenceSnapshot,
  { presence: "runtime" }
>;
type AttachedSessionCleanupAction = "detach" | "stop";

const STALE_PREPARE_ERROR = "Workspace changed while preparing session.";
const PENDING_INPUT_NOT_READY_ERROR = "Session is waiting for pending runtime input.";

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
    const cleanupAttachedSessionOrThrow = async ({
      action,
      operation,
      cleanupErrorMessage,
      externalSessionId: targetExternalSessionId,
      taskId,
      role,
    }: {
      action: AttachedSessionCleanupAction;
      operation: string;
      cleanupErrorMessage: string;
      externalSessionId: string;
      taskId: string;
      role: AgentSessionState["role"];
    }): Promise<void> => {
      try {
        await runOrchestratorTask(
          operation,
          async () => {
            if (action === "detach") {
              await adapter.detachSession(targetExternalSessionId);
              return;
            }
            await adapter.stopSession(targetExternalSessionId);
          },
          {
            tags: { repoPath, externalSessionId: targetExternalSessionId, taskId, role },
          },
        );
      } catch (error) {
        throw new Error(`${cleanupErrorMessage}: ${errorMessage(error)}`, { cause: error });
      }
    };

    const removeSessionUnsubscriber = (targetExternalSessionId: string): void => {
      const existingUnsubscriber = unsubscribersRef.current.get(targetExternalSessionId);
      if (!existingUnsubscriber) {
        return;
      }
      existingUnsubscriber();
      unsubscribersRef.current.delete(targetExternalSessionId);
    };

    const readSessionPresenceSnapshot = async ({
      runtimeKind,
      workingDirectory,
      externalSessionId,
    }: {
      runtimeKind: AgentSessionState["runtimeKind"];
      workingDirectory: string;
      externalSessionId: string;
    }) => {
      if (!runtimeKind) {
        throw new Error(`Session '${externalSessionId}' has no runtime kind.`);
      }
      if (workingDirectory.trim().length === 0) {
        throw new Error(`Session '${externalSessionId}' has no working directory.`);
      }
      return adapter.readSessionPresence({
        repoPath,
        runtimeKind,
        workingDirectory,
        externalSessionId,
      });
    };

    const applyConfirmedSessionPresenceSnapshot = (
      snapshot: ConfirmedAgentSessionPresenceSnapshot,
      {
        shouldAttachListener,
        promptOverrides,
        persistFalse = false,
      }: {
        shouldAttachListener: boolean;
        promptOverrides?: RepoPromptOverrides;
        persistFalse?: boolean;
      },
    ): void => {
      updateSession(
        externalSessionId,
        (current) =>
          applyAgentSessionPresenceSnapshotToSession(current, snapshot, {
            ...(promptOverrides ? { promptOverrides } : {}),
          }),
        persistFalse ? { persist: false } : undefined,
      );
      if (shouldAttachListener) {
        attachSessionListener(repoPath, snapshot.ref.externalSessionId);
      }
      if (!allowPendingInput && sessionPresenceHasPendingInput(snapshot)) {
        throw new Error(PENDING_INPUT_NOT_READY_ERROR);
      }
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
      if (session.status !== "error") {
        const attachedRuntimeKind = requireSessionRuntimeKindForPersistence(session);
        const attachedWorkingDirectory = session.workingDirectory;
        const shouldAttachListener = shouldReattachListenerForAttachedSession(
          session.status,
          unsubscribersRef.current.has(externalSessionId),
        );

        const sessionPresence = await readSessionPresenceSnapshot({
          runtimeKind: attachedRuntimeKind,
          workingDirectory: attachedWorkingDirectory,
          externalSessionId: session.externalSessionId,
        });
        assertNotStale();
        if (sessionPresence.presence === "runtime") {
          applyConfirmedSessionPresenceSnapshot(sessionPresence, {
            shouldAttachListener,
            persistFalse: true,
          });
          return;
        }
        updateSession(
          externalSessionId,
          (current) =>
            applyAgentSessionPresenceSnapshotToSession(current, sessionPresence, {
              missingSessionRuntimeId: null,
            }),
          { persist: false },
        );
        await cleanupAttachedSessionOrThrow({
          action: "detach",
          operation: "ensure-ready-detach-missing-attached-session",
          cleanupErrorMessage: `Failed to detach stale attached session '${externalSessionId}' before preparing it`,
          externalSessionId,
          taskId: session.taskId,
          role: session.role,
        });
        removeSessionUnsubscriber(externalSessionId);
        assertNotStale();
        throw new Error(`Runtime did not report attached session '${externalSessionId}'.`);
      }
      if (session.runtimeId !== null) {
        await cleanupAttachedSessionOrThrow({
          action: "stop",
          operation: "ensure-ready-stop-attached-error-session",
          cleanupErrorMessage: `Failed to stop attached error session '${externalSessionId}' before preparing it`,
          externalSessionId,
          taskId: session.taskId,
          role: session.role,
        });
        removeSessionUnsubscriber(externalSessionId);
        assertNotStale();
      }
    }

    const task = taskRef.current.find((entry) => entry.id === session.taskId);
    if (!task) {
      throw new Error(`Task not found: ${session.taskId}`);
    }

    const promptContext = await loadSessionPromptContext({
      workspaceId,
      role: session.role,
      task,
      loadRepoPromptOverrides,
    });
    assertNotStale();
    const requestedRuntimeKind = requireSessionRuntimeKindForPersistence(session);
    const runtime = await ensureRuntime(repoPath, session.taskId, session.role, {
      workspaceId,
      targetWorkingDirectory: session.workingDirectory,
      runtimeKind: requestedRuntimeKind,
    });
    assertNotStale();
    await adapter.resumeSession({
      externalSessionId: session.externalSessionId,
      repoPath,
      runtimeKind: requestedRuntimeKind,
      workingDirectory: runtime.workingDirectory,
      taskId: session.taskId,
      role: session.role,
      systemPrompt: promptContext.systemPrompt,
      ...(session.selectedModel ? { model: session.selectedModel } : {}),
    });

    if (isStaleRepoOperation()) {
      await cleanupAttachedSessionOrThrow({
        action: "stop",
        operation: "ensure-ready-stop-session-after-stale-resume",
        cleanupErrorMessage: `${STALE_PREPARE_ERROR} Failed to stop stale resumed session '${externalSessionId}'`,
        externalSessionId,
        taskId: session.taskId,
        role: session.role,
      });
      throw new Error(STALE_PREPARE_ERROR);
    }

    const sessionPresence = await readSessionPresenceSnapshot({
      runtimeKind: requestedRuntimeKind,
      workingDirectory: runtime.workingDirectory,
      externalSessionId: session.externalSessionId,
    });
    assertNotStale();

    if (sessionPresence.presence !== "runtime") {
      await cleanupAttachedSessionOrThrow({
        action: "stop",
        operation: "ensure-ready-stop-missing-live-session-after-resume",
        cleanupErrorMessage: `Failed to stop resumed session '${externalSessionId}' after live snapshot was stale`,
        externalSessionId,
        taskId: session.taskId,
        role: session.role,
      });
      throw new Error(`Runtime did not report resumed session '${externalSessionId}'.`);
    }

    assertNotStale();

    removeSessionUnsubscriber(externalSessionId);
    applyConfirmedSessionPresenceSnapshot(sessionPresence, {
      shouldAttachListener: true,
      promptOverrides: promptContext.promptOverrides,
    });

    if (isStaleRepoOperation()) {
      return;
    }
  };
};
