import type { RepoConfig, TaskCard, TaskMetadataPayload } from "@openducktor/contracts";
import { Effect, Equal } from "effect";
import {
  canonicalTargetBranch,
  ensureCleanTaskWorktree,
  ensureHumanApprovalStatus,
  normalizeApprovalTargetBranch,
  publishTargetFromTargetBranch,
} from "../../../domain/task";
import { HostDependencyError, HostValidationError } from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import type { TaskWorktreeService } from "../worktrees/task-worktree-service";
import { loadDefaultMergeMethod, taskListWithCurrent } from "./task-workflow-helpers";
import { effectiveTargetBranchForTask } from "./task-worktree-cleanup";
import type { TaskServiceUseCaseInput } from "../task-service";
import type { DirectMergeInput } from "../task-inputs";
import { requireDependencies, requireDirectMergeDependencies } from "./required-task-dependencies";
import { validateTaskTransitionEffect } from "./task-validation-effects";

export const loadOpenApprovalContext = (
  dependencies: {
    gitPort: GitPort;
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
    const taskWorktree = yield* dependencies.taskWorktreeService.getTaskWorktree({
      repoPath: effectiveRepoPath,
      taskId,
    });
    if (!taskWorktree) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "taskId",
          message: `Human approval requires a task worktree for task ${taskId}. Start Builder first.`,
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
      suggestedSquashCommitMessage,
    };
  });

export const prepareDirectMerge = (services: TaskServiceUseCaseInput, input: DirectMergeInput) =>
  Effect.gen(function* () {
    const {
      gitPort,
      taskStore,
      taskActivityGuard,
      settingsConfig,
      taskSessionLifecycleCoordinator,
      taskWorktreeService,
      terminalService,
      worktreeFiles,
      workspaceSettingsService,
      completionState,
    } = services;
    const { repoPath, taskId } = input;
    const mergeInput = input.input;
    const dependencies = yield* requireDependencies(() =>
      requireDirectMergeDependencies({
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
    if (
      !Equal.equals(mergeInput.expected, {
        taskStatus: approval.taskStatus,
        sourceBranch: approval.sourceBranch,
        targetBranch: approval.targetBranch,
      })
    )
      return yield* new HostValidationError({
        field: "expected",
        message:
          "The task status, source branch, or target branch changed. Refresh approval context and review the merge again.",
      });
    const state = completionState.ensure(effectiveRepoPath, taskId);
    if (state.mergeUncertain && !state.merge)
      return yield* new HostValidationError({
        field: "taskId",
        message:
          "The original merge has no conclusive result. Inspect its target branch and Git state before continuing. Do not apply another merge.",
      });
    if (
      state.merge &&
      (!Equal.equals(state.merge.targetBranch, approval.targetBranch) ||
        state.merge.sourceBranch !== approval.sourceBranch ||
        state.merge.method !== mergeInput.mergeMethod)
    )
      return yield* new HostValidationError({
        field: "expected",
        message:
          "A previously applied merge has unresolved record persistence. Inspect that merge before requesting a different operation.",
      });
    yield* Effect.try({
      try: () => ensureCleanTaskWorktree(approval),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    if (!approval.publishTarget || current.status === "ai_review")
      yield* validateTaskTransitionEffect(
        current,
        currentTasks,
        current.status,
        approval.publishTarget ? "human_review" : "closed",
      );

    return { dependencies, effectiveRepoPath, current, currentTasks, approval, state };
  });
