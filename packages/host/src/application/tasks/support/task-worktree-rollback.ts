import { Data, Effect } from "effect";
import { errorMessage, HostOperationError } from "../../../effect/host-errors";
import type { GitPortError } from "../../../ports/git-port";
import type { WorktreeKeptForRunningActionsError } from "../../actions/worktree-action-runner";
import { removeWorktreeAndFilesystemPath } from "../../git/worktree-removal";
import type { requireBuildStartDependencies } from "./required-task-dependencies";

/** A rollback of a failed task start that could not undo everything. */
export type TaskStartRollbackError = TaskWorktreeRollbackError | WorktreeKeptForRunningActionsError;

type TaskWorktreeRollbackStepError =
  | GitPortError
  | Effect.Error<ReturnType<typeof removeWorktreeAndFilesystemPath>>;

/** A rollback of a new task worktree could not undo every step. */
export class TaskWorktreeRollbackError extends Data.TaggedError("TaskWorktreeRollbackError")<{
  readonly worktreePath: string;
  readonly branch: string;
  readonly message: string;
  readonly cause: readonly TaskWorktreeRollbackStepError[];
}> {}

/** Undoes a new task worktree. Each step runs, also after an earlier step fails. */
export const rollbackFailedTaskWorktree = (
  dependencies: ReturnType<typeof requireBuildStartDependencies>,
  repoPath: string,
  worktreePath: string,
  branch: string,
  createdTrackingRef: string | null,
  managedWorktreeBasePath: string,
): Effect.Effect<void, TaskWorktreeRollbackError> =>
  Effect.gen(function* () {
    const steps: Array<{
      description: string;
      run: Effect.Effect<unknown, TaskWorktreeRollbackStepError>;
    }> = [
      ...(createdTrackingRef
        ? [
            {
              description: `delete created upstream tracking ref ${createdTrackingRef}`,
              run: dependencies.gitPort.deleteReference(repoPath, createdTrackingRef),
            },
          ]
        : []),
      {
        description: `remove worktree ${worktreePath}`,
        run: removeWorktreeAndFilesystemPath(
          {
            gitPort: dependencies.gitPort,
            settingsConfig: dependencies.settingsConfig,
            worktreeFiles: dependencies.worktreeFiles,
          },
          {
            repoPath,
            worktreePath,
            force: true,
            managedWorktreeBasePath,
            missingOutsideManagedRootPathPolicy: "fail",
          },
        ),
      },
      {
        description: `delete branch ${branch}`,
        run: dependencies.gitPort.deleteLocalBranch(repoPath, branch, true),
      },
    ];
    const [, failures] = yield* Effect.partition(steps, ({ description, run }) =>
      run.pipe(Effect.mapError((cause) => ({ description, cause }))),
    );
    if (failures.length > 0) {
      return yield* new TaskWorktreeRollbackError({
        worktreePath,
        branch,
        message: failures
          .map(({ description, cause }) => `Also failed to ${description}: ${errorMessage(cause)}`)
          .join("\n"),
        cause: failures.map(({ cause }) => cause),
      });
    }
  });

/**
 * Rolls back a failed start, then fails with `failure`. When the rollback also fails, it fails with
 * the error that `withRollbackFailure` builds, so the user learns what to clean up.
 */
export const failAfterRollback = <E, F>(
  rollback: Effect.Effect<void, TaskStartRollbackError>,
  failure: E,
  withRollbackFailure: (rollbackFailure: TaskStartRollbackError) => F,
): Effect.Effect<never, E | F> =>
  rollback.pipe(Effect.mapError(withRollbackFailure), Effect.andThen(Effect.fail(failure)));

/** Fails with a `HostOperationError` after the rollback. A rollback failure adds to its message. */
export const failOperationAfterRollback = <Failure, Details extends object>(
  rollback: Effect.Effect<void, TaskStartRollbackError>,
  failure: Failure,
  error: { operation: string; details: Details },
): Effect.Effect<never, HostOperationError<Details>> =>
  failAfterRollback(
    rollback,
    new HostOperationError<Details>({ ...error, message: errorMessage(failure), cause: failure }),
    rollbackFailureError(failure, error),
  );

/** Builds the error of a failed start whose rollback also failed. */
export const rollbackFailureError =
  <Failure, Details extends object>(
    failure: Failure,
    error: { operation: string; details: Details },
  ) =>
  (rollbackFailure: TaskStartRollbackError): HostOperationError<Details> =>
    new HostOperationError<Details>({
      ...error,
      message: `${errorMessage(failure)}\n${rollbackFailure.message}`,
      cause: { failure, rollbackFailure },
    });
