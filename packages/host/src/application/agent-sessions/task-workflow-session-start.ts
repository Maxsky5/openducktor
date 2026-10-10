import type {
  AgentSessionControlStartInput,
  AgentSessionControlSummary,
  AgentWorkflowSessionStartInput,
} from "@openducktor/contracts";
import { TaskSessionOwnershipCommittedError } from "./task-session-ownership-error";
import { Effect } from "effect";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import { failAfterRollback, rollbackFailureError } from "../tasks/support/task-worktree-rollback";
import type { TaskServiceError } from "../tasks/task-service";
import type {
  PreparedTaskSessionStart,
  TaskSessionStartPreparationInput,
  TaskSessionStartPreparationService,
} from "../tasks/worktrees/task-session-start-preparation-service";
import type {
  TaskSessionWrites,
  TaskSessionProgress,
  PreparedTaskSession,
  CanonicalizeRepoPath,
  RuntimeControl,
  TaskLifecycle,
} from "./task-session-operations";
import { storeWorkflowSession, toControlSessionRef } from "./task-workflow-session-storage";

export const createStartTaskWorkflowSession =
  ({
    canonicalizeRepoPath,
    runtime,
    writes,
    taskLifecycle,
    taskSessionStart,
  }: {
    canonicalizeRepoPath: CanonicalizeRepoPath;
    runtime: Pick<RuntimeControl, "startSession">;
    writes: TaskSessionWrites;
    taskLifecycle: TaskLifecycle;
    taskSessionStart: Pick<TaskSessionStartPreparationService, "prepare" | "complete">;
  }) =>
  (
    input: AgentWorkflowSessionStartInput,
    progress: TaskSessionProgress,
  ): Effect.Effect<PreparedTaskSession, TaskServiceError> =>
    Effect.scoped(
      Effect.gen(function* () {
        const scope = input.sessionScope;
        const repoPath = yield* canonicalizeRepoPath(input.repoPath);
        yield* taskLifecycle.acquireLifecycle(repoPath, [scope.taskId], "start session");
        let prepared: PreparedTaskSessionStart | null = null;
        let summary: AgentSessionControlSummary | null = null;
        let stored = false;
        const publications: Array<Effect.Effect<void, TaskServiceError>> = [];
        const publishAll = Effect.forEach(publications, (publish) => publish, { discard: true });

        const cleanupUnstoredStart = () =>
          Effect.gen(function* () {
            if (!prepared) {
              return;
            }
            if (summary) {
              yield* progress.stop(toControlSessionRef(repoPath, summary));
            }
            yield* prepared.rollback();
          });

        return yield* Effect.gen(function* () {
          const preparationInput: TaskSessionStartPreparationInput = {
            canonicalRepoPath: repoPath,
            taskId: scope.taskId,
            role: scope.role,
            runtimeKind: input.runtimeKind,
          };
          if (input.targetWorkingDirectory) {
            preparationInput.targetWorkingDirectory = input.targetWorkingDirectory;
          }
          // Record the prepared worktree before an interruption can skip its rollback.
          prepared = yield* Effect.uninterruptibleMask((restore) =>
            restore(taskSessionStart.prepare(preparationInput)).pipe(
              Effect.tap((value) =>
                Effect.sync(() => {
                  prepared = value;
                }),
              ),
            ),
          );
          const runtimeInput: AgentSessionControlStartInput = {
            repoPath,
            runtimeKind: prepared.runtimeKind,
            workingDirectory: prepared.workingDirectory,
            sessionScope: scope,
            systemPrompt: input.systemPrompt,
            model: input.model,
          };
          // Cancellation must retain the returned identity so cleanup can stop the session.
          const launched = yield* Effect.gen(function* () {
            yield* progress.checkCanceled();
            summary = yield* runtime.startSession(runtimeInput);
            return summary;
          }).pipe(Effect.uninterruptible, Effect.result);
          if (launched._tag === "Failure") {
            return yield* failAfterRollback(
              prepared.rollback(),
              launched.failure,
              rollbackFailureError(launched.failure, {
                operation: "task-workflow-session.start",
                details: { repoPath, taskId: scope.taskId },
              }),
            );
          }
          summary = launched.success;

          const persisted = yield* Effect.gen(function* () {
            yield* progress.created(launched.success);
            yield* progress.checkCanceled();
            const saved = yield* storeWorkflowSession(writes.saveSession, {
              repoPath,
              sessionScope: input.sessionScope,
              model: input.model,
              selectedModel: undefined,
              summary: launched.success,
            });
            stored = true;
            progress.saved();
            publications.push(saved.publish);
          }).pipe(Effect.uninterruptible, Effect.result);
          if (persisted._tag === "Failure") {
            if (persisted.failure instanceof TaskSessionOwnershipCommittedError) {
              stored = true;
              return yield* Effect.fail(persisted.failure);
            }
            const storeFailure = persisted.failure;
            const storeError = {
              operation: "task-workflow-session.store-control-result",
              details: {
                repoPath,
                taskId: scope.taskId,
                externalSessionId: summary.externalSessionId,
              },
            };
            // The worktree rollback runs only after the runtime session stops.
            return yield* progress.stop(toControlSessionRef(repoPath, summary)).pipe(
              Effect.mapError(
                (stopFailure) =>
                  new HostOperationError({
                    ...storeError,
                    message: `${errorMessage(storeFailure)} Cleanup failed: ${stopFailure.message}`,
                    cause: { storeFailure, stopFailure },
                  }),
              ),
              Effect.andThen(
                failAfterRollback(
                  prepared.rollback(),
                  storeFailure,
                  (rollbackFailure) =>
                    new HostOperationError({
                      ...storeError,
                      message: `${errorMessage(storeFailure)}\n${rollbackFailure.message}`,
                      cause: { storeFailure, rollbackFailure },
                    }),
                ),
              ),
            );
          }
          const completed = yield* Effect.result(
            taskSessionStart.complete(prepared, (transitionInput) =>
              writes.transitionTask(transitionInput).pipe(
                Effect.map(({ task, publish }) => {
                  publications.push(publish);
                  return task;
                }),
              ),
            ),
          );
          if (completed._tag === "Failure") {
            const stopped = yield* Effect.result(
              progress.stop(toControlSessionRef(repoPath, summary)),
            );
            // The saved ownership remains, so readers must still receive it.
            const published = yield* Effect.result(publishAll);
            const cleanupFailures = [stopped, published].flatMap((result) =>
              result._tag === "Failure" ? [result.failure] : [],
            );
            if (cleanupFailures.length === 0) {
              return yield* Effect.fail(completed.failure);
            }
            return yield* Effect.fail(
              new HostOperationError({
                operation: "task-workflow-session.complete-start",
                message: `${errorMessage(completed.failure)} Cleanup failed: ${cleanupFailures.map((failure) => failure.message).join(" ")}`,
                cause: { completionFailure: completed.failure, cleanupFailures },
                details: {
                  repoPath,
                  taskId: scope.taskId,
                  externalSessionId: summary.externalSessionId,
                },
              }),
            );
          }
          return { session: summary, publish: publishAll };
        }).pipe(
          Effect.onInterrupt(() =>
            (stored && summary
              ? progress.stop(toControlSessionRef(repoPath, summary))
              : cleanupUnstoredStart()
            ).pipe(Effect.orDie, Effect.asVoid),
          ),
        );
      }),
    );
