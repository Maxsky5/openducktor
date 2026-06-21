import { buildSessionBootstrapSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { buildBranchName } from "../../../domain/task";
import { errorMessage, HostOperationError, HostValidationError } from "../../../effect/host-errors";
import { resolveRuntimeDescriptorForBuild } from "../support/builder-worktree-cleanup";
import {
  type PreparedBuildWorktree,
  prepareNewBuildWorktree,
  validateExistingBuildWorktree,
} from "../support/builder-worktree-start";
import {
  requireBuildStartDependencies,
  requireDependencies,
} from "../support/required-task-dependencies";
import { validateTaskTransitionEffect } from "../support/task-validation-effects";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskBuildStartUseCase = ({
  gitPort,
  taskStore,
  settingsConfig,
  systemCommands,
  workspaceSettingsService,
  runtimeDefinitionsService,
  runtimeRegistry,
  worktreeFiles,
}: CreateTaskServiceInput): Pick<TaskService, "buildStart"> => ({
  buildStart(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, runtimeKind } = input;
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
      const descriptor = yield* resolveRuntimeDescriptorForBuild(
        dependencies.runtimeDefinitionsService,
        runtimeKind,
      );
      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const canonicalRepoPath = yield* dependencies.gitPort.canonicalizePath(repoConfig.repoPath);
      if (!(yield* dependencies.gitPort.isGitRepository(canonicalRepoPath))) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "repoPath",
            message: `Not a git repository: ${canonicalRepoPath}`,
            details: { repoPath: canonicalRepoPath },
          }),
        );
      }

      const task = yield* taskStore.getTask({ repoPath: canonicalRepoPath, taskId });
      yield* validateTaskTransitionEffect(task, [task], task.status, "in_progress");

      const branch = buildBranchName(repoConfig.branchPrefix, taskId, task.title);
      const worktreeBase = repoConfig.worktreeBasePath
        ? dependencies.settingsConfig.resolveConfiguredPath(repoConfig.worktreeBasePath)
        : dependencies.settingsConfig.defaultWorktreeBasePath(repoConfig.workspaceId);
      const worktreePath = dependencies.settingsConfig.join(worktreeBase, taskId);
      const worktreeAlreadyExists = yield* dependencies.settingsConfig.pathExists(worktreePath);
      let preparedWorktree: PreparedBuildWorktree = {
        cleanup: () => Effect.succeed(""),
        worktreePath,
      };
      if (worktreeAlreadyExists) {
        yield* validateExistingBuildWorktree(
          dependencies,
          canonicalRepoPath,
          worktreePath,
          taskId,
          branch,
        );
      } else {
        preparedWorktree = yield* prepareNewBuildWorktree(
          dependencies,
          repoConfig,
          task,
          canonicalRepoPath,
          worktreeBase,
          worktreePath,
          branch,
        );
      }

      const finalizeResult = yield* Effect.either(
        Effect.gen(function* () {
          yield* dependencies.runtimeRegistry
            .ensureWorkspaceRuntime({
              runtimeKind,
              repoPath: canonicalRepoPath,
              workingDirectory: canonicalRepoPath,
              descriptor,
            })
            .pipe(
              Effect.mapError(
                (error) =>
                  new HostOperationError({
                    operation: "task.build_start.ensure_runtime",
                    message: `${runtimeKind} build runtime failed to start for task ${taskId}`,
                    cause: error,
                    details: { repoPath: canonicalRepoPath, taskId, runtimeKind },
                  }),
              ),
            );

          if (task.status !== "in_progress") {
            yield* taskStore.transitionTask({
              repoPath: canonicalRepoPath,
              taskId,
              status: "in_progress",
            });
          }

          return yield* Effect.try({
            try: () =>
              buildSessionBootstrapSchema.parse({
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
      if (finalizeResult._tag === "Left") {
        const cleanupError = yield* preparedWorktree.cleanup();
        return yield* Effect.fail(
          new HostOperationError({
            operation: "task.build_start.finalize",
            message: `${errorMessage(finalizeResult.left)}${cleanupError}`,
            cause: finalizeResult.left,
            details: { repoPath: canonicalRepoPath, taskId, worktreePath },
          }),
        );
      }

      return finalizeResult.right;
    });
  },
});
