import type { TaskWorktreeOwners } from "@openducktor/contracts";
import { describeWorktreeOwners, emptyWorktreeOwners } from "@openducktor/core";
import { Effect } from "effect";
import {
  type HostError,
  HostDependencyError,
  HostValidationError,
} from "../../../effect/host-errors";
import type { TaskStoreError } from "../../../ports/task-repository-ports";
import type {
  HistoryOwnerRead,
  TaskWorktreeOwnerReader,
} from "../../../ports/task-worktree-owner-port";
import type { TaskSessionLifecycleCoordinator } from "../worktrees/task-session-lifecycle-coordinator";

declare const ownerChecked: unique symbol;
/**
 * Worktree paths that passed the owner check under their lifecycle lock. Only
 * `acquireRemovableWorktrees` makes them, and `runTaskLocalCleanup` removes only these paths.
 */
export type OwnerCheckedWorktreePaths = readonly string[] & { readonly [ownerChecked]: true };

const markChecked = (paths: readonly string[]): OwnerCheckedWorktreePaths =>
  // SAFETY: callers pass paths that no other owner needs, or an empty list that removes nothing.
  paths as OwnerCheckedWorktreePaths;

/** A cleanup that keeps every worktree has nothing to check. */
export const noRemovedWorktrees = markChecked([]);

/**
 * Reads the others that need the worktrees, other than the tasks themselves. See
 * `HistoryOwnerRead` for the Claude chats whose native history uses a worktree.
 */
export const readTaskWorktreeOwners = (
  worktreeOwners: TaskWorktreeOwnerReader | undefined,
  input: {
    workspaceId: string;
    repoPath: string;
    taskIds: readonly string[];
    worktreePaths: readonly string[];
    history: HistoryOwnerRead;
  },
): Effect.Effect<TaskWorktreeOwners, HostError | TaskStoreError> =>
  Effect.gen(function* () {
    if (input.worktreePaths.length === 0)
      return { owners: emptyWorktreeOwners(), historyReadErrors: [] };
    if (!worktreeOwners) {
      return yield* new HostDependencyError({
        dependency: "worktreeOwners",
        operation: "task_worktree_owners",
        message: "The worktree owner reader is required to clean up task worktrees.",
      });
    }
    return yield* worktreeOwners.readOwners(input);
  });

/**
 * Takes the lifecycle of the worktrees, so no new chat can start there, then checks that no other
 * owner needs a worktree that the cleanup removes. Without the worktree, each runtime read of that
 * owner fails. A confirmed cleanup showed the Claude chats whose native history uses a worktree.
 * A cleanup that no user confirms also reads them and blocks on them. Call it before the cleanup
 * stops anything.
 */
export const acquireRemovableWorktrees = (
  dependencies: {
    lifecycle: Pick<TaskSessionLifecycleCoordinator, "acquireWorktreeLifecycle">;
    worktreeOwners: TaskWorktreeOwnerReader | undefined;
  },
  input: {
    workspaceId: string;
    repoPath: string;
    taskId: string;
    /** Completes "Cannot <operationLabel> task <taskId>". */
    operationLabel: string;
    lockedPaths: readonly string[];
    /** The locked paths that the cleanup removes. Defaults to all locked paths. */
    removedPaths?: readonly string[];
    confirmed: boolean;
  },
) =>
  Effect.gen(function* () {
    const { workspaceId, repoPath, taskId, operationLabel, confirmed } = input;
    const removedPaths = input.removedPaths ?? input.lockedPaths;
    yield* dependencies.lifecycle.acquireWorktreeLifecycle(input.lockedPaths);
    const { owners } = yield* readTaskWorktreeOwners(dependencies.worktreeOwners, {
      workspaceId,
      repoPath,
      taskIds: [taskId],
      worktreePaths: removedPaths,
      history: confirmed ? "none" : "required",
    });
    const lines = describeWorktreeOwners(owners);
    if (lines.length === 0) return markChecked(removedPaths);
    return yield* new HostValidationError({
      field: "taskId",
      message: `Cannot ${operationLabel} task ${taskId} because others still need its worktree. ${lines.map((line) => line.text).join(" ")}${confirmed ? "" : " Close the task yourself to confirm the removal."}`,
      details: {
        repoPath,
        taskId,
        sessionIds: [...owners.chats, ...owners.historyChats].map((chat) => chat.sessionId),
        taskIds: owners.tasks.map((task) => task.taskId),
      },
    });
  });
