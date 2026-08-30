import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
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
  systemPrompt?: string;
};

const STALE_SEND_PREPARATION_ERROR = "Workspace changed while preparing session send.";

const findSessionTask = (tasks: TaskCard[], taskId: string): TaskCard => {
  const task = tasks.find((entry) => entry.id === taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
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
  return async (
    session: AgentSessionState,
    { prepareWorkflowContext }: { prepareWorkflowContext: boolean },
  ): Promise<PreparedSessionSend> => {
    const repoPath = requireWorkspaceRepoPath(workspaceRepoPath);
    const repoEpochAtStart = repoEpochRef.current;
    const isStale = (): boolean =>
      repoEpochRef.current !== repoEpochAtStart || currentWorkspaceRepoPathRef.current !== repoPath;
    const assertNotStale = (): void => {
      throwIfRepoStale(isStale, STALE_SEND_PREPARATION_ERROR);
    };

    assertNotStale();
    const association = session.sessionAssociation;
    if (!association) {
      throw new Error(
        `Cannot send message for session '${session.externalSessionId}' because its association is missing.`,
      );
    }
    if (association.kind === "unbound") {
      throw new Error(
        `Cannot send message for unbound session '${session.externalSessionId}'; repository or workflow context is required.`,
      );
    }
    if (association.kind === "repository" || !prepareWorkflowContext) {
      return { repoPath };
    }
    if (!workspaceId) {
      throw new Error("Active workspace is required.");
    }

    const task = findSessionTask(taskRef.current, association.taskId);
    const [promptContext] = await Promise.all([
      loadSessionPromptContext({
        workspaceId,
        role: association.role,
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
