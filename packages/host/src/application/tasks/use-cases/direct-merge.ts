import type { DirectMergeRecord } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  canonicalTargetBranch,
  directMergeConflict,
  ensureCleanBuilderWorktree,
} from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
import { loadOpenApprovalContext } from "../support/approval-readiness";
import { cleanupDirectMergeBuilderState } from "../support/builder-worktree-cleanup";
import {
  requireDependencies,
  requireDirectMergeDependencies,
  type TaskGithubDependencyInput,
} from "../support/required-task-dependencies";
import { completeTaskClosure } from "../support/task-closure";
import { validateTaskTransitionEffect } from "../support/task-validation-effects";
import { enrichTask, taskListWithCurrent } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskDirectMergeUseCase = ({
  devServerService,
  githubDependencies,
  taskStore,
  settingsConfig,
  taskWorktreeService,
  terminalService,
  workspaceSettingsService,
}: CreateTaskServiceInput & TaskGithubDependencyInput): Pick<TaskService, "directMerge"> => ({
  directMerge(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const mergeInput = input.input;
      const dependencies = yield* requireDependencies(() =>
        requireDirectMergeDependencies({
          devServerService,
          githubDependencies,
          settingsConfig,
          taskWorktreeService,
          terminalService,
          workspaceSettingsService,
        }),
      );
      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const effectiveRepoPath = repoConfig.repoPath;
      const { current, currentTasks } = yield* taskListWithCurrent(
        taskStore,
        effectiveRepoPath,
        taskId,
      );
      const metadata = yield* taskStore.getTaskMetadata({ repoPath: effectiveRepoPath, taskId });
      if (metadata.directMerge !== undefined) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `A local direct merge is already recorded for task ${taskId}. Finish the direct merge workflow before trying again.`,
            details: { repoPath: effectiveRepoPath, taskId },
          }),
        );
      }

      const approval = yield* loadOpenApprovalContext(
        dependencies,
        taskId,
        current,
        metadata,
        repoConfig,
      );
      yield* Effect.try({
        try: () => ensureCleanBuilderWorktree(approval),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
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
      const mergeResult = yield* dependencies.gitPort.mergeBranch(effectiveRepoPath, mergeRequest);
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
      yield* taskStore.setDirectMerge({
        repoPath: effectiveRepoPath,
        taskId,
        directMerge,
      });

      if (approval.publishTarget !== undefined) {
        if (current.status === "ai_review") {
          yield* validateTaskTransitionEffect(
            current,
            currentTasks,
            current.status,
            "human_review",
          );
          const task = yield* taskStore.transitionTask({
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

      yield* validateTaskTransitionEffect(current, currentTasks, current.status, "closed");
      const task = yield* completeTaskClosure({
        cleanup: cleanupDirectMergeBuilderState(
          dependencies,
          taskStore,
          effectiveRepoPath,
          taskId,
          directMerge,
        ),
        repoPath: effectiveRepoPath,
        taskId,
        taskStore,
      });
      const nextTasks = currentTasks.map((entry) => (entry.id === taskId ? task : entry));

      return {
        outcome: "completed",
        task: enrichTask(task, nextTasks),
      };
    });
  },
});
