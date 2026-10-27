import { Effect } from "effect";
import { isMergeDetectionCandidate } from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
import { requireDependencies } from "../support/required-task-dependencies";
import {
  findTaskBranch,
  listTaskBranchTips,
  localBranchName,
  readCanonicalManagedWorktreeBase,
  relatedTaskBranchTips,
} from "../support/task-branch-tips";
import { requireTaskWorktreeDependencies } from "../support/task-cleanup-dependencies";
import {
  appendTaskCleanupProgress,
  createTaskCleanupProgressState,
} from "../support/task-cleanup-progress";
import {
  managedWorktreeBaseForRepoConfig,
  runTaskLocalCleanup,
} from "../support/task-cleanup-support";
import {
  collectCloseWorktreePaths,
  collectTaskCleanupTargets,
} from "../support/task-close-cleanup";
import type { TaskService, TaskServiceUseCaseInput } from "../task-service";

export const createTaskWorktreeUseCases = ({
  gitPort,
  taskStore,
  taskWorkflows,
  settingsConfig,
  terminalService,
  taskWorktreeService,
  worktreeFiles,
  workspaceSettingsService,
  taskSessionLifecycleCoordinator,
}: TaskServiceUseCaseInput): Pick<
  TaskService,
  "getTaskWorktreeCleanupImpact" | "removeTaskWorktree"
> => ({
  getTaskWorktreeCleanupImpact({ repoPath, taskId }) {
    return Effect.gen(function* () {
      const dependencies = yield* requireDependencies(() =>
        requireTaskWorktreeDependencies(
          "task_worktree_cleanup_impact_get",
          gitPort,
          settingsConfig,
          workspaceSettingsService,
          taskWorktreeService,
        ),
      );
      const [task, metadata, repoConfig] = yield* Effect.all(
        [
          taskStore.getTask({ repoPath, taskId }),
          taskStore.getTaskMetadata({ repoPath, taskId }),
          dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath),
        ],
        { concurrency: "unbounded" },
      );
      const effectiveRepoPath = yield* dependencies.gitPort.canonicalizePath(repoConfig.repoPath);
      const relatedTips = relatedTaskBranchTips(
        yield* listTaskBranchTips(dependencies.gitPort, effectiveRepoPath, repoConfig.branchPrefix),
        repoConfig.branchPrefix,
        taskId,
      );
      // Count the same worktrees that a close and a worktree removal remove.
      const worktrees = yield* Effect.forEach(
        yield* collectCloseWorktreePaths(
          dependencies,
          effectiveRepoPath,
          taskWorkflows.forTask(task),
          task,
          metadata.agentSessions,
        ),
        (path) =>
          Effect.gen(function* () {
            if (!(yield* dependencies.settingsConfig.pathExists(path))) return null;
            return { path, changeCount: (yield* dependencies.gitPort.getStatus(path)).length };
          }),
        { concurrency: "unbounded" },
      );
      const existing = worktrees.filter((worktree) => worktree !== null);
      const worktreePaths = existing.map((worktree) => worktree.path);
      const uncommittedFileCount = existing.reduce(
        (sum, worktree) => sum + worktree.changeCount,
        0,
      );
      // Merge detection finds the task branch from the same canonical path.
      const taskWorktreePath = dependencies.settingsConfig.join(
        yield* readCanonicalManagedWorktreeBase(
          dependencies.gitPort,
          dependencies.settingsConfig,
          repoConfig,
        ),
        taskId,
      );
      const taskBranch = findTaskBranch(relatedTips, taskWorktreePath);
      return {
        worktreePaths,
        branchNames: relatedTips.map(localBranchName).sort(),
        uncommittedFileCount,
        mergeCandidate: isMergeDetectionCandidate(task, {
          taskBranch,
          hasPendingDirectMerge: metadata.directMerge !== undefined,
        }),
        branchOid: taskBranch.kind === "found" ? taskBranch.oid : null,
      };
    });
  },

  removeTaskWorktree({ repoPath, taskId }) {
    return Effect.gen(function* () {
      const task = yield* taskStore.getTask({ repoPath, taskId });
      const workflow = taskWorkflows.forTask(task);
      if (!workflow.isTerminalState(task.status)) {
        return yield* new HostValidationError({
          field: "taskId",
          message: `Task ${taskId} is not closed. Close the task to remove its worktree.`,
          details: { repoPath, taskId },
        });
      }
      const dependencies = yield* requireDependencies(() =>
        requireTaskWorktreeDependencies(
          "task_worktree_remove",
          gitPort,
          settingsConfig,
          workspaceSettingsService,
          taskWorktreeService,
        ),
      );
      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const effectiveRepoPath = yield* dependencies.gitPort.canonicalizePath(repoConfig.repoPath);
      yield* taskSessionLifecycleCoordinator.acquireLifecycle(
        effectiveRepoPath,
        [taskId],
        "remove task worktree",
      );
      const metadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });
      const { worktreePaths, branchNames } = yield* collectTaskCleanupTargets({
        dependencies,
        lifecycle: taskSessionLifecycleCoordinator,
        repoPath: effectiveRepoPath,
        branchPrefix: repoConfig.branchPrefix,
        workflow,
        task,
        sessions: metadata.agentSessions,
        operationLabel: "remove the worktree of",
      });
      const progress = createTaskCleanupProgressState();
      yield* runTaskLocalCleanup({
        branchNames,
        gitPort: dependencies.gitPort,
        managedWorktreeBasePath: managedWorktreeBaseForRepoConfig(
          dependencies.settingsConfig,
          repoConfig,
        ),
        progress,
        repoPath: effectiveRepoPath,
        settingsConfig: dependencies.settingsConfig,
        taskIds: [taskId],
        terminalService,
        worktreeCleanupOperation: "task_worktree_remove",
        worktreeFiles,
        worktreePaths,
      }).pipe(
        Effect.catch((error) =>
          Effect.fail(
            appendTaskCleanupProgress(error, {
              operation: "task_worktree_remove",
              removedWorktrees: progress.removedWorktrees,
              deletedBranches: progress.deletedBranches,
              completedSteps: progress.completedSteps,
            }),
          ),
        ),
      );
    }).pipe(Effect.scoped);
  },
});
