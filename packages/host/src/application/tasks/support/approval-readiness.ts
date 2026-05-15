import type {
  GitProviderAvailability,
  RepoConfig,
  TaskApprovalContext,
  TaskCard,
  TaskMetadataPayload,
} from "@openducktor/contracts";
import {
  canonicalTargetBranch,
  ensureHumanApprovalStatus,
  normalizeApprovalTargetBranch,
  publishTargetFromTargetBranch,
} from "../../../domain/task";
import type { GitPort } from "../../../ports/git-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { SystemCommandPort } from "../../../ports/system-command-port";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import type { TaskWorktreeService } from "../worktrees/task-worktree-service";
import { effectiveTargetBranchForTask } from "./builder-worktree-cleanup";
import { githubProviderStatus } from "./github-pull-requests";
import { loadDefaultMergeMethod } from "./task-workflow-helpers";

export const loadOpenApprovalContext = async (
  dependencies: {
    gitPort: GitPort;
    settingsConfig: SettingsConfigPort;
    systemCommands: SystemCommandPort;
    taskWorktreeService: TaskWorktreeService;
    workspaceSettingsService: WorkspaceSettingsService;
  },
  taskId: string,
  current: TaskCard,
  metadata: TaskMetadataPayload,
  repoConfig: RepoConfig,
): Promise<TaskApprovalContext> => {
  ensureHumanApprovalStatus(current.status);

  const effectiveRepoPath = repoConfig.repoPath;
  const defaultMergeMethod = await loadDefaultMergeMethod(dependencies.settingsConfig);
  const providers = await providerStatuses(dependencies, effectiveRepoPath, repoConfig);
  const taskWorktree = await dependencies.taskWorktreeService.getTaskWorktree({
    repoPath: effectiveRepoPath,
    taskId,
  });
  if (!taskWorktree) {
    throw new Error(
      `Human approval requires a builder worktree for task ${taskId}. Start Builder first.`,
    );
  }

  const currentBranch = await dependencies.gitPort.getCurrentBranch(taskWorktree.workingDirectory);
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
  };
};

export const providerStatuses = async (
  dependencies: {
    gitPort: GitPort;
    systemCommands: SystemCommandPort;
  },
  repoPath: string,
  repoConfig: RepoConfig,
): Promise<GitProviderAvailability[]> => [
  await githubProviderStatus(dependencies, repoPath, repoConfig),
];
