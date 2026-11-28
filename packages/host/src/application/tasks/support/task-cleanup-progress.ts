import { Effect } from "effect";
import { TASK_OPEN_STATE } from "@openducktor/contracts";
import {
  backgroundStep,
  planBackgroundSteps,
} from "../../operation-progress/background-operation-progress";
import type { TaskRecord, TaskStorePort } from "../../../ports/task-repository-ports";
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

const recordStoppedAgentSessionCount = (
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
      ({ stoppedSessionCount }) =>
        stoppedSessionCount > 0 && { details: [`Stopped sessions: ${stoppedSessionCount}`] },
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

type BackgroundStep = Parameters<typeof planBackgroundSteps>[number];
const pullRequestStep = { id: "pull-request", label: "Clear pull request link" };
const mergeRecordStep = { id: "direct-merge", label: "Clear merge record" };

export const planTaskResetSteps = (
  current: TaskRecord,
  cleanup: readonly (BackgroundStep | false)[],
) =>
  planBackgroundSteps(
    { id: "terminals", label: "Stop task terminals" },
    ...cleanup.filter((step) => step !== false),
    ...(current.pullRequest ? [pullRequestStep] : []),
    ...(current.directMerge ? [mergeRecordStep] : []),
    ...(current.status === TASK_OPEN_STATE
      ? []
      : [{ id: "task-reset", label: "Reset task status" }]),
  );

export const clearTaskResetDelivery = (
  store: Pick<TaskStorePort, "setPullRequest" | "setDirectMerge">,
  completion: Pick<ReturnType<typeof createTaskCompletionState>, "discard">,
  scope: TaskIdInput,
  current: Pick<TaskRecord, "pullRequest" | "directMerge">,
  progress: TaskCleanupProgressState,
) =>
  Effect.gen(function* () {
    yield* backgroundStep(
      pullRequestStep,
      store.setPullRequest({ ...scope, pullRequest: null }),
      () => current.pullRequest !== undefined && {},
    );
    if (current.pullRequest) progress.completedSteps.push("cleared pull request metadata");
    yield* Effect.uninterruptible(
      Effect.gen(function* () {
        yield* backgroundStep(
          mergeRecordStep,
          store.setDirectMerge({ ...scope, directMerge: null }),
          () => current.directMerge !== undefined && {},
        );
        if (current.directMerge) progress.completedSteps.push("cleared direct merge metadata");
        yield* backgroundStep(
          { id: "delivery", label: "Clear merge and push progress" },
          completion.discard(scope),
          (discarded) => discarded && {},
        );
      }),
    );
  });
