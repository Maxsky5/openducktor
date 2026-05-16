import { Effect } from "effect";
import {
  canonicalTargetBranch,
  ensureHumanApprovalStatus,
  normalizeApprovalTargetBranch,
  publishTargetFromTargetBranch,
} from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
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
  getApprovalContext(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const dependencies = requireApprovalContextDependencies(
        gitPort,
        settingsConfig,
        systemCommands,
        taskWorktreeService,
        workspaceSettingsService,
      );

      const current = yield* taskStore.getTask({ repoPath, taskId });
      yield* Effect.try({
        try: () => ensureHumanApprovalStatus(current.status),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const effectiveRepoPath = repoConfig.repoPath;
      const metadata = yield* taskStore.getTaskMetadata({ repoPath: effectiveRepoPath, taskId });
      const defaultMergeMethod = yield* loadDefaultMergeMethod(dependencies.settingsConfig);
      const providers = yield* providerStatuses(dependencies, effectiveRepoPath, repoConfig);

      if (metadata.directMerge !== undefined) {
        const directMerge = metadata.directMerge;
        const targetBranch = normalizeApprovalTargetBranch(directMerge.targetBranch);
        const cleanupTarget = yield* findLatestCleanupTarget(
          dependencies,
          taskStore,
          effectiveRepoPath,
          taskId,
          directMerge.sourceBranch,
        );
        const workingDirectory =
          cleanupTarget && (yield* dependencies.settingsConfig.pathExists(cleanupTarget))
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
            message:
              "Human approval requires a builder branch, but the builder worktree is detached.",
            details: { workingDirectory: taskWorktree.workingDirectory },
          }),
        );
      }
      const sourceBranch = currentBranch.name?.trim();
      if (!sourceBranch) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "workingDirectory",
            message: "Human approval requires a builder branch name.",
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
    });
  },
});
