import { getScopedRepoConfig } from "../support/scoped-repo-config";
import type { TaskApprovalContext } from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizeApprovalTargetBranch, publishTargetFromTargetBranch } from "../../../domain/task";
import { requireApprovalContextDependencies } from "../support/approval-context-dependencies";
import { requireDependencies } from "../support/required-task-dependencies";
import { loadDefaultMergeMethod } from "../support/task-workflow-helpers";
import { requireApprovalAvailable } from "../support/task-workflow-events";
import { findLatestCleanupTarget } from "../support/task-worktree-cleanup";
import { loadLiveApprovalPreparation } from "../support/approval-readiness";
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
      const { taskId } = input;
      const dependencies = yield* requireDependencies(() =>
        requireApprovalContextDependencies({
          gitPort,
          settingsConfig,
          taskWorktreeService,
          workspaceSettingsService,
        }),
      );

      const current = yield* taskStore.getTask(input);
      const workflow = taskWorkflows.forTask(current);
      yield* requireApprovalAvailable(workflow, current);
      const repoConfig = yield* getScopedRepoConfig(dependencies.workspaceSettingsService, input);
      const effectiveRepoPath = repoConfig.repoPath;
      const metadata = yield* taskStore.getTaskMetadata({
        ...input,
        repoPath: effectiveRepoPath,
      });
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
          input.workspaceId,
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
        workspaceId: input.workspaceId,
        repoPath: effectiveRepoPath,
        taskId,
      });
      if (!taskWorktree) {
        return {
          outcome: "missing_worktree",
          taskId,
          taskStatus: current.status,
        };
      }

      const {
        sourceBranch,
        targetBranch,
        publishTarget,
        worktreeStatus,
        suggestedSquashCommitMessage,
      } = yield* loadLiveApprovalPreparation(
        dependencies,
        current,
        taskWorktree.workingDirectory,
        repoConfig,
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
