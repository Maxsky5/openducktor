import { buildSessionBootstrapSchema } from "@openducktor/contracts";
import type { TaskWorkflow } from "@openducktor/workflows";
import { Effect } from "effect";
import { TaskPolicyError } from "../../../domain/task/task-policy-error";
import { HostOperationError } from "../../../effect/host-errors";
import { failOperationAfterRollback } from "../support/task-worktree-rollback";
import { requireEffectEvent } from "../support/task-workflow-events";
import { applyTaskEvent } from "../support/task-workflow-helpers";
import type { BuildStartInput } from "../task-inputs";
import type { TaskService, TaskServiceUseCaseInput } from "../task-service";
import {
  createTaskSessionStartPreparationService,
  type TaskSessionStartPreparationInput,
} from "../worktrees/task-session-start-preparation-service";

export const createTaskBuildStartUseCase = (
  input: TaskServiceUseCaseInput,
): Pick<TaskService, "buildStart"> => {
  const { gitPort, taskSessionLifecycleCoordinator } = input;
  const taskSessionStart = createTaskSessionStartPreparationService(input);
  return {
    buildStart: (startInput: BuildStartInput) =>
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
          yield* taskSessionLifecycleCoordinator.acquireLifecycle(
            canonicalRepoPath,
            [startInput.taskId],
            "start build",
          );
          const task = yield* input.taskStore.getTask({
            workspaceId: startInput.workspaceId,
            repoPath: canonicalRepoPath,
            taskId: startInput.taskId,
          });
          const role = yield* requireBuildStartRole(input.taskWorkflows.forTask(task));
          const preparationInput: TaskSessionStartPreparationInput = {
            workspaceId: startInput.workspaceId,
            canonicalRepoPath,
            taskId: startInput.taskId,
            role,
            runtimeKind: startInput.runtimeKind,
          };
          const prepared = yield* taskSessionStart.prepare(preparationInput);
          let rollback = prepared.rollback;
          const completion = yield* Effect.gen(function* () {
            yield* taskSessionStart.complete(
              prepared,
              ({ workspaceId, repoPath, taskId, eventId }) =>
                applyTaskEvent(
                  input.taskStore,
                  input.taskWorkflows,
                  { workspaceId, repoPath, taskId },
                  eventId,
                ),
            );
            // A committed build retains its worktree when cancellation arrives.
            rollback = () => Effect.void;
            return buildSessionBootstrapSchema.parse({
              runtimeKind: prepared.runtimeKind,
              workingDirectory: prepared.workingDirectory,
            });
          }).pipe(
            Effect.result,
            Effect.uninterruptible,
            Effect.onInterrupt(() => rollback().pipe(Effect.orDie)),
          );
          if (completion._tag === "Success") {
            return completion.success;
          }
          return yield* failOperationAfterRollback(rollback(), completion.failure, {
            operation: "task.build_start.finalize",
            details: { repoPath: canonicalRepoPath, taskId: startInput.taskId },
          });
        }),
      ),
  };
};

const requireBuildStartRole = (workflow: TaskWorkflow) =>
  requireEffectEvent(workflow, "build.start").pipe(
    Effect.flatMap((eventId) => {
      const role = workflow.startEventRole(eventId);
      return role === undefined
        ? Effect.fail(
            TaskPolicyError.policy(
              `Task workflow "${workflow.definition.id}" starts no step with its build.start event. Name it as the startEventId of a step.`,
            ),
          )
        : Effect.succeed(role);
    }),
  );
