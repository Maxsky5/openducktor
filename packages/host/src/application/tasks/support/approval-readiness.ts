import { getScopedRepoConfig } from "../../workspaces/scoped-repo-config";
import type { RepoConfig, TaskMetadataPayload } from "@openducktor/contracts";
import { Effect, Equal } from "effect";
import {
  canonicalTargetBranch,
  ensureCleanTaskWorktree,
  normalizeApprovalTargetBranch,
  publishTargetFromTargetBranch,
} from "../../../domain/task";
import { HostDependencyError, HostValidationError } from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import type { TaskWorktreeService } from "../worktrees/task-worktree-service";
import { loadDefaultMergeMethod } from "./task-workflow-helpers";
import { loadTaskTargetBranch } from "./task-branches";
import type { TaskServiceUseCaseInput } from "../task-service";
import type { DirectMergeInput } from "../task-inputs";
import { requireDependencies, requireDirectMergeDependencies } from "./required-task-dependencies";
import { ensureNoDirectMergeEffect } from "./direct-merge-block";
import { requireApprovalAvailable, START_WORKTREE_SESSION_HINT } from "./task-workflow-events";
import type { TaskWorkflow } from "@openducktor/workflows";
import type { TaskRecord } from "../../../ports/task-repository-ports";

export const loadLiveApprovalPreparation = (
  dependencies: {
    gitPort: GitPort;
    workspaceSettingsService: Pick<WorkspaceSettingsService, "getRepoConfig">;
  },
  current: TaskRecord,
  workingDirectory: string,
  repoConfig: RepoConfig,
) =>
  Effect.gen(function* () {
    const currentBranch = yield* dependencies.gitPort.getCurrentBranch(workingDirectory);
    if (currentBranch.detached) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "workingDirectory",
          message: "Human approval requires a task branch, but the task worktree is detached.",
          details: { workingDirectory },
        }),
      );
    }
    const sourceBranch = currentBranch.name?.trim();
    if (!sourceBranch) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "workingDirectory",
          message: "Human approval requires a task branch name.",
          details: { workingDirectory },
        }),
      );
    }
    const liveTarget = yield* loadTaskTargetBranch(dependencies.workspaceSettingsService, {
      workspaceId: repoConfig.workspaceId,
      repoPath: repoConfig.repoPath,
      task: current,
    });
    const targetBranch = normalizeApprovalTargetBranch(liveTarget.branch);
    const publishTarget = publishTargetFromTargetBranch(
      liveTarget.source === "task" ? liveTarget.branch : repoConfig.defaultTargetBranch,
    );
    const targetRef = canonicalTargetBranch(targetBranch);
    const worktreeStatus = yield* dependencies.gitPort.getWorktreeStatusSummaryData(
      workingDirectory,
      targetRef,
      "uncommitted",
    );
    const suggestedSquashCommitMessage = yield* dependencies.gitPort.suggestedSquashCommitMessage(
      repoConfig.repoPath,
      sourceBranch,
      targetRef,
    );
    const uncommittedFileCount = worktreeStatus.fileStatusCounts.total;
    return {
      sourceBranch,
      targetBranch,
      publishTarget,
      hasUncommittedChanges: uncommittedFileCount > 0,
      uncommittedFileCount,
      suggestedSquashCommitMessage,
    };
  });

export const loadOpenApprovalContext = (
  dependencies: {
    gitPort: GitPort;
    settingsConfig: SettingsConfigPort;
    taskWorktreeService: TaskWorktreeService;
    workspaceSettingsService: Pick<WorkspaceSettingsService, "getRepoConfig">;
  },
  workflow: TaskWorkflow,
  taskId: string,
  current: TaskRecord,
  metadata: TaskMetadataPayload,
  repoConfig: RepoConfig,
) =>
  Effect.gen(function* () {
    yield* requireApprovalAvailable(workflow, current);
    const effectiveRepoPath = repoConfig.repoPath;
    const defaultMergeMethod = yield* loadDefaultMergeMethod(dependencies.settingsConfig);
    const taskWorktree = yield* dependencies.taskWorktreeService.getTaskWorktree({
      workspaceId: repoConfig.workspaceId,
      repoPath: effectiveRepoPath,
      taskId,
    });
    if (!taskWorktree) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "taskId",
          message: `Human approval requires a task worktree for task ${taskId}. ${START_WORKTREE_SESSION_HINT}`,
          details: { repoPath: effectiveRepoPath, taskId },
        }),
      );
    }
    const {
      sourceBranch,
      targetBranch,
      publishTarget,
      hasUncommittedChanges,
      uncommittedFileCount,
      suggestedSquashCommitMessage,
    } = yield* loadLiveApprovalPreparation(
      dependencies,
      current,
      taskWorktree.workingDirectory,
      repoConfig,
    );
    return {
      taskId,
      taskStatus: current.status,
      workingDirectory: taskWorktree.workingDirectory,
      sourceBranch,
      targetBranch,
      publishTarget,
      defaultMergeMethod,
      hasUncommittedChanges,
      uncommittedFileCount,
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
      systemCommands,
      taskSessionLifecycleCoordinator,
      taskWorktreeService,
      terminalService,
      worktreeFiles,
      workspaceSettingsService,
      completionState,
      taskWorkflows,
    } = services;
    const { taskId } = input;
    const mergeInput = input.input;
    const dependencies = yield* requireDependencies(() =>
      requireDirectMergeDependencies({
        gitPort,
        settingsConfig,
        systemCommands,
        taskWorktreeService,
        terminalService,
        worktreeFiles,
        workspaceSettingsService,
      }),
    );
    const repoConfig = yield* getScopedRepoConfig(dependencies.workspaceSettingsService, input);
    const effectiveRepoPath = repoConfig.repoPath;
    const canonicalRepoPath = yield* dependencies.gitPort.canonicalizePath(effectiveRepoPath);
    yield* taskSessionLifecycleCoordinator.acquireLifecycle(
      canonicalRepoPath,
      [taskId],
      "direct merge",
    );
    if (taskActivityGuard) {
      yield* taskActivityGuard.ensureNoUnresolvedHandoff({
        workspaceId: input.workspaceId,
        taskId,
      });
    }
    const current = yield* taskStore.getTask({
      workspaceId: input.workspaceId,
      repoPath: effectiveRepoPath,
      taskId,
    });
    const workflow = taskWorkflows.forTask(current);
    const metadata = yield* taskStore.getTaskMetadata({
      workspaceId: input.workspaceId,
      repoPath: effectiveRepoPath,
      taskId,
    });
    yield* ensureNoDirectMergeEffect({
      operation: "direct_merge",
      repoPath: effectiveRepoPath,
      taskId,
      directMerge: metadata.directMerge,
    });

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
      workflow,
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
    const state = completionState.ensure({
      workspaceId: input.workspaceId,
      repoPath: effectiveRepoPath,
      taskId,
    });
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
    return {
      dependencies,
      effectiveRepoPath,
      current,
      workflow,
      approval,
      state,
    };
  });
