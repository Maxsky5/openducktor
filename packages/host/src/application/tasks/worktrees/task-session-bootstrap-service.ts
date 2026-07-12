import { type AgentRole, taskSessionBootstrapSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../../domain/path-comparison";
import { buildBranchName } from "../../../domain/task";
import { errorMessage, HostOperationError, HostValidationError } from "../../../effect/host-errors";
import {
  resolveRuntimeDescriptorForTaskSession,
  type rollbackFailedBuildWorktree,
} from "../support/builder-worktree-cleanup";
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

type Reservation = {
  bootstrapId: string;
  canonicalRepoPath: string;
  taskId: string;
  role: AgentRole;
  cleanup: () => ReturnType<typeof rollbackFailedBuildWorktree>;
};

export const createTaskSessionBootstrapUseCase = ({
  gitPort,
  taskStore,
  settingsConfig,
  systemCommands,
  workspaceSettingsService,
  runtimeDefinitionsService,
  runtimeRegistry,
  worktreeFiles,
}: CreateTaskServiceInput): Pick<
  TaskService,
  "taskSessionBootstrapPrepare" | "taskSessionBootstrapComplete" | "taskSessionBootstrapAbort"
> => {
  const reservations = new Map<string, Reservation>();
  const reservationKey = (repoPath: string, taskId: string): string => `${repoPath}\0${taskId}`;

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
        const task = yield* taskStore.getTask({ repoPath: canonicalRepoPath, taskId });
        if (role === "build") {
          yield* validateTaskTransitionEffect(task, [task], task.status, "in_progress");
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
        const key = reservationKey(canonicalRepoPath, taskId);
        const activeReservation = reservations.get(key);
        if (activeReservation) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "task.session_bootstrap.prepare",
              message: `Task session bootstrap is already in progress for task ${taskId} (${activeReservation.role}).`,
              details: {
                repoPath: canonicalRepoPath,
                taskId,
                role,
                activeRole: activeReservation.role,
              },
            }),
          );
        }
        const bootstrapId = crypto.randomUUID();
        reservations.set(key, {
          bootstrapId,
          canonicalRepoPath,
          taskId,
          role,
          cleanup: () => Effect.succeed(""),
        });
        const prepared = yield* Effect.either(
          Effect.gen(function* () {
            const branch = buildBranchName(repoConfig.branchPrefix, taskId, task.title);
            const exists = yield* dependencies.settingsConfig.pathExists(worktreePath);
            let cleanup: Reservation["cleanup"] = () => Effect.succeed("");
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
            reservations.set(key, {
              bootstrapId,
              canonicalRepoPath,
              taskId,
              role,
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
        const reservation = reservations.get(key);
        const cleanupError = reservation ? yield* reservation.cleanup() : "";
        reservations.delete(key);
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
        const key = reservationKey(canonicalRepoPath, taskId);
        const reservation = reservations.get(key);
        if (!reservation || reservation.bootstrapId !== bootstrapId) {
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
          if (task.status !== "in_progress") {
            yield* taskStore.transitionTask({
              repoPath: canonicalRepoPath,
              taskId,
              status: "in_progress",
            });
          }
        }
        reservations.delete(key);
        return true;
      });
    },
    taskSessionBootstrapAbort({ repoPath, taskId, bootstrapId }) {
      return Effect.gen(function* () {
        if (!gitPort) {
          return yield* Effect.fail(new HostValidationError({ message: "Git port is required." }));
        }
        const canonicalRepoPath = yield* gitPort.canonicalizePath(repoPath);
        const key = reservationKey(canonicalRepoPath, taskId);
        const reservation = reservations.get(key);
        if (!reservation || reservation.bootstrapId !== bootstrapId) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "bootstrapId",
              message: `Unknown or mismatched task session bootstrap for task ${taskId}.`,
              details: { repoPath: canonicalRepoPath, taskId, bootstrapId },
            }),
          );
        }
        const cleanupError = yield* reservation.cleanup();
        reservations.delete(key);
        if (cleanupError) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "task.session_bootstrap.abort",
              message: `Task session bootstrap rollback did not complete.${cleanupError}`,
              details: { repoPath: canonicalRepoPath, taskId, bootstrapId },
            }),
          );
        }
        return true;
      });
    },
  };
};
