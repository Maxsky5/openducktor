import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentSessionRef } from "@openducktor/core";
import type { WorkflowAgentSessionState } from "@/types/agent-orchestrator";
import { requireActiveRepo } from "../../tasks/task-operations-model";
import type { EnsureRuntime } from "../runtime/runtime";
import { throwIfRepoStale } from "../support/core";
import type { SessionObservers } from "../support/session-observers";
import { loadSessionPromptContext } from "../support/session-prompt";
import { type ObserveAgentSession, toRuntimeSessionRef } from "../support/session-runtime-ref";

type PrepareSessionSendDependencies = {
  workspaceRepoPath: string | null;
  workspaceId: string | null;
  repoEpochRef: { current: number };
  currentWorkspaceRepoPathRef: { current: string | null };
  taskRef: { current: TaskCard[] };
  sessionObserversRef: { current: SessionObservers };
  observeAgentSession: ObserveAgentSession;
  ensureRuntime: EnsureRuntime;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
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
  sessionRef: AgentSessionRef;
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
  ensureRuntime,
  loadRepoPromptOverrides,
}: PrepareSessionSendDependencies) => {
  return async (session: WorkflowAgentSessionState): Promise<PreparedSessionSend> => {
    const repoPath = requireActiveRepo(workspaceRepoPath);
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
    const sessionRef = toRuntimeSessionRef(repoPath, session);
    const [promptContext] = await Promise.all([
      loadSessionPromptContext({
        workspaceId,
        role: session.role,
        task,
        loadRepoPromptOverrides,
      }),
      ensureRuntime(repoPath, session.taskId, session.role, {
        workspaceId,
        targetWorkingDirectory: session.workingDirectory,
        runtimeKind: sessionRef.runtimeKind,
      }),
    ]);
    assertNotStale();

    if (!sessionObserversRef.current.has(sessionRef)) {
      await observeAgentSession(sessionRef);
      removeObserverIfStale({
        sessionRef,
        sessionObservers: sessionObserversRef.current,
        isStale,
      });
    }

    return {
      repoPath,
      systemPrompt: promptContext.systemPrompt,
    };
  };
};
