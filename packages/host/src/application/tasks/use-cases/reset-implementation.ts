import { DEFAULT_BRANCH_PREFIX } from "@openducktor/contracts";
import { Effect } from "effect";
import { canResetImplementationFromStatus } from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
import {
  appendImplementationResetCleanupProgress,
  ensureNoActiveImplementationResetActivity,
  excludeCanonicalImplementationTargets,
  resolveCanonicalImplementationResetTarget,
} from "../support/implementation-reset-targets";
import { requireDependencies } from "../support/required-task-dependencies";
import {
  requireImplementationResetStoreDependencies,
  requireTaskDeleteDependencies,
} from "../support/task-cleanup-dependencies";
import {
  collectRelatedTaskBranches,
  collectResetWorktreePaths,
  collectSessionsUsingCanonicalWorktree,
  createTaskCleanupProgressState,
  implementationSessionRoleNames,
  replaceTaskInList,
  resetImplementationRollbackStatus,
  runTaskLocalCleanup,
} from "../support/task-cleanup-support";
import { enrichTask } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";
export const createTaskImplementationResetUseCase = ({
  devServerService,
  gitPort,
  taskStore,
  taskActivityGuard,
  settingsConfig,
  terminalService,
  worktreeFiles,
  workspaceSettingsService,
  taskSessionBootstrapCoordinator,
}: CreateTaskServiceInput): Pick<TaskService, "resetImplementation"> => ({
  resetImplementation(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const dependencies = yield* requireDependencies(() =>
        requireTaskDeleteDependencies(
          devServerService,
          gitPort,
          settingsConfig,
          workspaceSettingsService,
        ),
      );
      const storeDependencies = requireImplementationResetStoreDependencies(taskStore);
      if (taskSessionBootstrapCoordinator) {
        const canonicalInputRepo = yield* dependencies.gitPort.canonicalizePath(repoPath);
        yield* taskSessionBootstrapCoordinator.acquireLifecycle(
          canonicalInputRepo,
          [taskId],
          "reset implementation",
        );
      }
      const currentTasks = yield* taskStore.listTasks({ repoPath });
      const current = currentTasks.find((task) => task.id === taskId);
      if (!current) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `Task not found: ${taskId}`,
            details: { repoPath, taskId },
          }),
        );
      }
      if (!canResetImplementationFromStatus(current.status)) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `Implementation reset is only allowed from in_progress, blocked, ai_review, or human_review (current: ${current.status}).`,
            details: { repoPath, taskId, status: current.status },
          }),
        );
      }
      const currentSessions = (yield* taskStore.getTaskMetadata({ repoPath, taskId }))
        .agentSessions;
      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const effectiveRepoPath = yield* dependencies.gitPort.canonicalizePath(repoConfig.repoPath);
      const managedWorktreeBasePath = repoConfig.worktreeBasePath
        ? dependencies.settingsConfig.resolveConfiguredPath(repoConfig.worktreeBasePath)
        : dependencies.settingsConfig.defaultWorktreeBasePath(repoConfig.workspaceId);
      const canonicalWorktreePath = dependencies.settingsConfig.join(
        managedWorktreeBasePath,
        taskId,
      );
      const { canonicalExists: canonicalWorktreeExists, guarded: guardedSessions } =
        yield* collectSessionsUsingCanonicalWorktree(
          dependencies.gitPort,
          dependencies.settingsConfig,
          currentSessions,
          canonicalWorktreePath,
        );
      yield* ensureNoActiveImplementationResetActivity(
        taskActivityGuard,
        effectiveRepoPath,
        taskId,
        guardedSessions,
      );
      const branchPrefix = repoConfig.branchPrefix.trim() || DEFAULT_BRANCH_PREFIX;
      const rollbackStatus = resetImplementationRollbackStatus(current);
      const worktreePaths = yield* collectResetWorktreePaths(
        dependencies,
        effectiveRepoPath,
        managedWorktreeBasePath,
        branchPrefix,
        current.id,
        currentSessions,
        new Set<string>(implementationSessionRoleNames),
        "reset implementation",
      );
      const relatedBranches = yield* collectRelatedTaskBranches(
        dependencies.gitPort,
        effectiveRepoPath,
        branchPrefix,
        [taskId],
      );
      const canonicalTarget = canonicalWorktreeExists
        ? yield* resolveCanonicalImplementationResetTarget(
            dependencies.gitPort,
            dependencies.workspaceSettingsService,
            current,
            effectiveRepoPath,
            canonicalWorktreePath,
          )
        : null;
      const cleanupTargets = excludeCanonicalImplementationTargets(
        worktreePaths,
        relatedBranches,
        canonicalTarget,
      );
      const cleanupProgress = createTaskCleanupProgressState();
      return yield* Effect.gen(function* () {
        yield* runTaskLocalCleanup({
          branchNames: cleanupTargets.branchNames,
          devServerService: dependencies.devServerService,
          gitPort: dependencies.gitPort,
          managedWorktreeBasePath,
          progress: cleanupProgress,
          repoPath: effectiveRepoPath,
          settingsConfig: dependencies.settingsConfig,
          taskIds: [taskId],
          terminalService,
          worktreeCleanupOperation: "task_reset_implementation",
          worktreeFiles,
          worktreePaths: cleanupTargets.worktreePaths,
        });
        if (canonicalTarget) {
          yield* dependencies.gitPort.restoreWorktreeToReference(
            canonicalTarget.worktreePath,
            canonicalTarget.restoreReference,
          );
          cleanupProgress.completedSteps.push(
            `Restored canonical worktree ${canonicalWorktreePath} to ${canonicalTarget.restoreReference}.`,
          );
        }
        yield* storeDependencies.clearAgentSessionsByRoles({
          repoPath: effectiveRepoPath,
          taskId,
          roles: [...implementationSessionRoleNames],
        });
        cleanupProgress.completedSteps.push("Cleared Builder and QA session records.");
        yield* storeDependencies.clearQaReports({ repoPath: effectiveRepoPath, taskId });
        cleanupProgress.completedSteps.push("Cleared QA reports.");
        yield* storeDependencies.setPullRequest({
          repoPath: effectiveRepoPath,
          taskId,
          pullRequest: null,
        });
        cleanupProgress.completedSteps.push("Cleared pull request metadata.");
        yield* storeDependencies.setDirectMerge({
          repoPath: effectiveRepoPath,
          taskId,
          directMerge: null,
        });
        cleanupProgress.completedSteps.push("Cleared direct merge metadata.");
        const updated = yield* taskStore.transitionTask({
          repoPath: effectiveRepoPath,
          taskId,
          status: rollbackStatus,
        });
        return enrichTask(updated, replaceTaskInList(currentTasks, updated));
      }).pipe(
        Effect.catchAll((error) =>
          Effect.fail(appendImplementationResetCleanupProgress(error, cleanupProgress)),
        ),
      );
    }).pipe(Effect.scoped);
  },
});
