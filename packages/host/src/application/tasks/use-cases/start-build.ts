import { buildSessionBootstrapSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { buildBranchName } from "../../../domain/task";
import { errorMessage, HostOperationError, HostValidationError } from "../../../effect/host-errors";
import {
  effectiveTargetBranchForTask,
  resolveBuildStartPoint,
  resolveRuntimeDescriptorForBuild,
  rollbackFailedBuildWorktree,
} from "../support/builder-worktree-cleanup";
import {
  requireBuildStartDependencies,
  requireDependencies,
} from "../support/required-task-dependencies";
import { validateTaskTransitionEffect } from "../support/task-validation-effects";
import { runHookCommandsAllowFailure } from "../support/workflow-hooks";
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
      const targetBranch = yield* effectiveTargetBranchForTask(
        dependencies.workspaceSettingsService,
        task,
        canonicalRepoPath,
      );
      const worktreeBase = repoConfig.worktreeBasePath
        ? dependencies.settingsConfig.resolveConfiguredPath(repoConfig.worktreeBasePath)
        : dependencies.settingsConfig.defaultWorktreeBasePath(repoConfig.workspaceId);
      const worktreePath = dependencies.settingsConfig.join(worktreeBase, taskId);

      if (yield* dependencies.settingsConfig.pathExists(worktreePath)) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `Worktree path already exists for task ${taskId}: ${worktreePath}`,
            details: { taskId, worktreePath },
          }),
        );
      }
      yield* dependencies.worktreeFiles.ensureDirectory(worktreeBase);

      const startPoint = yield* resolveBuildStartPoint(
        dependencies,
        canonicalRepoPath,
        targetBranch,
        task.targetBranch === undefined,
      );
      yield* dependencies.gitPort.createWorktree(
        canonicalRepoPath,
        worktreePath,
        branch,
        true,
        startPoint.reference,
      );

      let createdTrackingRef: string | null = null;
      const setupResult = yield* Effect.either(
        Effect.gen(function* () {
          if (startPoint.upstreamRemote) {
            const upstreamSetup = yield* dependencies.gitPort.configureBranchUpstream(
              canonicalRepoPath,
              worktreePath,
              branch,
              startPoint.upstreamRemote,
            );
            createdTrackingRef = upstreamSetup.createdTrackingRef;
          }

          yield* dependencies.worktreeFiles.copyConfiguredPaths(
            canonicalRepoPath,
            worktreePath,
            repoConfig.worktreeCopyPaths,
          );

          const preStartHooks = repoConfig.hooks.preStart
            .map((hook) => hook.trim())
            .filter(Boolean);
          const failure = yield* runHookCommandsAllowFailure(
            dependencies.systemCommands,
            preStartHooks,
            worktreePath,
          );
          if (failure) {
            return yield* Effect.fail(
              new HostValidationError({
                field: "taskId",
                message: `Worktree setup script command failed: ${failure.hook}\n${failure.stderr}`,
                details: { taskId, hook: failure.hook },
              }),
            );
          }
        }),
      );
      if (setupResult._tag === "Left") {
        const cleanupError = yield* rollbackFailedBuildWorktree(
          dependencies,
          canonicalRepoPath,
          worktreePath,
          branch,
          createdTrackingRef,
        );
        return yield* Effect.fail(
          new HostOperationError({
            operation: "task.build_start.prepare_worktree",
            message: `${errorMessage(setupResult.left)}${cleanupError}`,
            cause: setupResult.left,
            details: { repoPath: canonicalRepoPath, taskId, worktreePath },
          }),
        );
      }

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

      yield* taskStore.transitionTask({
        repoPath: canonicalRepoPath,
        taskId,
        status: "in_progress",
      });

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
    });
  },
});
