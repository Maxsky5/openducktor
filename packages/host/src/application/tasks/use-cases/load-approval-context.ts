import {
  canonicalTargetBranch,
  ensureHumanApprovalStatus,
  normalizeApprovalTargetBranch,
  publishTargetFromTargetBranch,
} from "../../../domain/task";
import { providerStatuses } from "../support/approval-readiness";
import {
  effectiveTargetBranchForTask,
  findLatestCleanupTarget,
} from "../support/builder-worktree-cleanup";
import { requireApprovalContextDependencies } from "../support/required-task-dependencies";
import { loadDefaultMergeMethod } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskApprovalContextUseCase = ({
  gitPort,
  taskStore,
  settingsConfig,
  systemCommands,
  taskWorktreeService,
  workspaceSettingsService,
}: CreateTaskServiceInput): Pick<TaskService, "getApprovalContext"> => ({
  async getApprovalContext(input) {
    const { repoPath, taskId } = input;
    const dependencies = requireApprovalContextDependencies(
      gitPort,
      settingsConfig,
      systemCommands,
      taskWorktreeService,
      workspaceSettingsService,
    );

    const current = await taskStore.getTask({ repoPath, taskId });
    ensureHumanApprovalStatus(current.status);
    const repoConfig =
      await dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const effectiveRepoPath = repoConfig.repoPath;
    const metadata = await taskStore.getTaskMetadata({ repoPath: effectiveRepoPath, taskId });
    const defaultMergeMethod = await loadDefaultMergeMethod(dependencies.settingsConfig);
    const providers = await providerStatuses(dependencies, effectiveRepoPath, repoConfig);

    if (metadata.directMerge !== undefined) {
      const directMerge = metadata.directMerge;
      const targetBranch = normalizeApprovalTargetBranch(directMerge.targetBranch);
      const cleanupTarget = await findLatestCleanupTarget(
        dependencies,
        taskStore,
        effectiveRepoPath,
        taskId,
        directMerge.sourceBranch,
      );
      const workingDirectory =
        cleanupTarget && (await dependencies.settingsConfig.pathExists(cleanupTarget))
          ? cleanupTarget
          : undefined;

      return {
        outcome: "ready",
        approvalContext: {
          taskId,
          taskStatus: current.status,
          workingDirectory,
          sourceBranch: directMerge.sourceBranch,
          targetBranch,
          publishTarget: publishTargetFromTargetBranch(targetBranch),
          defaultMergeMethod,
          hasUncommittedChanges: false,
          uncommittedFileCount: 0,
          pullRequest: metadata.pullRequest,
          directMerge,
          providers,
        },
      };
    }

    const taskWorktree = await dependencies.taskWorktreeService.getTaskWorktree({
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

    const currentBranch = await dependencies.gitPort.getCurrentBranch(
      taskWorktree.workingDirectory,
    );
    if (currentBranch.detached) {
      throw new Error(
        "Human approval requires a builder branch, but the builder worktree is detached.",
      );
    }
    const sourceBranch = currentBranch.name?.trim();
    if (!sourceBranch) {
      throw new Error("Human approval requires a builder branch name.");
    }

    const targetBranch = normalizeApprovalTargetBranch(
      await effectiveTargetBranchForTask(
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
    const worktreeStatus = await dependencies.gitPort.getWorktreeStatusSummaryData(
      taskWorktree.workingDirectory,
      targetRef,
      "uncommitted",
    );
    const suggestedSquashCommitMessage = await dependencies.gitPort.suggestedSquashCommitMessage(
      effectiveRepoPath,
      sourceBranch,
      targetRef,
    );

    return {
      outcome: "ready",
      approvalContext: {
        taskId,
        taskStatus: current.status,
        workingDirectory: taskWorktree.workingDirectory,
        sourceBranch,
        targetBranch,
        publishTarget,
        defaultMergeMethod,
        hasUncommittedChanges: worktreeStatus.fileStatusCounts.total > 0,
        uncommittedFileCount: worktreeStatus.fileStatusCounts.total,
        pullRequest: metadata.pullRequest,
        providers,
        suggestedSquashCommitMessage,
      },
    };
  },
});
