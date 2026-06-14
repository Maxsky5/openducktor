import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort, AgentSessionRef } from "@openducktor/core";
import { type AgentSessionCollection, getAgentSession } from "@/state/agent-session-collection";
import type {
  AgentSessionIdentity,
  AgentSessionState,
  WorkflowAgentSessionState,
} from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import { requireActiveRepo } from "../../tasks/task-operations-model";
import type { EnsureRuntime } from "../runtime/runtime";
import { throwIfRepoStale } from "../support/core";
import {
  hasSessionListener,
  removeSessionListenersByExternalSessionId,
  type SessionListenerRegistry,
} from "../support/session-listener-registry";
import { loadSessionPromptContext } from "../support/session-prompt";
import {
  type ListenToAgentSession,
  toRuntimeSessionContextRef,
  toRuntimeSessionRef,
} from "../support/session-runtime-ref";
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
  sessionsRef: { current: AgentSessionCollection };
  taskRef: { current: TaskCard[] };
  sessionListenerRegistryRef: { current: SessionListenerRegistry };
  updateSession: (
    identity: AgentSessionIdentity,
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
  sessionListenerRegistryRef,
  updateSession,
  listenToAgentSession,
  ensureRuntime,
  loadRepoPromptOverrides,
}: EnsureSessionReadyDependencies) => {
  return async (sessionIdentity: AgentSessionIdentity): Promise<AgentSessionIdentity> => {
    const repoPath = requireActiveRepo(activeWorkspace?.repoPath ?? null);
    const workspaceId = activeWorkspace?.workspaceId;
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

    const applyRuntimePresenceSnapshot = async (
      snapshot: ConfirmedAgentSessionPresenceSnapshot,
      session: WorkflowAgentSessionState,
    ): Promise<AgentSessionIdentity> => {
      updateSession(session, (current) =>
        applyAgentSessionPresenceSnapshotToSession(current, snapshot),
      );
      const sessionRef = snapshot.ref;
      if (!hasSessionListener(sessionListenerRegistryRef.current, sessionRef)) {
        await listenToAgentSession(sessionRef);
      }
      if (sessionPresenceHasPendingInput(snapshot)) {
        throw new Error(PENDING_INPUT_NOT_READY_ERROR);
      }
      return sessionRef;
    };

    assertNotStale();
    const session = getAgentSession(sessionsRef.current, sessionIdentity);
    if (!session) {
      throw new Error(`Session not found: ${externalSessionId}`);
    }
    if (!isWorkflowAgentSession(session)) {
      throw new Error(`Session '${externalSessionId}' is not a workflow session.`);
    }
    const sessionRef = toRuntimeSessionRef(repoPath, session);
    const cleanupStaleResumedSessionIfNeeded = async (
      resumedSessionRef: AgentSessionRef,
    ): Promise<void> => {
      if (!isStaleRepoOperation()) {
        return;
      }

      await adapter.stopSession(resumedSessionRef);
      throw new Error(STALE_PREPARE_ERROR);
    };
    const resumeSessionAndReadPresence = async ({
      resumedSessionRef,
      systemPrompt,
    }: {
      resumedSessionRef: AgentSessionRef;
      systemPrompt: string;
    }): Promise<AgentSessionPresenceSnapshot> => {
      const resumedSession = {
        ...session,
        runtimeKind: resumedSessionRef.runtimeKind,
        workingDirectory: resumedSessionRef.workingDirectory,
      };
      await adapter.resumeSession({
        ...toRuntimeSessionContextRef(repoPath, resumedSession),
        systemPrompt,
      });
      await cleanupStaleResumedSessionIfNeeded(resumedSessionRef);

      return adapter.readSessionPresence(resumedSessionRef);
    };

    if (session.status !== "error") {
      const sessionPresence = await adapter.readSessionPresence(sessionRef);
      assertNotStale();
      if (sessionPresence.presence === "runtime") {
        return applyRuntimePresenceSnapshot(sessionPresence, session);
      }
      updateSession(
        session,
        (current) => applyAgentSessionPresenceSnapshotToSession(current, sessionPresence),
        { persist: false },
      );
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
    const runtime = await ensureRuntime(repoPath, session.taskId, session.role, {
      workspaceId,
      targetWorkingDirectory: session.workingDirectory,
      runtimeKind: requestedRuntimeKind,
    });
    assertNotStale();
    const resumedSessionRef = toRuntimeSessionRef(repoPath, {
      ...session,
      runtimeKind: requestedRuntimeKind,
      workingDirectory: runtime.workingDirectory,
    });
    const sessionPresence = await resumeSessionAndReadPresence({
      resumedSessionRef,
      systemPrompt: promptContext.systemPrompt,
    });
    assertNotStale();

    if (sessionPresence.presence !== "runtime") {
      await adapter.stopSession(resumedSessionRef);
      throw new Error(`Runtime did not report resumed session '${externalSessionId}'.`);
    }

    assertNotStale();

    removeSessionListenersByExternalSessionId(
      sessionListenerRegistryRef.current,
      externalSessionId,
    );
    const readySessionIdentity = await applyRuntimePresenceSnapshot(sessionPresence, session);

    if (isStaleRepoOperation()) {
      return readySessionIdentity;
    }

    return readySessionIdentity;
  };
};
