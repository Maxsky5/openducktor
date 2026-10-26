import type {
  AgentSessionControlStartInput,
  AgentSessionControlSummary,
  AgentWorkflowSessionStartInput,
} from "@openducktor/contracts";
import { TaskSessionOwnershipCommittedError } from "./task-session-ownership-error";
import { Effect } from "effect";
import { startupStep, stopStartupSession } from "./session-startup-progress";
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
    runtime: Pick<RuntimeControl, "startSession" | "releaseSession">;
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
              const ref = toControlSessionRef(repoPath, summary);
              yield* stopStartupSession(ref, progress.stop(ref));
              yield* runtime.releaseSession(ref);
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
          const runtimeInput: AgentSessionControlStartInput &
            import("@openducktor/core").AgentWorkStartOptions = {
            repoPath,
            runtimeKind: prepared.runtimeKind,
            workingDirectory: prepared.workingDirectory,
            sessionScope: scope,
            systemPrompt: input.systemPrompt,
            model: input.model,
            workStartGuard: progress.workStartGuard,
          };
          // Cancellation must retain the returned identity so cleanup can stop the session.
          const launched = yield* Effect.gen(function* () {
            yield* progress.checkCanceled();
            summary = yield* startupStep(
              { id: "prepare", label: "Prepare native session" },
              runtime.startSession(runtimeInput),
            );
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
              progress.saved();
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
            const ref = toControlSessionRef(repoPath, summary);
            return yield* stopStartupSession(ref, progress.stop(ref)).pipe(
              Effect.andThen(runtime.releaseSession(ref)),
              Effect.mapError(
                (cleanupFailure) =>
                  new HostOperationError({
                    ...storeError,
                    message: `${errorMessage(storeFailure)} Cleanup failed: ${cleanupFailure.message}`,
                    cause: { storeFailure, cleanupFailure },
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
            startupStep(
              { id: "workflow", label: "Apply task workflow updates" },
              taskSessionStart.complete(prepared, (start) =>
                writes.applyStartEvent(start).pipe(
                  Effect.map(({ task, publish }) => {
                    publications.push(publish);
                    return task;
                  }),
                ),
              ),
            ),
          );
          if (completed._tag === "Failure") {
            const stopped = yield* Effect.result(
              stopStartupSession(
                toControlSessionRef(repoPath, summary),
                progress.stop(toControlSessionRef(repoPath, summary)),
              ),
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
              ? stopStartupSession(
                  toControlSessionRef(repoPath, summary),
                  progress.stop(toControlSessionRef(repoPath, summary)),
                )
              : cleanupUnstoredStart()
            ).pipe(Effect.orDie, Effect.asVoid),
          ),
        );
      }),
    );
