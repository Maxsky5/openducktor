import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { AgentSessionState, WorkflowAgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import { requireActiveRepo } from "../../tasks/task-operations-model";
import type { EnsureRuntime } from "../runtime/runtime";
import { throwIfRepoStale } from "../support/core";
import { loadSessionPromptContext } from "../support/session-prompt";
import { requireSessionRuntimeKindForPersistence } from "../support/session-runtime-metadata";
import { type ListenToAgentSession, toRuntimeSessionRef } from "../support/session-runtime-ref";
import { isWorkflowAgentSession } from "../support/workflow-session";
import {
  type AgentSessionPresenceSnapshot,
  applyAgentSessionPresenceSnapshotToSession,
  sessionPresenceHasPendingInput,
} from "./session-presence";

type EnsureSessionReadyDependencies = {
  activeWorkspace: ActiveWorkspace | null;
  adapter: AgentEnginePort;
  repoEpochRef: { current: number };
  currentWorkspaceRepoPathRef: { current: string | null };
  sessionsRef: { current: Record<string, AgentSessionState> };
  taskRef: { current: TaskCard[] };
  unsubscribersRef: { current: Map<string, () => void> };
  updateSession: (
    externalSessionId: string,
    updater: (current: AgentSessionState) => AgentSessionState,
    options?: { persist?: boolean },
  ) => void;
  listenToAgentSession: ListenToAgentSession;
  ensureRuntime: EnsureRuntime;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
};

type ConfirmedAgentSessionPresenceSnapshot = Extract<
  AgentSessionPresenceSnapshot,
  { presence: "runtime" }
>;

const STALE_PREPARE_ERROR = "Workspace changed while preparing session.";
const PENDING_INPUT_NOT_READY_ERROR = "Session is waiting for pending runtime input.";

export const createEnsureSessionReady = ({
  activeWorkspace,
  adapter,
  repoEpochRef,
  currentWorkspaceRepoPathRef,
  sessionsRef,
  taskRef,
  unsubscribersRef,
  updateSession,
  listenToAgentSession,
  ensureRuntime,
  loadRepoPromptOverrides,
}: EnsureSessionReadyDependencies) => {
  return async (externalSessionId: string): Promise<void> => {
    const repoPath = requireActiveRepo(activeWorkspace?.repoPath ?? null);
    const workspaceId = activeWorkspace?.workspaceId;
    if (!workspaceId) {
      throw new Error("Active workspace is required.");
    }
    const repoEpochAtStart = repoEpochRef.current;
    const isStaleRepoOperation = (): boolean => {
      return (
        repoEpochRef.current !== repoEpochAtStart ||
        currentWorkspaceRepoPathRef.current !== repoPath
      );
    };
    const assertNotStale = (): void => {
      throwIfRepoStale(isStaleRepoOperation, STALE_PREPARE_ERROR);
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
    const applyConfirmedSessionPresenceSnapshot = async (
      snapshot: ConfirmedAgentSessionPresenceSnapshot,
      {
        session,
        shouldListen,
      }: {
        session: WorkflowAgentSessionState;
        shouldListen: boolean;
      },
    ): Promise<void> => {
      updateSession(externalSessionId, (current) =>
        applyAgentSessionPresenceSnapshotToSession(current, snapshot),
      );
      if (shouldListen) {
        await listenToAgentSession(
          toRuntimeSessionRef(repoPath, sessionsRef.current[externalSessionId] ?? session),
        );
      }
      if (sessionPresenceHasPendingInput(snapshot)) {
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
    const cleanupStaleResumedSessionIfNeeded = async (): Promise<void> => {
      if (!isStaleRepoOperation()) {
        return;
      }

      await adapter.stopSession({
        repoPath,
        externalSessionId,
        runtimeKind: requireSessionRuntimeKindForPersistence(session),
        workingDirectory: session.workingDirectory,
      });
      throw new Error(STALE_PREPARE_ERROR);
    };
    const resumeSessionAndReadPresence = async ({
      requestedRuntimeKind,
      runtime,
      systemPrompt,
    }: {
      requestedRuntimeKind: NonNullable<AgentSessionState["runtimeKind"]>;
      runtime: Awaited<ReturnType<typeof ensureRuntime>>;
      systemPrompt: string;
    }): Promise<Awaited<ReturnType<typeof readSessionPresenceSnapshot>>> => {
      await adapter.resumeSession({
        externalSessionId: session.externalSessionId,
        repoPath,
        runtimeKind: requestedRuntimeKind,
        workingDirectory: runtime.workingDirectory,
        taskId: session.taskId,
        role: session.role,
        systemPrompt,
        ...(session.selectedModel ? { model: session.selectedModel } : {}),
      });
      await cleanupStaleResumedSessionIfNeeded();

      return readSessionPresenceSnapshot({
        runtimeKind: requestedRuntimeKind,
        workingDirectory: runtime.workingDirectory,
        externalSessionId: session.externalSessionId,
      });
    };

    if (session.status !== "error") {
      const storedRuntimeKind = requireSessionRuntimeKindForPersistence(session);
      const sessionPresence = await readSessionPresenceSnapshot({
        runtimeKind: storedRuntimeKind,
        workingDirectory: session.workingDirectory,
        externalSessionId: session.externalSessionId,
      });
      assertNotStale();
      if (sessionPresence.presence === "runtime") {
        await applyConfirmedSessionPresenceSnapshot(sessionPresence, {
          session,
          shouldListen: !unsubscribersRef.current.has(externalSessionId),
        });
        return;
      }
      updateSession(
        externalSessionId,
        (current) => applyAgentSessionPresenceSnapshotToSession(current, sessionPresence),
        { persist: false },
      );
      assertNotStale();
    }

    const task = taskRef.current.find((entry) => entry.id === session.taskId);
    if (!task) {
      throw new Error(`Task not found: ${session.taskId}`);
    }

    const requestedRuntimeKind = requireSessionRuntimeKindForPersistence(session);
    const promptContext = await loadSessionPromptContext({
      workspaceId,
      role: session.role,
      task,
      loadRepoPromptOverrides,
    });
    assertNotStale();
    const runtime = await ensureRuntime(repoPath, session.taskId, session.role, {
      workspaceId,
      targetWorkingDirectory: session.workingDirectory,
      runtimeKind: requestedRuntimeKind,
    });
    assertNotStale();
    const sessionPresence = await resumeSessionAndReadPresence({
      requestedRuntimeKind,
      runtime,
      systemPrompt: promptContext.systemPrompt,
    });
    assertNotStale();

    if (sessionPresence.presence !== "runtime") {
      await adapter.stopSession({
        repoPath,
        externalSessionId,
        runtimeKind: requestedRuntimeKind,
        workingDirectory: runtime.workingDirectory,
      });
      throw new Error(`Runtime did not report resumed session '${externalSessionId}'.`);
    }

    assertNotStale();

    removeSessionUnsubscriber(externalSessionId);
    await applyConfirmedSessionPresenceSnapshot(sessionPresence, {
      session,
      shouldListen: true,
    });

    if (isStaleRepoOperation()) {
      return;
    }
  };
};
