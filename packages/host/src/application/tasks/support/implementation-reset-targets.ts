import type { AgentSessionRecord, RepoConfig, TaskCard } from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../../domain/path-comparison";
import { HostDependencyError, HostValidationError } from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { TaskActivityGuardPort } from "../../../ports/task-activity-guard-port";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import {
  appendTaskCleanupProgress,
  recordStoppedAgentSessionCount,
  type TaskCleanupProgressState,
} from "./task-cleanup-progress";
import {
  collectSessionsUsingCanonicalWorktree,
  managedWorktreeBaseForRepoConfig,
} from "./task-cleanup-support";
import { effectiveTargetBranchForTask, resolveBuildStartPoint } from "./task-worktree-cleanup";

type CanonicalImplementationResetTarget = {
  branch: string;
  restoreReference: string;
  worktreePath: string;
};

export const appendImplementationResetCleanupProgress = <E>(
  error: E,
  progress: TaskCleanupProgressState,
) =>
  appendTaskCleanupProgress(error, {
    operation: "task_reset_implementation",
    removedWorktrees: progress.removedWorktrees,
    deletedBranches: progress.deletedBranches,
    completedSteps: progress.completedSteps,
  });

// Reset and its preview must use the same worktree session list.
export const collectImplementationResetSessionState = (
  dependencies: { gitPort: GitPort; settingsConfig: SettingsConfigPort },
  repoConfig: RepoConfig,
  taskId: string,
  sessions: AgentSessionRecord[],
) =>
  Effect.gen(function* () {
    const managedWorktreeBasePath = managedWorktreeBaseForRepoConfig(
      dependencies.settingsConfig,
      repoConfig,
    );
    const canonicalWorktree = dependencies.settingsConfig.join(managedWorktreeBasePath, taskId);
    return {
      managedWorktreeBasePath,
      canonicalWorktree,
      sessionState: yield* collectSessionsUsingCanonicalWorktree(
        dependencies.gitPort,
        dependencies.settingsConfig,
        sessions,
        canonicalWorktree,
      ),
    };
  });

type ImplementationResetActivity = {
  taskActivityGuard: TaskActivityGuardPort | undefined;
  repoPath: string;
  taskId: string;
  sessions: AgentSessionRecord[];
};

export const requireImplementationResetActivityGuard = (activity: ImplementationResetActivity) => {
  if (activity.sessions.length === 0 || activity.taskActivityGuard) {
    return Effect.succeed(activity.taskActivityGuard);
  }
  return Effect.fail(
    new HostDependencyError({
      dependency: "taskActivityGuard",
      operation: "task_reset_implementation",
      message:
        "task_reset_implementation requires runtime session activity checks for task sessions that may use the canonical worktree.",
      details: { repoPath: activity.repoPath, taskId: activity.taskId },
    }),
  );
};

export const cleanupImplementationResetActivity = (
  activity: ImplementationResetActivity,
  progress: TaskCleanupProgressState,
) =>
  Effect.gen(function* () {
    const activityGuard = yield* requireImplementationResetActivityGuard(activity);
    if (!activityGuard) {
      return;
    }
    const { stoppedSessionCount } = yield* activityGuard.cleanupTaskSessions({
      repoPath: activity.repoPath,
      taskSessions: [{ taskId: activity.taskId, sessions: activity.sessions }],
    });
    recordStoppedAgentSessionCount(progress, stoppedSessionCount);
  });

export const resolveCanonicalImplementationResetTarget = (
  gitPort: GitPort,
  workspaceSettingsService: WorkspaceSettingsService,
  task: TaskCard,
  repoPath: string,
  canonicalWorktreePath: string,
) =>
  Effect.gen(function* () {
    const worktreePath = yield* gitPort.canonicalizePath(canonicalWorktreePath);
    const currentBranch = yield* gitPort.getCurrentBranch(worktreePath);
    const branch = currentBranch.name?.trim();
    if (!branch || currentBranch.detached) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "taskId",
          message: `Cannot reset implementation because canonical worktree ${canonicalWorktreePath} is detached or has no active branch.`,
          details: { repoPath, taskId: task.id, canonicalWorktreePath },
        }),
      );
    }
    const effectiveTarget = yield* effectiveTargetBranchForTask(
      workspaceSettingsService,
      task,
      repoPath,
    );
    const restoreReference = (yield* resolveBuildStartPoint(
      { gitPort },
      repoPath,
      effectiveTarget,
      task.targetBranch === undefined,
    )).reference;
    return { branch, restoreReference, worktreePath };
  });

export const excludeCanonicalImplementationTargets = (
  worktreePaths: string[],
  branchNames: string[],
  canonicalTarget: CanonicalImplementationResetTarget | null,
) => {
  if (!canonicalTarget) {
    return { branchNames, worktreePaths };
  }
  const normalizedCanonical = normalizePathForComparison(canonicalTarget.worktreePath);
  return {
    branchNames: branchNames.filter((branch) => branch !== canonicalTarget.branch),
    worktreePaths: worktreePaths.filter(
      (worktreePath) => normalizePathForComparison(worktreePath) !== normalizedCanonical,
    ),
  };
};
