import type { RepoConfig, TaskCard, TaskMetadataPayload } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  canonicalTargetBranch,
  ensureHumanApprovalStatus,
  normalizeApprovalTargetBranch,
  publishTargetFromTargetBranch,
} from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import type { TaskWorktreeService } from "../worktrees/task-worktree-service";
import { effectiveTargetBranchForTask } from "./builder-worktree-cleanup";
import { type GithubRepositoryDependencies, githubProviderStatus } from "./github-pull-requests";
import { loadDefaultMergeMethod } from "./task-workflow-helpers";
export const loadOpenApprovalContext = (
  dependencies: GithubRepositoryDependencies & {
    settingsConfig: SettingsConfigPort;
    taskWorktreeService: TaskWorktreeService;
    workspaceSettingsService: WorkspaceSettingsService;
  },
  taskId: string,
  current: TaskCard,
  metadata: TaskMetadataPayload,
  repoConfig: RepoConfig,
) =>
  Effect.gen(function* () {
    yield* Effect.try({
      try: () => ensureHumanApprovalStatus(current.status),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    const effectiveRepoPath = repoConfig.repoPath;
    const defaultMergeMethod = yield* loadDefaultMergeMethod(dependencies.settingsConfig);
    const providers = yield* providerStatuses(dependencies, effectiveRepoPath, repoConfig);
    const taskWorktree = yield* dependencies.taskWorktreeService.getTaskWorktree({
      repoPath: effectiveRepoPath,
      taskId,
    });
    if (!taskWorktree) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "taskId",
          message: `Human approval requires a builder worktree for task ${taskId}. Start Builder first.`,
          details: { repoPath: effectiveRepoPath, taskId },
        }),
      );
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
  });
export const providerStatuses = (
  dependencies: GithubRepositoryDependencies,
  repoPath: string,
  repoConfig: RepoConfig,
) =>
  Effect.gen(function* () {
    return [yield* githubProviderStatus(dependencies, repoPath, repoConfig)];
  });
