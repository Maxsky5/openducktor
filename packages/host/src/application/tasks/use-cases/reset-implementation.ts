import { DEFAULT_BRANCH_PREFIX } from "@openducktor/contracts";
import { Effect } from "effect";
import { canResetImplementationFromStatus } from "../../../domain/task";
import { HostDependencyError, HostValidationError } from "../../../effect/host-errors";
import { removeWorktreeAndFilesystemPath } from "../../git/worktree-removal";
import { requireDependencies } from "../support/required-task-dependencies";
import {
  appendResetCleanupProgress,
  collectRelatedTaskBranches,
  collectResetWorktreePaths,
  implementationSessionRoleNames,
  implementationSessionRoles,
  managedWorktreeBaseForRepoConfig,
  replaceTaskInList,
  resetImplementationRollbackStatus,
  taskHasSessionsForRoles,
} from "../support/reset-cleanup";
import {
  requireImplementationResetStoreDependencies,
  requireTaskDeleteDependencies,
  requireTaskWorktreeCleanupFiles,
} from "../support/task-reset-dependencies";
import { enrichTask } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskImplementationResetUseCase = ({
  devServerService,
  gitPort,
  taskStore,
  taskActivityGuard,
  settingsConfig,
  worktreeFiles,
  workspaceSettingsService,
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

      if (taskHasSessionsForRoles(current, implementationSessionRoles)) {
        if (!taskActivityGuard) {
          return yield* Effect.fail(
            new HostDependencyError({
              dependency: "taskActivityGuard",
              operation: "task_reset_implementation",
              message:
                "task_reset_implementation requires runtime session activity checks for tasks with build or QA sessions.",
              details: { repoPath, taskId },
            }),
          );
        }
        yield* taskActivityGuard.ensureNoActiveTaskResetActivity({
          repoPath,
          taskId,
          sessions: current.agentSessions ?? [],
          operationLabel: "reset implementation",
          sessionRoles: [...implementationSessionRoleNames],
        });
      }

      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const effectiveRepoPath = repoConfig.repoPath;
      const managedWorktreeBasePath = managedWorktreeBaseForRepoConfig(
        dependencies.settingsConfig,
        repoConfig,
      );
      const branchPrefix = repoConfig.branchPrefix.trim() || DEFAULT_BRANCH_PREFIX;
      const rollbackStatus = resetImplementationRollbackStatus(current);
      const worktreePaths = yield* collectResetWorktreePaths(
        dependencies,
        effectiveRepoPath,
        branchPrefix,
        current,
        implementationSessionRoles,
        "reset implementation",
      );
      const branchNames = yield* collectRelatedTaskBranches(
        dependencies.gitPort,
        effectiveRepoPath,
        branchPrefix,
        [taskId],
      );
      const removedWorktrees: string[] = [];
      const deletedBranches: string[] = [];

      return yield* Effect.gen(function* () {
        yield* dependencies.devServerService.stop({ repoPath: effectiveRepoPath, taskId });
        for (const worktreePath of worktreePaths) {
          yield* removeWorktreeAndFilesystemPath(
            {
              gitPort: dependencies.gitPort,
              settingsConfig: dependencies.settingsConfig,
              worktreeFiles: requireTaskWorktreeCleanupFiles(
                worktreeFiles,
                "task_reset_implementation",
              ),
            },
            {
              repoPath: effectiveRepoPath,
              worktreePath,
              force: true,
              managedWorktreeBasePath,
              missingOutsideManagedRootPathPolicy: "skip",
            },
          );
          removedWorktrees.push(worktreePath);
        }
        for (const branchName of branchNames) {
          yield* dependencies.gitPort.deleteLocalBranch(effectiveRepoPath, branchName, true);
          deletedBranches.push(branchName);
        }
        yield* storeDependencies.clearAgentSessionsByRoles({
          repoPath: effectiveRepoPath,
          taskId,
          roles: [...implementationSessionRoleNames],
        });
        yield* storeDependencies.clearQaReports({ repoPath: effectiveRepoPath, taskId });
        yield* storeDependencies.setPullRequest({
          repoPath: effectiveRepoPath,
          taskId,
          pullRequest: null,
        });
        yield* storeDependencies.setDirectMerge({
          repoPath: effectiveRepoPath,
          taskId,
          directMerge: null,
        });
        const updated = yield* taskStore.transitionTask({
          repoPath: effectiveRepoPath,
          taskId,
          status: rollbackStatus,
        });
        return enrichTask(updated, replaceTaskInList(currentTasks, updated));
      }).pipe(
        Effect.catchAll((error) =>
          Effect.fail(appendResetCleanupProgress(error, removedWorktrees, deletedBranches)),
        ),
      );
    });
  },
});
