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
      `Stopped ${stoppedSessionCount} live agent session${stoppedSessionCount === 1 ? "" : "s"}.`,
    );
  }
};

const cleanupLabels = {
  task_close: { label: "Close", retryVerb: "close" },
  task_delete: { label: "Delete", retryVerb: "delete" },
  task_reset: { label: "Reset", retryVerb: "reset" },
  task_reset_implementation: {
    label: "Reset implementation",
    retryVerb: "reset implementation",
  },
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
    progress.push(`${labels.label} cleanup already completed: ${completedSteps.join(", ")}.`);
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
