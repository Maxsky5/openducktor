import type {
  AgentSessionControlStartInput,
  AgentSessionControlStopInput,
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
} from "./task-workflow-session-control-service";

const controlSessionRef = (
  repoPath: string,
  summary: AgentSessionControlSummary,
): AgentSessionControlStopInput => ({
  repoPath,
  runtimeKind: summary.runtimeKind,
  workingDirectory: summary.workingDirectory,
  externalSessionId: summary.externalSessionId,
});

const storeFreshWorkflowSession = (
  tasks: TaskSessions,
  input: AgentWorkflowSessionStartInput,
  repoPath: string,
  summary: AgentSessionControlSummary,
) =>
  tasks
    .agentSessionUpsert({
      repoPath,
      taskId: input.sessionScope.taskId,
      session: {
        externalSessionId: summary.externalSessionId,
        role: input.sessionScope.role,
        startedAt: summary.startedAt,
        runtimeKind: summary.runtimeKind,
        workingDirectory: summary.workingDirectory,
        selectedModel: { ...input.model, runtimeKind: summary.runtimeKind },
      },
    })
    .pipe(Effect.asVoid);

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
              yield* runtime.stopSession(controlSessionRef(repoPath, summary));
            }
            yield* prepared.cleanup();
          });

        return yield* Effect.gen(function* () {
          const preparationInput: TaskSessionStartPreparationInput = {
            repoPath,
            taskId: scope.taskId,
            role: scope.role,
            runtimeKind: input.runtimeKind,
          };
          if (input.targetWorkingDirectory) {
            preparationInput.targetWorkingDirectory = input.targetWorkingDirectory;
          }
          prepared = yield* taskSessionStart.prepare(preparationInput, repoPath);
          const runtimeInput: AgentSessionControlStartInput = {
            repoPath,
            runtimeKind: prepared.runtimeKind,
            workingDirectory: prepared.workingDirectory,
            sessionScope: scope,
            systemPrompt: input.systemPrompt,
            model: input.model,
          };
          const launched = yield* Effect.either(runtime.startSession(runtimeInput));
          if (launched._tag === "Left") {
            const cleanupError = yield* prepared.cleanup();
            if (!cleanupError) {
              return yield* Effect.fail(launched.left);
            }
            return yield* Effect.fail(
              new HostOperationError({
                operation: "task-workflow-session.start",
                message: `${launched.left.message}${cleanupError}`,
                cause: launched.left,
                details: { repoPath, taskId: scope.taskId },
              }),
            );
          }
          summary = launched.right;

          const persisted = yield* Effect.either(
            storeFreshWorkflowSession(tasks, input, repoPath, summary),
          );
          if (persisted._tag === "Left") {
            const stopped = yield* Effect.either(
              runtime.stopSession(controlSessionRef(repoPath, summary)),
            );
            const cleanupError = stopped._tag === "Right" ? yield* prepared.cleanup() : "";
            if (stopped._tag === "Right" && !cleanupError) {
              return yield* Effect.fail(persisted.left);
            }
            return yield* Effect.fail(
              new HostOperationError({
                operation: "task-workflow-session.store-control-result",
                message: `${errorMessage(persisted.left)}${
                  stopped._tag === "Left"
                    ? ` Cleanup failed: ${stopped.left.message}`
                    : cleanupError
                }`,
                cause: {
                  storeFailure: persisted.left,
                  stopFailure: stopped._tag === "Left" ? stopped.left : undefined,
                },
                details: {
                  repoPath,
                  taskId: scope.taskId,
                  externalSessionId: summary.externalSessionId,
                },
              }),
            );
          }
          stored = true;

          const completed = yield* Effect.either(
            taskSessionStart.complete(prepared, (transitionInput) =>
              tasks.transitionTask(transitionInput),
            ),
          );
          if (completed._tag === "Left") {
            const stopped = yield* Effect.either(
              runtime.stopSession(controlSessionRef(repoPath, summary)),
            );
            if (stopped._tag === "Right") {
              return yield* Effect.fail(completed.left);
            }
            return yield* Effect.fail(
              new HostOperationError({
                operation: "task-workflow-session.complete-start",
                message: `${errorMessage(completed.left)} Cleanup failed: ${stopped.left.message}`,
                cause: { completionFailure: completed.left, stopFailure: stopped.left },
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
              ? runtime.stopSession(controlSessionRef(repoPath, summary))
              : cleanupUnstoredStart()
            ).pipe(Effect.orDie, Effect.asVoid),
          ),
        );
      }),
    );
