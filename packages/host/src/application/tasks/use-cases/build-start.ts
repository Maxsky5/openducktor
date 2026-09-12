import { type BuildSessionBootstrap, buildSessionBootstrapSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  errorMessage,
  HostOperationError,
  type HostValidationErrorAggregate,
} from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { TaskStorePort } from "../../../ports/task-repository-ports";
import type { BuildStartInput } from "../task-inputs";
import type { TaskServiceError } from "../task-service";
import type { TaskSessionLifecycleCoordinator } from "../worktrees/task-session-lifecycle-coordinator";
import type {
  TaskSessionStartPreparationInput,
  TaskSessionStartPreparationService,
} from "../worktrees/task-session-start-preparation-service";

export const createTaskBuildStartUseCase =
  ({
    gitPort,
    taskSessionLifecycleCoordinator,
    taskSessionStart,
    taskStore,
    withWorkStartLease,
  }: {
    gitPort: GitPort | undefined;
    taskSessionLifecycleCoordinator: TaskSessionLifecycleCoordinator;
    taskSessionStart: TaskSessionStartPreparationService;
    taskStore: Pick<TaskStorePort, "transitionTask">;
    withWorkStartLease<A, E, R>(
      repoPath: string,
      effect: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | HostValidationErrorAggregate, R>;
  }) =>
  (startInput: BuildStartInput): Effect.Effect<BuildSessionBootstrap, TaskServiceError> =>
    Effect.scoped(
      Effect.gen(function* () {
        if (!gitPort) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "task.build_start",
              message: "Git port is required for build_start.",
            }),
          );
        }
        const canonicalRepoPath = yield* gitPort.canonicalizePath(startInput.repoPath);
        return yield* withWorkStartLease(
          canonicalRepoPath,
          Effect.gen(function* () {
            yield* taskSessionLifecycleCoordinator.acquireLifecycle(
              canonicalRepoPath,
              [startInput.taskId],
              "start build",
            );
            const preparationInput: TaskSessionStartPreparationInput = {
              canonicalRepoPath,
              taskId: startInput.taskId,
              role: "build",
              runtimeKind: startInput.runtimeKind,
            };
            const prepared = yield* taskSessionStart.prepare(preparationInput);
            let cleanup = prepared.cleanup;
            const completion = yield* Effect.gen(function* () {
              yield* taskSessionStart.complete(prepared, (transitionInput) =>
                taskStore.transitionTask(transitionInput),
              );
              // A committed build retains its worktree when cancellation arrives.
              cleanup = () => Effect.succeed("");
              return buildSessionBootstrapSchema.parse({
                runtimeKind: prepared.runtimeKind,
                workingDirectory: prepared.workingDirectory,
              });
            }).pipe(
              Effect.either,
              Effect.uninterruptible,
              Effect.onInterrupt(() => cleanup().pipe(Effect.orDie, Effect.asVoid)),
            );
            if (completion._tag === "Right") {
              return completion.right;
            }
            const cleanupError = yield* cleanup();
            return yield* Effect.fail(
              new HostOperationError({
                operation: "task.build_start.finalize",
                message: `${errorMessage(completion.left)}${cleanupError}`,
                cause: completion.left,
                details: { repoPath: canonicalRepoPath, taskId: startInput.taskId },
              }),
            );
          }),
        );
      }),
    );
