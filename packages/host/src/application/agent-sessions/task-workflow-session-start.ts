import type {
  AgentSessionControlStartInput,
  AgentSessionControlSummary,
  AgentWorkflowSessionStartInput,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import type { TaskServiceError } from "../tasks/task-service";
import type {
  PreparedTaskSessionStart,
  TaskSessionStartPreparationInput,
  TaskSessionStartPreparationService,
} from "../tasks/worktrees/task-session-start-preparation-service";
import type {
  CanonicalizeRepoPath,
  RuntimeControl,
  TaskLifecycle,
  TaskSessions,
} from "./task-workflow-session-policy";
import { storeWorkflowSession, toControlSessionRef } from "./task-workflow-session-storage";

export const createStartTaskWorkflowSession =
  ({
    canonicalizeRepoPath,
    runtime,
    tasks,
    taskLifecycle,
    taskSessionStart,
  }: {
    canonicalizeRepoPath: CanonicalizeRepoPath;
    runtime: RuntimeControl;
    tasks: TaskSessions;
    taskLifecycle: TaskLifecycle;
    taskSessionStart: TaskSessionStartPreparationService;
  }) =>
  (
    input: AgentWorkflowSessionStartInput,
  ): Effect.Effect<AgentSessionControlSummary, TaskServiceError> =>
    Effect.scoped(
      Effect.gen(function* () {
        const scope = input.sessionScope;
        const repoPath = yield* canonicalizeRepoPath(input.repoPath);
        yield* taskLifecycle.acquireLifecycle(repoPath, [scope.taskId], "start session");
        let prepared: PreparedTaskSessionStart | null = null;
        let summary: AgentSessionControlSummary | null = null;
        let stored = false;

        const cleanupUnstoredStart = () =>
          Effect.gen(function* () {
            if (!prepared) {
              return;
            }
            if (summary) {
              yield* runtime.stopSession(toControlSessionRef(repoPath, summary));
            }
            yield* prepared.cleanup();
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
          prepared = yield* taskSessionStart.prepare(preparationInput);
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
            summary = yield* runtime.startSession(runtimeInput);
            return summary;
          }).pipe(Effect.uninterruptible, Effect.result);
          if (launched._tag === "Failure") {
            const cleanupError = yield* prepared.cleanup();
            if (!cleanupError) {
              return yield* Effect.fail(launched.failure);
            }
            return yield* Effect.fail(
              new HostOperationError({
                operation: "task-workflow-session.start",
                message: `${launched.failure.message}${cleanupError}`,
                cause: launched.failure,
                details: { repoPath, taskId: scope.taskId },
              }),
            );
          }
          summary = launched.success;

          const persisted = yield* Effect.gen(function* () {
            yield* storeWorkflowSession(tasks, {
              repoPath,
              sessionScope: input.sessionScope,
              model: input.model,
              selectedModel: undefined,
              summary: launched.success,
            });
            stored = true;
          }).pipe(Effect.uninterruptible, Effect.result);
          if (persisted._tag === "Failure") {
            const stopped = yield* Effect.result(
              runtime.stopSession(toControlSessionRef(repoPath, summary)),
            );
            const cleanupError = stopped._tag === "Success" ? yield* prepared.cleanup() : "";
            if (stopped._tag === "Success" && !cleanupError) {
              return yield* Effect.fail(persisted.failure);
            }
            return yield* Effect.fail(
              new HostOperationError({
                operation: "task-workflow-session.store-control-result",
                message: `${errorMessage(persisted.failure)}${
                  stopped._tag === "Failure"
                    ? ` Cleanup failed: ${stopped.failure.message}`
                    : cleanupError
                }`,
                cause: {
                  storeFailure: persisted.failure,
                  stopFailure: stopped._tag === "Failure" ? stopped.failure : undefined,
                },
                details: {
                  repoPath,
                  taskId: scope.taskId,
                  externalSessionId: summary.externalSessionId,
                },
              }),
            );
          }
          const completed = yield* Effect.result(
            taskSessionStart.complete(prepared, (transitionInput) =>
              tasks.transitionTask(transitionInput),
            ),
          );
          if (completed._tag === "Failure") {
            const stopped = yield* Effect.result(
              runtime.stopSession(toControlSessionRef(repoPath, summary)),
            );
            if (stopped._tag === "Success") {
              return yield* Effect.fail(completed.failure);
            }
            return yield* Effect.fail(
              new HostOperationError({
                operation: "task-workflow-session.complete-start",
                message: `${errorMessage(completed.failure)} Cleanup failed: ${stopped.failure.message}`,
                cause: { completionFailure: completed.failure, stopFailure: stopped.failure },
                details: {
                  repoPath,
                  taskId: scope.taskId,
                  externalSessionId: summary.externalSessionId,
                },
              }),
            );
          }
          return summary;
        }).pipe(
          Effect.onInterrupt(() =>
            (stored && summary
              ? runtime.stopSession(toControlSessionRef(repoPath, summary))
              : cleanupUnstoredStart()
            ).pipe(Effect.orDie, Effect.asVoid),
          ),
        );
      }),
    );
