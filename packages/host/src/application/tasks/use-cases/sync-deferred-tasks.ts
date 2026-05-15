import { isDeferrableOpenState, validateTransition } from "../../../domain/task";
import { cleanupMergedBuilderState } from "../support/builder-worktree-cleanup";
import {
  fetchLinkedPullRequest,
  githubPullRequestSyncPolicy,
  pullRequestRecordsMatch,
} from "../support/github-pull-requests";
import {
  requirePullRequestMergeCleanupDependencies,
  requirePullRequestSyncDependencies,
} from "../support/required-task-dependencies";
import { enrichTask, taskListWithCurrent } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskSyncDeferUseCases = ({
  devServerService,
  gitPort,
  taskStore,
  settingsConfig,
  systemCommands,
  taskWorktreeService,
  workspaceSettingsService,
}: CreateTaskServiceInput): Pick<
  TaskService,
  "repoPullRequestSync" | "repoPullRequestSyncDetailed" | "deferTask" | "resumeDeferredTask"
> => ({
  async repoPullRequestSync(input) {
    const result = await this.repoPullRequestSyncDetailed(input);
    return { ok: result.ran };
  },

  async repoPullRequestSyncDetailed(input) {
    const { repoPath } = input;
    const dependencies = requirePullRequestSyncDependencies(
      systemCommands,
      workspaceSettingsService,
    );
    const repoConfig =
      await dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const effectiveRepoPath = repoConfig.repoPath;
    const policy = await githubPullRequestSyncPolicy(dependencies.systemCommands, repoConfig);
    if (!policy.available) {
      return { ran: false, changedTaskIds: [] };
    }

    const tasks = await taskStore.listPullRequestSyncCandidates({ repoPath: effectiveRepoPath });
    const changedTaskIds: string[] = [];
    for (const task of tasks) {
      const pullRequest = task.pullRequest;
      if (!pullRequest) {
        continue;
      }

      const updated = await fetchLinkedPullRequest(
        dependencies,
        effectiveRepoPath,
        policy,
        pullRequest,
      );
      if (!updated) {
        continue;
      }

      if (updated.record.state === "merged" && task.status !== "closed") {
        const cleanupDependencies = requirePullRequestMergeCleanupDependencies(
          devServerService,
          gitPort,
          settingsConfig,
          taskWorktreeService,
        );
        await taskStore.setPullRequest({
          repoPath: effectiveRepoPath,
          taskId: task.id,
          pullRequest: updated.record,
        });
        await cleanupMergedBuilderState(
          cleanupDependencies,
          taskStore,
          effectiveRepoPath,
          task.id,
          updated.sourceBranch,
          updated.targetBranch,
        );

        const { current, currentTasks } = await taskListWithCurrent(
          taskStore,
          effectiveRepoPath,
          task.id,
        );
        validateTransition(current, currentTasks, current.status, "closed");
        await taskStore.transitionTask({
          repoPath: effectiveRepoPath,
          taskId: task.id,
          status: "closed",
        });
        changedTaskIds.push(task.id);
      } else if (!pullRequestRecordsMatch(updated.record, pullRequest)) {
        await taskStore.setPullRequest({
          repoPath: effectiveRepoPath,
          taskId: task.id,
          pullRequest: updated.record,
        });
        changedTaskIds.push(task.id);
      }
    }

    return { ran: true, changedTaskIds };
  },

  async deferTask(input) {
    const { repoPath, taskId } = input;
    const currentTasks = await taskStore.listTasks({ repoPath });
    const current = currentTasks.find((task) => task.id === taskId);
    if (!current) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (current.parentId !== undefined) {
      throw new Error("Subtasks cannot be deferred.");
    }
    if (!isDeferrableOpenState(current.status)) {
      throw new Error("Only non-closed open-state tasks can be deferred.");
    }
    validateTransition(current, currentTasks, current.status, "deferred");

    const updated = await taskStore.transitionTask({ repoPath, taskId, status: "deferred" });
    const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

    return enrichTask(updated, nextTasks);
  },

  async resumeDeferredTask(input) {
    const { repoPath, taskId } = input;
    const currentTasks = await taskStore.listTasks({ repoPath });
    const current = currentTasks.find((task) => task.id === taskId);
    if (!current) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (current.status !== "deferred") {
      throw new Error(`Task is not deferred: ${taskId}`);
    }
    validateTransition(current, currentTasks, current.status, "open");

    const updated = await taskStore.transitionTask({ repoPath, taskId, status: "open" });
    const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

    return enrichTask(updated, nextTasks);
  },
});
