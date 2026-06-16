import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort, AgentSessionRef } from "@openducktor/core";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { requireActiveRepo } from "../../tasks/task-operations-model";
import type { EnsureRuntime } from "../runtime/runtime";
import { throwIfRepoStale } from "../support/core";
import type { SessionObservers } from "../support/session-observers";
import { loadSessionPromptContext } from "../support/session-prompt";
import { type ObserveAgentSession, toRuntimeSessionRef } from "../support/session-runtime-ref";
import { isWorkflowAgentSession } from "../support/workflow-session";
import {
  type AgentSessionRuntimeSnapshot,
  type AvailableAgentSessionRuntimeSnapshot,
  applyAgentSessionRuntimeSnapshotToSession,
  sessionRuntimeSnapshotHasPendingInput,
} from "./session-runtime-snapshot";

type EnsureSessionReadyDependencies = {
  workspaceRepoPath: string | null;
  workspaceId: string | null;
  adapter: AgentEnginePort;
  repoEpochRef: { current: number };
  currentWorkspaceRepoPathRef: { current: string | null };
  readSessionSnapshot: (identity: AgentSessionIdentity) => AgentSessionState | null;
  taskRef: { current: TaskCard[] };
  sessionObserversRef: { current: SessionObservers };
  updateSession: (
    identity: AgentSessionIdentity,
    updater: (current: AgentSessionState) => AgentSessionState,
    options?: { persist?: boolean },
  ) => void;
  observeAgentSession: ObserveAgentSession;
  ensureRuntime: EnsureRuntime;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
};

const STALE_PREPARE_ERROR = "Workspace changed while preparing session.";
const PENDING_INPUT_NOT_READY_ERROR = "Session is waiting for pending runtime input.";

export const createEnsureSessionReady = ({
  workspaceRepoPath,
  workspaceId,
  adapter,
  repoEpochRef,
  currentWorkspaceRepoPathRef,
  readSessionSnapshot,
  taskRef,
  sessionObserversRef,
  updateSession,
  observeAgentSession,
  ensureRuntime,
  loadRepoPromptOverrides,
}: EnsureSessionReadyDependencies) => {
  return async (sessionIdentity: AgentSessionIdentity): Promise<AgentSessionIdentity> => {
    const repoPath = requireActiveRepo(workspaceRepoPath);
    const externalSessionId = sessionIdentity.externalSessionId;
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

    assertNotStale();
    const session = readSessionSnapshot(sessionIdentity);
    if (!session) {
      throw new Error(`Session not found: ${externalSessionId}`);
    }
    if (!isWorkflowAgentSession(session)) {
      throw new Error(`Session '${externalSessionId}' is not a workflow session.`);
    }
    const sessionRef = toRuntimeSessionRef(repoPath, session);
    const applyRuntimeSnapshot = (
      snapshot: AgentSessionRuntimeSnapshot,
      options?: { persist?: boolean },
    ): void => {
      updateSession(
        session,
        (current) => applyAgentSessionRuntimeSnapshotToSession(current, snapshot),
        options,
      );
    };
    const observeRuntimeSession = async (
      snapshot: AvailableAgentSessionRuntimeSnapshot,
    ): Promise<AgentSessionIdentity> => {
      applyRuntimeSnapshot(snapshot);
      if (!sessionObserversRef.current.has(snapshot.ref)) {
        await observeAgentSession(snapshot.ref);
      }
      if (sessionRuntimeSnapshotHasPendingInput(snapshot)) {
        throw new Error(PENDING_INPUT_NOT_READY_ERROR);
      }
      return snapshot.ref;
    };
    const cleanupStaleResumedSessionIfNeeded = async (
      resumedSessionRef: AgentSessionRef,
    ): Promise<void> => {
      if (!isStaleRepoOperation()) {
        return;
      }

      await adapter.stopSession(resumedSessionRef);
      throw new Error(STALE_PREPARE_ERROR);
    };
    const resumeSessionAndReadSnapshot = async ({
      resumedSessionRef,
      systemPrompt,
    }: {
      resumedSessionRef: AgentSessionRef;
      systemPrompt: string;
    }): Promise<AgentSessionRuntimeSnapshot> => {
      await adapter.resumeSession({
        ...resumedSessionRef,
        taskId: session.taskId,
        role: session.role,
        ...(session.selectedModel ? { model: session.selectedModel } : {}),
        systemPrompt,
      });
      await cleanupStaleResumedSessionIfNeeded(resumedSessionRef);

      return adapter.readSessionRuntimeSnapshot(resumedSessionRef);
    };

    if (session.status !== "error") {
      const runtimeSnapshot = await adapter.readSessionRuntimeSnapshot(sessionRef);
      assertNotStale();
      if (runtimeSnapshot.availability === "runtime") {
        return observeRuntimeSession(runtimeSnapshot);
      }
      applyRuntimeSnapshot(runtimeSnapshot, { persist: false });
      assertNotStale();
    }

    const task = taskRef.current.find((entry) => entry.id === session.taskId);
    if (!task) {
      throw new Error(`Task not found: ${session.taskId}`);
    }

    const requestedRuntimeKind = sessionRef.runtimeKind;
    const promptContext = await loadSessionPromptContext({
      workspaceId,
      role: session.role,
      task,
      loadRepoPromptOverrides,
    });
    assertNotStale();
    await ensureRuntime(repoPath, session.taskId, session.role, {
      workspaceId,
      targetWorkingDirectory: session.workingDirectory,
      runtimeKind: requestedRuntimeKind,
    });
    assertNotStale();
    const runtimeSnapshot = await resumeSessionAndReadSnapshot({
      resumedSessionRef: sessionRef,
      systemPrompt: promptContext.systemPrompt,
    });
    assertNotStale();

    if (runtimeSnapshot.availability !== "runtime") {
      await adapter.stopSession(sessionRef);
      throw new Error(`Runtime did not report resumed session '${externalSessionId}'.`);
    }

    assertNotStale();

    return observeRuntimeSession(runtimeSnapshot);
  };
};
