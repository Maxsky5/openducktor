import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { WorkflowAgentSessionState } from "@/types/agent-orchestrator";
import type { EnsureExistingSessionRuntime } from "../runtime/runtime";
import { throwIfRepoStale } from "../support/core";
import { requireWorkspaceRepoPath } from "../support/session-invariants";
import { loadSessionPromptContext } from "../support/session-prompt";

type PrepareSessionSendDependencies = {
  workspaceRepoPath: string | null;
  workspaceId: string | null;
  repoEpochRef: { current: number };
  currentWorkspaceRepoPathRef: { current: string | null };
  taskRef: { current: TaskCard[] };
  ensureExistingSessionRuntime: EnsureExistingSessionRuntime;
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

export const createPrepareSessionSend = ({
  workspaceRepoPath,
  workspaceId,
  repoEpochRef,
  currentWorkspaceRepoPathRef,
  taskRef,
  ensureExistingSessionRuntime,
  loadRepoPromptOverrides,
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
    const [promptContext] = await Promise.all([
      loadSessionPromptContext({
        workspaceId,
        role: session.role,
        task,
        loadRepoPromptOverrides,
      }),
      ensureExistingSessionRuntime(repoPath, session.runtimeKind),
    ]);
    assertNotStale();

    return {
      repoPath,
      systemPrompt: promptContext.systemPrompt,
    };
  };
};
