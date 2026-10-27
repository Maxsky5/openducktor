import type { TaskApprovalContext } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  canonicalTargetBranch,
  normalizeApprovalTargetBranch,
  publishTargetFromTargetBranch,
} from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
import { requireApprovalContextDependencies } from "../support/approval-context-dependencies";
import { requireDependencies } from "../support/required-task-dependencies";
import { loadDefaultMergeMethod } from "../support/task-workflow-helpers";
import { requireHumanReviewStatus } from "../support/task-workflow-events";
import {
  effectiveTargetBranchForTask,
  findLatestCleanupTarget,
} from "../support/task-worktree-cleanup";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskApprovalContextUseCase = ({
  taskWorkflows,
  gitPort,
  taskStore,
  settingsConfig,
  taskWorktreeService,
  workspaceSettingsService,
}: CreateTaskServiceInput): Pick<TaskService, "getApprovalContext"> => ({
  getApprovalContext(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const dependencies = yield* requireDependencies(() =>
        requireApprovalContextDependencies({
          gitPort,
          settingsConfig,
          taskWorktreeService,
          workspaceSettingsService,
        }),
      );

      const current = yield* taskStore.getTask({ repoPath, taskId });
      const workflow = taskWorkflows.forTask(current);
      yield* requireHumanReviewStatus(workflow, current);
      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const effectiveRepoPath = repoConfig.repoPath;
      const metadata = yield* taskStore.getTaskMetadata({ repoPath: effectiveRepoPath, taskId });
      const defaultMergeMethod = yield* loadDefaultMergeMethod(dependencies.settingsConfig);
      if (metadata.directMerge !== undefined) {
        const directMerge = metadata.directMerge;
        const targetBranch = normalizeApprovalTargetBranch(directMerge.targetBranch);
        const cleanupTarget = yield* findLatestCleanupTarget(
          { ...dependencies, worktreeRoles: workflow.worktreeRoles },
          taskStore,
          effectiveRepoPath,
          taskId,
          directMerge.sourceBranch,
        );
        const workingDirectory =
          cleanupTarget && (yield* dependencies.settingsConfig.pathExists(cleanupTarget))
            ? cleanupTarget
            : undefined;

        const approvalContext: TaskApprovalContext = {
          taskId,
          taskStatus: current.status,
          sourceBranch: directMerge.sourceBranch,
          targetBranch,
          publishTarget: publishTargetFromTargetBranch(targetBranch),
          defaultMergeMethod,
          hasUncommittedChanges: false,
          uncommittedFileCount: 0,
          directMerge,
        };
        if (directMerge.targetBranch.remote) {
          const branch = directMerge.targetBranch.branch.replace(/^refs\/heads\//, "");
          const target = yield* dependencies.gitPort.readPublicationTarget({
            repoPath: effectiveRepoPath,
            sourceRef: `refs/heads/${branch}`,
            remote: directMerge.targetBranch.remote,
            targetRef: `refs/heads/${branch}`,
          });
          approvalContext.publicationPreview = {
            sourceOid: target.sourceOid,
            remote: target.remote,
            targetRef: target.targetRef,
            destinations: target.endpoints.map(({ identity, label }) => ({ identity, label })),
          };
        }
        if (workingDirectory !== undefined) {
          approvalContext.workingDirectory = workingDirectory;
        }
        if (metadata.pullRequest !== undefined) {
          approvalContext.pullRequest = metadata.pullRequest;
        }
        return { outcome: "ready", approvalContext };
      }

      const taskWorktree = yield* dependencies.taskWorktreeService.getTaskWorktree({
        repoPath: effectiveRepoPath,
        taskId,
      });
      if (!taskWorktree) {
        return {
          outcome: "missing_builder_worktree",
          taskId,
          taskStatus: current.status,
        };
      }

      const currentBranch = yield* dependencies.gitPort.getCurrentBranch(
        taskWorktree.workingDirectory,
      );
      if (currentBranch.detached) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "workingDirectory",
            message: "Human approval requires a task branch, but the task worktree is detached.",
            details: { workingDirectory: taskWorktree.workingDirectory },
          }),
        );
      }
      const sourceBranch = currentBranch.name?.trim();
      if (!sourceBranch) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "workingDirectory",
            message: "Human approval requires a task branch name.",
            details: { workingDirectory: taskWorktree.workingDirectory },
          }),
        );
      }

      const targetBranch = normalizeApprovalTargetBranch(
        yield* effectiveTargetBranchForTask(
          dependencies.workspaceSettingsService,
          current,
          effectiveRepoPath,
        ),
      );
      const publishTarget =
        current.targetBranch === undefined
          ? publishTargetFromTargetBranch(repoConfig.defaultTargetBranch)
          : publishTargetFromTargetBranch(current.targetBranch);
      const targetRef = canonicalTargetBranch(targetBranch);
      const worktreeStatus = yield* dependencies.gitPort.getWorktreeStatusSummaryData(
        taskWorktree.workingDirectory,
        targetRef,
        "uncommitted",
      );
      const suggestedSquashCommitMessage = yield* dependencies.gitPort.suggestedSquashCommitMessage(
        effectiveRepoPath,
        sourceBranch,
        targetRef,
      );

      const approvalContext: TaskApprovalContext = {
        taskId,
        taskStatus: current.status,
        workingDirectory: taskWorktree.workingDirectory,
        sourceBranch,
        targetBranch,
        publishTarget,
        defaultMergeMethod,
        hasUncommittedChanges: worktreeStatus.fileStatusCounts.total > 0,
        uncommittedFileCount: worktreeStatus.fileStatusCounts.total,
      };
      if (metadata.pullRequest !== undefined) {
        approvalContext.pullRequest = metadata.pullRequest;
      }
      if (suggestedSquashCommitMessage !== undefined) {
        approvalContext.suggestedSquashCommitMessage = suggestedSquashCommitMessage;
      }
      return { outcome: "ready", approvalContext };
    });
  },
});
