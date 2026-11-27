import { Effect } from "effect";
import { backgroundStep } from "../../operation-progress/background-operation-progress";
import type { TaskStorePort } from "../../../ports/task-repository-ports";
import type { createTaskCompletionState } from "../task-completion-state";
import type { TaskIdInput } from "../task-inputs";
import { errorMessage, HostOperationError } from "../../../effect/host-errors";

export type TaskCleanupProgressState = {
  removedWorktrees: string[];
  deletedBranches: string[];
  completedSteps: string[];
};

export const createTaskCleanupProgressState = (): TaskCleanupProgressState => ({
  removedWorktrees: [],
  deletedBranches: [],
  completedSteps: [],
});

export const recordStoppedAgentSessionCount = (
  progress: TaskCleanupProgressState,
  stoppedSessionCount: number,
): void => {
  if (stoppedSessionCount > 0) {
    progress.completedSteps.push(
      `Stopped ${stoppedSessionCount} live agent session${stoppedSessionCount === 1 ? "" : "s"}`,
    );
  }
};

export const stopTaskSessionsWithProgress = <E, R>(
  progress: TaskCleanupProgressState,
  cleanup: Effect.Effect<{ stoppedSessionCount: number }, E, R>,
) =>
  Effect.gen(function* () {
    const { stoppedSessionCount } = yield* backgroundStep(
      { id: "sessions", label: "Stop task sessions" },
      cleanup,
      (result) => ({ details: [`Stopped sessions: ${result.stoppedSessionCount}`] }),
    );
    recordStoppedAgentSessionCount(progress, stoppedSessionCount);
  });

const cleanupLabels = {
  task_close: { label: "Close", retryVerb: "close" },
  task_delete: { label: "Delete", retryVerb: "delete" },
  task_reset: { label: "Reset", retryVerb: "reset" },
  worktree_reset: { label: "Worktree reset", retryVerb: "the worktree reset" },
  task_worktree_remove: { label: "Remove worktree", retryVerb: "remove worktree" },
} as const;

export type TaskCleanupOperation = keyof typeof cleanupLabels;

type TaskCleanupProgressInput = {
  operation: TaskCleanupOperation;
  removedWorktrees: string[];
  deletedBranches: string[];
  completedSteps?: string[];
};

export const appendTaskCleanupProgress = <E>(
  error: E,
  { operation, removedWorktrees, deletedBranches, completedSteps = [] }: TaskCleanupProgressInput,
): E | HostOperationError => {
  const labels = cleanupLabels[operation];
  const progress: string[] = [];
  if (removedWorktrees.length > 0) {
    progress.push(
      `${labels.label} cleanup already removed worktrees: ${removedWorktrees.join(", ")}.`,
    );
  }
  if (deletedBranches.length > 0) {
    progress.push(
      `${labels.label} cleanup already deleted branches: ${deletedBranches.join(", ")}.`,
    );
  }
  if (completedSteps.length > 0) {
    const completedStepList = completedSteps.map((step) => step.replace(/\.$/, "")).join(", ");
    progress.push(`${labels.label} cleanup already completed: ${completedStepList}.`);
  }
  if (progress.length === 0) {
    return error;
  }
  progress.push(`Retry ${labels.retryVerb} to finish cleanup safely.`);
  return new HostOperationError({
    operation: `${operation}.cleanup`,
    message: `${errorMessage(error)}\n${progress.join("\n")}`,
    cause: error,
  });
};

export const clearTaskResetDelivery = (
  store: Pick<TaskStorePort, "setPullRequest" | "setDirectMerge">,
  completion: Pick<ReturnType<typeof createTaskCompletionState>, "discard">,
  scope: TaskIdInput,
  progress: TaskCleanupProgressState,
) =>
  Effect.gen(function* () {
    yield* backgroundStep(
      { id: "pull-request", label: "Clear pull request link" },
      store.setPullRequest({ ...scope, pullRequest: null }),
    );
    progress.completedSteps.push("cleared pull request metadata");
    yield* Effect.uninterruptible(
      Effect.gen(function* () {
        yield* backgroundStep(
          { id: "direct-merge", label: "Clear merge record" },
          store.setDirectMerge({ ...scope, directMerge: null }),
        );
        progress.completedSteps.push("cleared direct merge metadata");
        yield* backgroundStep(
          { id: "delivery", label: "Clear merge and push progress" },
          completion.discard(scope),
        );
      }),
    );
  });
