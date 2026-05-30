import { Effect } from "effect";
import { isDeferrableOpenState } from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
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
import { validateTaskTransitionEffect } from "../support/task-validation-effects";
import { enrichTask, taskListWithCurrent } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskSyncDeferUseCases = ({
  devServerService,
  gitPort,
  taskStore,
  settingsConfig,
  systemCommands,
  toolDiscovery,
  taskWorktreeService,
  workspaceSettingsService,
}: CreateTaskServiceInput): Pick<
  TaskService,
  "repoPullRequestSync" | "repoPullRequestSyncDetailed" | "deferTask" | "resumeDeferredTask"
> => {
  const repoPullRequestSyncDetailed: TaskService["repoPullRequestSyncDetailed"] = (input) =>
    Effect.gen(function* () {
      const { repoPath } = input;
      const dependencies = requirePullRequestSyncDependencies({
        systemCommands,
        toolDiscovery,
        workspaceSettingsService,
      });
      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const effectiveRepoPath = repoConfig.repoPath;
      const policy = yield* githubPullRequestSyncPolicy(dependencies, repoConfig);
      if (!policy.available) {
        return { ran: false, changedTaskIds: [] };
      }

      const tasks = yield* taskStore.listPullRequestSyncCandidates({
        repoPath: effectiveRepoPath,
      });
      const changedTaskIds: string[] = [];
      for (const task of tasks) {
        const pullRequest = task.pullRequest;
        if (!pullRequest) {
          continue;
        }

        const updated = yield* fetchLinkedPullRequest(
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
          yield* taskStore.setPullRequest({
            repoPath: effectiveRepoPath,
            taskId: task.id,
            pullRequest: updated.record,
          });
          yield* cleanupMergedBuilderState(
            cleanupDependencies,
            taskStore,
            effectiveRepoPath,
            task.id,
            updated.sourceBranch,
            updated.targetBranch,
          );

          const { current, currentTasks } = yield* taskListWithCurrent(
            taskStore,
            effectiveRepoPath,
            task.id,
          );
          yield* validateTaskTransitionEffect(current, currentTasks, current.status, "closed");
          yield* taskStore.transitionTask({
            repoPath: effectiveRepoPath,
            taskId: task.id,
            status: "closed",
          });
          changedTaskIds.push(task.id);
        } else if (!pullRequestRecordsMatch(updated.record, pullRequest)) {
          yield* taskStore.setPullRequest({
            repoPath: effectiveRepoPath,
            taskId: task.id,
            pullRequest: updated.record,
          });
          changedTaskIds.push(task.id);
        }
      }

      return { ran: true, changedTaskIds };
    });

  return {
    repoPullRequestSync(input) {
      return Effect.gen(function* () {
        const result = yield* repoPullRequestSyncDetailed(input);
        return { ok: result.ran };
      });
    },

    repoPullRequestSyncDetailed,

    deferTask(input) {
      return Effect.gen(function* () {
        const { repoPath, taskId } = input;
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
        if (current.parentId !== undefined) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "taskId",
              message: "Subtasks cannot be deferred.",
              details: { repoPath, taskId, parentId: current.parentId },
            }),
          );
        }
        if (!isDeferrableOpenState(current.status)) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "taskId",
              message: "Only non-closed open-state tasks can be deferred.",
              details: { repoPath, taskId, status: current.status },
            }),
          );
        }
        yield* validateTaskTransitionEffect(current, currentTasks, current.status, "deferred");

        const updated = yield* taskStore.transitionTask({ repoPath, taskId, status: "deferred" });
        const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

        return enrichTask(updated, nextTasks);
      });
    },

    resumeDeferredTask(input) {
      return Effect.gen(function* () {
        const { repoPath, taskId } = input;
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
        if (current.status !== "deferred") {
          return yield* Effect.fail(
            new HostValidationError({
              field: "taskId",
              message: `Task is not deferred: ${taskId}`,
              details: { repoPath, taskId, status: current.status },
            }),
          );
        }
        yield* validateTaskTransitionEffect(current, currentTasks, current.status, "open");

        const updated = yield* taskStore.transitionTask({ repoPath, taskId, status: "open" });
        const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

        return enrichTask(updated, nextTasks);
      });
    },
  };
};
