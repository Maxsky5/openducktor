import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../../domain/path-comparison";
import { HostDependencyError, HostValidationError } from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { TaskActivityGuardPort } from "../../../ports/task-activity-guard-port";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import { effectiveTargetBranchForTask, resolveBuildStartPoint } from "./builder-worktree-cleanup";
import { appendTaskCleanupProgress, type TaskCleanupProgressState } from "./task-cleanup-support";

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

export const ensureNoActiveImplementationResetActivity = (
  taskActivityGuard: TaskActivityGuardPort | undefined,
  repoPath: string,
  taskId: string,
  sessions: AgentSessionRecord[],
) => {
  if (sessions.length === 0) return Effect.void;
  if (!taskActivityGuard) {
    return Effect.fail(
      new HostDependencyError({
        dependency: "taskActivityGuard",
        operation: "task_reset_implementation",
        message:
          "task_reset_implementation requires runtime session activity checks for task sessions that may use the canonical worktree.",
        details: { repoPath, taskId },
      }),
    );
  }
  return taskActivityGuard.ensureNoActiveTaskResetActivity({
    repoPath,
    taskId,
    sessions,
    operationLabel: "reset implementation",
    sessionRoles: [...new Set(sessions.map((session) => session.role.trim()))],
  });
};

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
