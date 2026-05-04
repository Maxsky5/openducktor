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
  applyLiveSessionTruthToSession,
  type LiveSessionTruth,
  liveSessionTruthHasPendingInput,
  readResolvedLiveSessionTruth,
} from "./live-session-truth";

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

    const readLiveTruth = async ({
      runtimeKind,
      runtimeId,
      workingDirectory,
      externalSessionId,
    }: {
      runtimeKind: AgentSessionState["runtimeKind"];
      runtimeId: string | null;
      workingDirectory: string;
      externalSessionId: string;
    }) => {
      if (!runtimeKind) {
        throw new Error(`Session '${externalSessionId}' has no runtime kind.`);
      }
      if (workingDirectory.trim().length === 0) {
        throw new Error(`Session '${externalSessionId}' has no working directory.`);
      }
      return readResolvedLiveSessionTruth({
        repoPath,
        runtimeKind,
        runtimeId,
        workingDirectory,
        externalSessionId,
        readSnapshot: (snapshotInput) => adapter.readLiveAgentSessionSnapshot(snapshotInput),
      });
    };

    const attachListenerIfLiveTruthConfirmed = (
      truth: LiveSessionTruth,
      shouldAttachListener: boolean,
    ): void => {
      if (truth.type !== "live" || !shouldAttachListener) {
        return;
      }
      attachSessionListener(repoPath, truth.externalSessionId);
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
        const attachedRuntimeId = session.runtimeId;
        const attachedWorkingDirectory = session.workingDirectory;
        const shouldAttachListener = shouldReattachListenerForAttachedSession(
          session.status,
          unsubscribersRef.current.has(externalSessionId),
        );

        const liveSessionTruth = await readLiveTruth({
          runtimeKind: attachedRuntimeKind,
          runtimeId: attachedRuntimeId,
          workingDirectory: attachedWorkingDirectory,
          externalSessionId: session.externalSessionId,
        });
        assertNotStale();
        if (liveSessionTruth.type === "live") {
          updateSession(
            externalSessionId,
            (current) => applyLiveSessionTruthToSession(current, liveSessionTruth),
            { persist: false },
          );
          attachListenerIfLiveTruthConfirmed(liveSessionTruth, shouldAttachListener);
          if (!allowPendingInput && liveSessionTruthHasPendingInput(liveSessionTruth)) {
            throw new Error(PENDING_INPUT_NOT_READY_ERROR);
          }
          return;
        }
        if (attachedRuntimeId === null) {
          updateSession(
            externalSessionId,
            (current) => applyLiveSessionTruthToSession(current, liveSessionTruth),
            { persist: false },
          );
          throw new Error(`Runtime did not report attached session '${externalSessionId}'.`);
        }
      }
      if (session.runtimeId !== null) {
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
      await stopSessionOrThrow({
        operation: "ensure-ready-stop-session-after-stale-resume",
        cleanupErrorMessage: `${STALE_PREPARE_ERROR} Failed to stop stale resumed session '${externalSessionId}'`,
        externalSessionId,
        taskId: session.taskId,
        role: session.role,
      });
      throw new Error(STALE_PREPARE_ERROR);
    }

    const liveSessionTruth = await readLiveTruth({
      runtimeKind: requestedRuntimeKind,
      runtimeId: runtime.runtimeId,
      workingDirectory: runtime.workingDirectory,
      externalSessionId: session.externalSessionId,
    });
    assertNotStale();

    if (liveSessionTruth.type !== "live") {
      await stopSessionOrThrow({
        operation: "ensure-ready-stop-missing-live-session-after-resume",
        cleanupErrorMessage: `Failed to stop resumed session '${externalSessionId}' after live snapshot was missing`,
        externalSessionId,
        taskId: session.taskId,
        role: session.role,
      });
      throw new Error(`Runtime did not report resumed session '${externalSessionId}'.`);
    }

    attachListenerIfLiveTruthConfirmed(
      liveSessionTruth,
      !unsubscribersRef.current.has(externalSessionId),
    );

    assertNotStale();

    updateSession(externalSessionId, (current) =>
      applyLiveSessionTruthToSession(current, liveSessionTruth, {
        promptOverrides: promptContext.promptOverrides,
      }),
    );

    if (!allowPendingInput && liveSessionTruthHasPendingInput(liveSessionTruth)) {
      throw new Error(PENDING_INPUT_NOT_READY_ERROR);
    }

    if (isStaleRepoOperation()) {
      return;
    }
  };
};
