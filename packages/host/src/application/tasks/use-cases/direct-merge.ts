import type { DirectMergeRecord } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  canonicalTargetBranch,
  directMergeConflict,
  ensureCleanTaskWorktree,
} from "../../../domain/task";
import { HostDependencyError, HostValidationError } from "../../../effect/host-errors";
import { loadOpenApprovalContext } from "../support/approval-readiness";
import {
  requireDependencies,
  requireDirectMergeDependencies,
} from "../support/required-task-dependencies";
import { validateTaskTransitionEffect } from "../support/task-validation-effects";
import { enrichTask, taskListWithCurrent } from "../support/task-workflow-helpers";
import { cleanupDirectMergeTaskState } from "../support/task-worktree-cleanup";
import { createTaskMutationProgressFailure } from "../task-mutation-progress-failure";
import type { TaskServiceUseCaseInput, TaskService } from "../task-service";

export const createTaskDirectMergeUseCase = ({
  devServerService,
  gitPort,
  taskStore,
  taskActivityGuard,
  settingsConfig,
  taskSessionLifecycleCoordinator,
  taskWorktreeService,
  terminalService,
  worktreeFiles,
  workspaceSettingsService,
}: TaskServiceUseCaseInput) => ({
  directMerge(input: Parameters<TaskService["directMerge"]>[0]) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const mergeInput = input.input;
      const dependencies = yield* requireDependencies(() =>
        requireDirectMergeDependencies({
          devServerService,
          gitPort,
          settingsConfig,
          taskWorktreeService,
          terminalService,
          worktreeFiles,
          workspaceSettingsService,
        }),
      );
      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const effectiveRepoPath = repoConfig.repoPath;
      const canonicalRepoPath = yield* dependencies.gitPort.canonicalizePath(effectiveRepoPath);
      yield* taskSessionLifecycleCoordinator.acquireLifecycle(
        canonicalRepoPath,
        [taskId],
        "direct merge",
      );
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

      if (metadata.agentSessions.length > 0) {
        if (!taskActivityGuard) {
          return yield* Effect.fail(
            new HostDependencyError({
              dependency: "taskActivityGuard",
              operation: "direct merge",
              message: "Task activity guard is required to check sessions before direct merge.",
            }),
          );
        }
        const { liveSessionCount } = yield* taskActivityGuard.countLiveSessions({
          repoPath: canonicalRepoPath,
          taskSessions: [{ taskId, sessions: metadata.agentSessions }],
        });
        if (liveSessionCount > 0) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "taskId",
              message: `Stop all running sessions for task ${taskId} before direct merge.`,
              details: { repoPath: effectiveRepoPath, taskId },
            }),
          );
        }
      }

      const approval = yield* loadOpenApprovalContext(
        dependencies,
        taskId,
        current,
        metadata,
        repoConfig,
      );
      yield* Effect.try({
        try: () => ensureCleanTaskWorktree(approval),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
      const mergeRequest: Parameters<typeof dependencies.gitPort.mergeBranch>[1] = {
        sourceBranch: approval.sourceBranch,
        targetBranch: canonicalTargetBranch(approval.targetBranch),
        method: mergeInput.mergeMethod,
      };
      if (approval.workingDirectory !== undefined) {
        mergeRequest.sourceWorkingDirectory = approval.workingDirectory;
      }
      if (mergeInput.squashCommitMessage !== undefined) {
        mergeRequest.squashCommitMessage = mergeInput.squashCommitMessage;
      }
      const mergeResult = yield* dependencies.gitPort.mergeBranch(effectiveRepoPath, mergeRequest);
      if (mergeResult.outcome === "conflicts") {
        return {
          outcome: "conflicts" as const,
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

      const postRecord = yield* Effect.either(
        Effect.gen(function* () {
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
              return { outcome: "completed" as const, task: enrichTask(task, nextTasks) };
            }

            return { outcome: "completed" as const, task: enrichTask(current, currentTasks) };
          }

          yield* validateTaskTransitionEffect(current, currentTasks, current.status, "closed");
          yield* cleanupDirectMergeTaskState(
            dependencies,
            taskStore,
            effectiveRepoPath,
            taskId,
            directMerge,
          );
          const task = yield* taskStore.transitionTask({
            repoPath: effectiveRepoPath,
            taskId,
            status: "closed",
          });
          const nextTasks = currentTasks.map((entry) => (entry.id === taskId ? task : entry));

          return { outcome: "completed" as const, task: enrichTask(task, nextTasks) };
        }),
      );
      if (postRecord._tag === "Left") {
        return yield* Effect.fail(
          createTaskMutationProgressFailure("direct-merge", taskId, postRecord.left),
        );
      }
      return postRecord.right;
    }).pipe(Effect.scoped);
  },
});
