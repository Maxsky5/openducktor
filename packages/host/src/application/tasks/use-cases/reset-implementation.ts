import { DEFAULT_BRANCH_PREFIX } from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../../domain/path-comparison";
import { buildBranchName, canResetImplementationFromStatus } from "../../../domain/task";
import { HostDependencyError, HostValidationError } from "../../../effect/host-errors";
import {
  effectiveTargetBranchForTask,
  resolveBuildStartPoint,
} from "../support/builder-worktree-cleanup";
import { validateExistingGitBuildWorktree } from "../support/builder-worktree-start";
import { requireDependencies } from "../support/required-task-dependencies";
import {
  requireImplementationResetStoreDependencies,
  requireTaskDeleteDependencies,
} from "../support/task-cleanup-dependencies";
import {
  appendTaskCleanupProgress,
  createTaskCleanupProgressState,
  implementationSessionRoleNames,
  implementationSessionRoles,
  replaceTaskInList,
  resetImplementationRollbackStatus,
} from "../support/task-cleanup-support";
import { enrichTask } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskImplementationResetUseCase = ({
  devServerService,
  gitPort,
  taskStore,
  taskActivityGuard,
  settingsConfig,
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

      const currentMetadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });
      const currentSessions = currentMetadata.agentSessions;
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
      const normalizedCanonicalWorktree = normalizePathForComparison(canonicalWorktreePath);
      const guardedSessions = currentSessions.filter(
        (session) =>
          implementationSessionRoles.has(session.role.trim()) ||
          normalizePathForComparison(session.workingDirectory) === normalizedCanonicalWorktree,
      );
      if (guardedSessions.length > 0) {
        if (!taskActivityGuard) {
          return yield* Effect.fail(
            new HostDependencyError({
              dependency: "taskActivityGuard",
              operation: "task_reset_implementation",
              message:
                "task_reset_implementation requires runtime session activity checks for task sessions that may use the canonical worktree.",
              details: { repoPath, taskId },
            }),
          );
        }
        yield* taskActivityGuard.ensureNoActiveTaskResetActivity({
          repoPath,
          taskId,
          sessions: guardedSessions,
          operationLabel: "reset implementation",
          sessionRoles: [...new Set(guardedSessions.map((session) => session.role.trim()))],
        });
      }
      const branchPrefix = repoConfig.branchPrefix.trim() || DEFAULT_BRANCH_PREFIX;
      const rollbackStatus = resetImplementationRollbackStatus(current);
      const canonicalWorktreeExists =
        yield* dependencies.settingsConfig.pathExists(canonicalWorktreePath);
      let restoreReference: string | null = null;
      if (canonicalWorktreeExists) {
        if (!(yield* dependencies.gitPort.isGitRepository(canonicalWorktreePath))) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "taskId",
              message: `Cannot reset implementation because canonical path is not a Git worktree: ${canonicalWorktreePath}`,
              details: { repoPath: effectiveRepoPath, taskId, canonicalWorktreePath },
            }),
          );
        }
        const expectedBranch = buildBranchName(branchPrefix, taskId, current.title);
        yield* validateExistingGitBuildWorktree(
          dependencies,
          effectiveRepoPath,
          canonicalWorktreePath,
          taskId,
          expectedBranch,
        );
        const effectiveTarget = yield* effectiveTargetBranchForTask(
          dependencies.workspaceSettingsService,
          current,
          effectiveRepoPath,
        );
        restoreReference = (yield* resolveBuildStartPoint(
          dependencies,
          effectiveRepoPath,
          effectiveTarget,
          current.targetBranch === undefined,
        )).reference;
      }
      const cleanupProgress = createTaskCleanupProgressState();

      return yield* Effect.gen(function* () {
        if (restoreReference) {
          yield* dependencies.gitPort.restoreWorktreeToReference(
            canonicalWorktreePath,
            restoreReference,
          );
          cleanupProgress.completedSteps.push(
            `Restored canonical worktree ${canonicalWorktreePath} to ${restoreReference}.`,
          );
        }
        yield* dependencies.devServerService.stop({ repoPath: effectiveRepoPath, taskId });
        cleanupProgress.completedSteps.push(`Stopped dev servers for task ${taskId}.`);
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
        yield* storeDependencies.setDirectMerge({
          repoPath: effectiveRepoPath,
          taskId,
          directMerge: null,
        });
        cleanupProgress.completedSteps.push("Cleared delivery metadata.");
        const updated = yield* taskStore.transitionTask({
          repoPath: effectiveRepoPath,
          taskId,
          status: rollbackStatus,
        });
        return enrichTask(updated, replaceTaskInList(currentTasks, updated));
      }).pipe(
        Effect.catchAll((error) =>
          Effect.fail(
            appendTaskCleanupProgress(error, {
              operation: "task_reset_implementation",
              removedWorktrees: cleanupProgress.removedWorktrees,
              deletedBranches: cleanupProgress.deletedBranches,
              completedSteps: cleanupProgress.completedSteps,
            }),
          ),
        ),
      );
    });
  },
});
