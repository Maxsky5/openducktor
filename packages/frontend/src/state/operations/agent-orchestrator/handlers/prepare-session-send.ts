import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import { type SessionRef, workflowAgentSessionScope } from "@openducktor/core";
import type { WorkflowAgentSessionState } from "@/types/agent-orchestrator";
import type { EnsureExistingSessionRuntime } from "../runtime/runtime";
import { throwIfRepoStale } from "../support/core";
import { requireWorkspaceRepoPath } from "../support/session-invariants";
import type { SessionObservers } from "../support/session-observers";
import { loadSessionPromptContext } from "../support/session-prompt";
import type { LoadSettingsSnapshotForRuntimePolicy } from "../support/session-runtime-policy";
import { resolveAgentSessionRuntimePolicy } from "../support/session-runtime-policy";
import {
  type ObserveAgentSession,
  toRuntimeSessionRefWithPolicy,
} from "../support/session-runtime-ref";

type PrepareSessionSendDependencies = {
  workspaceRepoPath: string | null;
  workspaceId: string | null;
  repoEpochRef: { current: number };
  currentWorkspaceRepoPathRef: { current: string | null };
  taskRef: { current: TaskCard[] };
  sessionObserversRef: { current: SessionObservers };
  observeAgentSession: ObserveAgentSession;
  ensureExistingSessionRuntime: EnsureExistingSessionRuntime;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
  loadSettingsSnapshot: LoadSettingsSnapshotForRuntimePolicy;
};

export type PreparedSessionSend = {
  repoPath: string;
  systemPrompt: string;
};

const STALE_SEND_PREPARATION_ERROR = "Workspace changed while preparing session send.";

const findSessionTask = (tasks: TaskCard[], session: WorkflowAgentSessionState): TaskCard => {
  const task = tasks.find((entry) => entry.id === session.taskId);
  if (!task) {
    throw new Error(`Task not found: ${session.taskId}`);
  }
  return task;
};

const removeObserverIfStale = ({
  sessionRef,
  sessionObservers,
  isStale,
}: {
  sessionRef: SessionRef;
  sessionObservers: SessionObservers;
  isStale: () => boolean;
}): void => {
  if (!isStale()) {
    return;
  }

  sessionObservers.remove(sessionRef);
  throw new Error(STALE_SEND_PREPARATION_ERROR);
};

export const createPrepareSessionSend = ({
  workspaceRepoPath,
  workspaceId,
  repoEpochRef,
  currentWorkspaceRepoPathRef,
  taskRef,
  sessionObserversRef,
  observeAgentSession,
  ensureExistingSessionRuntime,
  loadRepoPromptOverrides,
  loadSettingsSnapshot,
}: PrepareSessionSendDependencies) => {
  return async (session: WorkflowAgentSessionState): Promise<PreparedSessionSend> => {
    const repoPath = requireWorkspaceRepoPath(workspaceRepoPath);
    if (!workspaceId) {
      throw new Error("Active workspace is required.");
    }

    const repoEpochAtStart = repoEpochRef.current;
    const isStale = (): boolean =>
      repoEpochRef.current !== repoEpochAtStart || currentWorkspaceRepoPathRef.current !== repoPath;
    const assertNotStale = (): void => {
      throwIfRepoStale(isStale, STALE_SEND_PREPARATION_ERROR);
    };

    assertNotStale();
    const task = findSessionTask(taskRef.current, session);
    const sessionScope = workflowAgentSessionScope(session.taskId, session.role);
    const runtimePolicy = await resolveAgentSessionRuntimePolicy({
      runtimeKind: session.runtimeKind,
      sessionScope,
      loadSettingsSnapshot,
    });
    const sessionRef = {
      ...toRuntimeSessionRefWithPolicy(repoPath, session, runtimePolicy),
      sessionScope,
    };
    const [promptContext] = await Promise.all([
      loadSessionPromptContext({
        workspaceId,
        role: session.role,
        task,
        loadRepoPromptOverrides,
      }),
      ensureExistingSessionRuntime(repoPath, sessionRef.runtimeKind),
    ]);
    assertNotStale();

    await observeAgentSession(sessionRef);
    removeObserverIfStale({
      sessionRef,
      sessionObservers: sessionObserversRef.current,
      isStale,
    });

    return {
      repoPath,
      systemPrompt: promptContext.systemPrompt,
    };
  };
};
