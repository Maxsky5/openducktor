import type { DirectMergeRecord } from "@openducktor/contracts";
import {
  canonicalTargetBranch,
  directMergeConflict,
  ensureCleanBuilderWorktree,
  validateTransition,
} from "../../../domain/task";
import { loadOpenApprovalContext } from "../support/approval-readiness";
import { cleanupDirectMergeBuilderState } from "../support/builder-worktree-cleanup";
import { requireDirectMergeDependencies } from "../support/required-task-dependencies";
import { enrichTask, taskListWithCurrent } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskDirectMergeUseCase = ({
  devServerService,
  gitPort,
  taskStore,
  settingsConfig,
  systemCommands,
  taskWorktreeService,
  workspaceSettingsService,
}: CreateTaskServiceInput): Pick<TaskService, "directMerge"> => ({
  async directMerge(input) {
    const { repoPath, taskId } = input;
    const mergeInput = input.input;
    const dependencies = requireDirectMergeDependencies(
      devServerService,
      gitPort,
      settingsConfig,
      systemCommands,
      taskWorktreeService,
      workspaceSettingsService,
    );
    const repoConfig =
      await dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const effectiveRepoPath = repoConfig.repoPath;
    const { current, currentTasks } = await taskListWithCurrent(
      taskStore,
      effectiveRepoPath,
      taskId,
    );
    const metadata = await taskStore.getTaskMetadata({ repoPath: effectiveRepoPath, taskId });
    if (metadata.directMerge !== undefined) {
      throw new Error(
        `A local direct merge is already recorded for task ${taskId}. Finish the direct merge workflow before trying again.`,
      );
    }

    const approval = await loadOpenApprovalContext(
      dependencies,
      taskId,
      current,
      metadata,
      repoConfig,
    );
    ensureCleanBuilderWorktree(approval);
    const mergeRequest =
      approval.workingDirectory === undefined
        ? {
            sourceBranch: approval.sourceBranch,
            targetBranch: canonicalTargetBranch(approval.targetBranch),
            method: mergeInput.mergeMethod,
            ...(mergeInput.squashCommitMessage === undefined
              ? {}
              : { squashCommitMessage: mergeInput.squashCommitMessage }),
          }
        : {
            sourceBranch: approval.sourceBranch,
            targetBranch: canonicalTargetBranch(approval.targetBranch),
            sourceWorkingDirectory: approval.workingDirectory,
            method: mergeInput.mergeMethod,
            ...(mergeInput.squashCommitMessage === undefined
              ? {}
              : { squashCommitMessage: mergeInput.squashCommitMessage }),
          };
    const mergeResult = await dependencies.gitPort.mergeBranch(effectiveRepoPath, mergeRequest);
    if (mergeResult.outcome === "conflicts") {
      return {
        outcome: "conflicts",
        conflict: directMergeConflict(
          effectiveRepoPath,
          approval,
          mergeInput.mergeMethod,
          mergeResult.conflictedFiles,
          mergeResult.output,
        ),
      };
    }

    const directMerge: DirectMergeRecord = {
      method: mergeInput.mergeMethod,
      sourceBranch: approval.sourceBranch,
      targetBranch: approval.targetBranch,
      mergedAt: new Date().toISOString(),
    };
    await taskStore.setDirectMerge({
      repoPath: effectiveRepoPath,
      taskId,
      directMerge,
    });

    if (approval.publishTarget !== undefined) {
      if (current.status === "ai_review") {
        validateTransition(current, currentTasks, current.status, "human_review");
        const task = await taskStore.transitionTask({
          repoPath: effectiveRepoPath,
          taskId,
          status: "human_review",
        });
        const nextTasks = currentTasks.map((entry) => (entry.id === taskId ? task : entry));
        return {
          outcome: "completed",
          task: enrichTask(task, nextTasks),
        };
      }

      return {
        outcome: "completed",
        task: enrichTask(current, currentTasks),
      };
    }

    validateTransition(current, currentTasks, current.status, "closed");
    const task = await taskStore.transitionTask({
      repoPath: effectiveRepoPath,
      taskId,
      status: "closed",
    });
    await cleanupDirectMergeBuilderState(
      dependencies,
      taskStore,
      effectiveRepoPath,
      taskId,
      directMerge,
    );
    const nextTasks = currentTasks.map((entry) => (entry.id === taskId ? task : entry));

    return {
      outcome: "completed",
      task: enrichTask(task, nextTasks),
    };
  },
});
