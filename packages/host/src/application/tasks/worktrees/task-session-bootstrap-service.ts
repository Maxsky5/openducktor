import { taskSessionBootstrapSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../../domain/path-comparison";
import { buildBranchName } from "../../../domain/task";
import { errorMessage, HostOperationError, HostValidationError } from "../../../effect/host-errors";
import { resolveRuntimeDescriptorForTaskSession } from "../support/builder-worktree-cleanup";
import {
  prepareNewBuildWorktree,
  validateExistingGitBuildWorktree,
} from "../support/builder-worktree-start";
import {
  requireBuildStartDependencies,
  requireDependencies,
} from "../support/required-task-dependencies";
import { validateTaskTransitionEffect } from "../support/task-validation-effects";
import type { CreateTaskServiceInput, TaskService } from "../task-service";
import type { TaskSessionBootstrapReservation } from "./task-session-bootstrap-coordinator";

export const createTaskSessionBootstrapUseCase = ({
  gitPort,
  taskStore,
  settingsConfig,
  systemCommands,
  workspaceSettingsService,
  runtimeDefinitionsService,
  runtimeRegistry,
  worktreeFiles,
  taskSessionBootstrapCoordinator,
}: CreateTaskServiceInput): Pick<
  TaskService,
  "taskSessionBootstrapPrepare" | "taskSessionBootstrapComplete" | "taskSessionBootstrapAbort"
> => {
  if (!taskSessionBootstrapCoordinator) {
    throw new Error("Task session bootstrap coordinator is required.");
  }
  const coordinator = taskSessionBootstrapCoordinator;

  return {
    taskSessionBootstrapPrepare(input) {
      return Effect.gen(function* () {
        const { repoPath, taskId, runtimeKind, role } = input;
        const dependencies = yield* requireDependencies(() =>
          requireBuildStartDependencies(
            gitPort,
            runtimeDefinitionsService,
            runtimeRegistry,
            settingsConfig,
            systemCommands,
            worktreeFiles,
            workspaceSettingsService,
          ),
        );
        const descriptor = yield* resolveRuntimeDescriptorForTaskSession(
          dependencies.runtimeDefinitionsService,
          runtimeKind,
          role,
        );
        const repoConfig =
          yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
        const canonicalRepoPath = yield* dependencies.gitPort.canonicalizePath(repoConfig.repoPath);
        if (!(yield* dependencies.gitPort.isGitRepository(canonicalRepoPath))) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "repoPath",
              message: `Not a git repository: ${canonicalRepoPath}`,
              details: { repoPath: canonicalRepoPath, taskId, role },
            }),
          );
        }
        const worktreeBase = repoConfig.worktreeBasePath
          ? dependencies.settingsConfig.resolveConfiguredPath(repoConfig.worktreeBasePath)
          : dependencies.settingsConfig.defaultWorktreeBasePath(repoConfig.workspaceId);
        const worktreePath = dependencies.settingsConfig.join(worktreeBase, taskId);
        if (
          input.targetWorkingDirectory &&
          normalizePathForComparison(input.targetWorkingDirectory) !==
            normalizePathForComparison(worktreePath)
        ) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "targetWorkingDirectory",
              message: `Fresh ${role} sessions must use canonical task worktree ${worktreePath}.`,
              details: {
                taskId,
                role,
                expected: worktreePath,
                actual: input.targetWorkingDirectory,
              },
            }),
          );
        }
        const bootstrapId = crypto.randomUUID();
        yield* coordinator.acquireBootstrap(canonicalRepoPath, taskId, bootstrapId, role);
        const prepared = yield* Effect.either(
          Effect.gen(function* () {
            const task = yield* taskStore.getTask({ repoPath: canonicalRepoPath, taskId });
            if (role === "build") {
              yield* validateTaskTransitionEffect(task, [task], task.status, "in_progress");
            }
            yield* coordinator.attachBootstrapReservation({
              bootstrapId,
              canonicalRepoPath,
              taskId,
              role,
              preparedStatus: task.status,
              cleanup: () => Effect.succeed(""),
            });
            const branch = buildBranchName(repoConfig.branchPrefix, taskId, task.title);
            const exists = yield* dependencies.settingsConfig.pathExists(worktreePath);
            let cleanup: TaskSessionBootstrapReservation["cleanup"] = () => Effect.succeed("");
            if (exists) {
              if (!(yield* dependencies.gitPort.isGitRepository(worktreePath))) {
                return yield* Effect.fail(
                  new HostValidationError({
                    field: "taskId",
                    message: `Canonical task worktree path exists but is not a Git worktree: ${worktreePath}`,
                    details: { repoPath: canonicalRepoPath, taskId, role, worktreePath },
                  }),
                );
              }
              yield* validateExistingGitBuildWorktree(
                dependencies,
                canonicalRepoPath,
                worktreePath,
                taskId,
                branch,
              );
            } else {
              const newWorktree = yield* prepareNewBuildWorktree(
                dependencies,
                repoConfig,
                task,
                canonicalRepoPath,
                worktreeBase,
                worktreePath,
                branch,
              );
              cleanup = newWorktree.cleanup;
            }
            yield* coordinator.attachBootstrapReservation({
              bootstrapId,
              canonicalRepoPath,
              taskId,
              role,
              preparedStatus: task.status,
              cleanup,
            });
            yield* dependencies.runtimeRegistry
              .ensureWorkspaceRuntime({
                runtimeKind,
                repoPath: canonicalRepoPath,
                workingDirectory: canonicalRepoPath,
                descriptor,
              })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new HostOperationError({
                      operation: "task.session_bootstrap.ensure_runtime",
                      message: `${runtimeKind} ${role} runtime failed to start for task ${taskId}`,
                      cause,
                      details: { repoPath: canonicalRepoPath, taskId, role, runtimeKind },
                    }),
                ),
              );
            return yield* Effect.try({
              try: () =>
                taskSessionBootstrapSchema.parse({
                  bootstrapId,
                  role,
                  runtimeKind,
                  workingDirectory: worktreePath,
                }),
              catch: (cause) =>
                new HostValidationError({
                  message: cause instanceof Error ? cause.message : String(cause),
                  cause,
                }),
            });
          }),
        );
        if (prepared._tag === "Right") {
          return prepared.right;
        }
        const active = yield* coordinator.inspectBootstrap(canonicalRepoPath, taskId, bootstrapId);
        const cleanupError =
          active.state === "active" && active.reservation
            ? yield* active.reservation.cleanup()
            : "";
        yield* coordinator.releaseBootstrap(canonicalRepoPath, taskId, bootstrapId);
        return yield* Effect.fail(
          new HostOperationError({
            operation: "task.session_bootstrap.prepare",
            message: `${errorMessage(prepared.left)}${cleanupError}`,
            cause: prepared.left,
            details: { repoPath: canonicalRepoPath, taskId, role, worktreePath },
          }),
        );
      });
    },
    taskSessionBootstrapComplete({ repoPath, taskId, bootstrapId }) {
      return Effect.gen(function* () {
        if (!gitPort) {
          return yield* Effect.fail(new HostValidationError({ message: "Git port is required." }));
        }
        const canonicalRepoPath = yield* gitPort.canonicalizePath(repoPath);
        const current = yield* coordinator.inspectBootstrap(canonicalRepoPath, taskId, bootstrapId);
        const terminalOutcome = current.state === "terminal" ? current.terminal : undefined;
        if (terminalOutcome?.outcome === "completed") return true;
        if (terminalOutcome?.outcome === "aborted" || terminalOutcome?.outcome === "abort_failed") {
          return yield* Effect.fail(
            new HostValidationError({
              field: "bootstrapId",
              message: `Task session bootstrap ${bootstrapId} was already aborted.`,
            }),
          );
        }
        const reservation = current.state === "active" ? current.reservation : undefined;
        if (!reservation) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "bootstrapId",
              message: `Unknown or mismatched task session bootstrap for task ${taskId}.`,
              details: { repoPath: canonicalRepoPath, taskId, bootstrapId },
            }),
          );
        }
        if (reservation.role === "build") {
          const task = yield* taskStore.getTask({ repoPath: canonicalRepoPath, taskId });
          if (task.status !== reservation.preparedStatus) {
            return yield* Effect.fail(
              new HostOperationError({
                operation: "task.session_bootstrap.complete",
                message: `Task ${taskId} changed from ${reservation.preparedStatus} to ${task.status} while Builder startup was in progress.`,
                details: { repoPath: canonicalRepoPath, taskId, bootstrapId },
              }),
            );
          }
          yield* validateTaskTransitionEffect(task, [task], task.status, "in_progress");
          yield* taskStore.transitionTask({
            repoPath: canonicalRepoPath,
            taskId,
            status: "in_progress",
          });
        }
        yield* coordinator.finishBootstrap(canonicalRepoPath, taskId, bootstrapId, "completed");
        return true;
      });
    },
    taskSessionBootstrapAbort({ repoPath, taskId, bootstrapId }) {
      return Effect.gen(function* () {
        if (!gitPort) {
          return yield* Effect.fail(new HostValidationError({ message: "Git port is required." }));
        }
        const canonicalRepoPath = yield* gitPort.canonicalizePath(repoPath);
        const current = yield* coordinator.inspectBootstrap(canonicalRepoPath, taskId, bootstrapId);
        const terminalOutcome = current.state === "terminal" ? current.terminal : undefined;
        if (terminalOutcome?.outcome === "abort_failed") {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "task.session_bootstrap.abort",
              message:
                terminalOutcome.failureMessage ??
                "Task session bootstrap rollback did not complete.",
            }),
          );
        }
        if (terminalOutcome?.outcome === "aborted" || terminalOutcome?.outcome === "completed")
          return true;
        const reservation = current.state === "active" ? current.reservation : undefined;
        if (!reservation) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "bootstrapId",
              message: `Unknown or mismatched task session bootstrap for task ${taskId}.`,
              details: { repoPath: canonicalRepoPath, taskId, bootstrapId },
            }),
          );
        }
        const cleanupError = yield* reservation.cleanup();
        if (cleanupError) {
          yield* coordinator.finishBootstrap(
            canonicalRepoPath,
            taskId,
            bootstrapId,
            "abort_failed",
            `Task session bootstrap rollback did not complete.${cleanupError}`,
          );
          return yield* Effect.fail(
            new HostOperationError({
              operation: "task.session_bootstrap.abort",
              message: `Task session bootstrap rollback did not complete.${cleanupError}`,
              details: { repoPath: canonicalRepoPath, taskId, bootstrapId },
            }),
          );
        }
        yield* coordinator.finishBootstrap(canonicalRepoPath, taskId, bootstrapId, "aborted");
        return true;
      });
    },
  };
};
