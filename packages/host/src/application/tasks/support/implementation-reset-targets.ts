import type { AgentSessionRecord, RepoConfig } from "@openducktor/contracts";
import type { TaskWorkflow } from "@openducktor/workflows";
import { Effect } from "effect";
import { collectRelatedTaskBranches } from "./task-branch-tips";
import { normalizePathForComparison } from "../../../domain/path-comparison";
import { checkoutBranch } from "../../../domain/task";
import { HostDependencyError, HostValidationError } from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { TaskActivityGuardPort } from "../../../ports/task-activity-guard-port";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import {
  appendTaskCleanupProgress,
  stopTaskSessionsWithProgress,
  type TaskCleanupProgressState,
} from "./task-cleanup-progress";
import { managedWorktreeBaseForRepoConfig } from "../../git/managed-worktree-roots";
import {
  collectResetWorktreePaths,
  collectSessionsUsingCanonicalWorktree,
} from "./task-cleanup-support";
import { loadTaskTargetBranch, resolveTaskWorktreeStartPoint } from "./task-branches";
import type { TaskRecord } from "../../../ports/task-repository-ports";

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
    operation: "worktree_reset",
    removedWorktrees: progress.removedWorktrees,
    deletedBranches: progress.deletedBranches,
    completedSteps: progress.completedSteps,
  });

/**
 * The roles whose sessions a Reset Implementation preview clears: the `worktree.reset` effect of
 * its event. An event without that effect is not a Reset Implementation.
 */
export const previewResetRoles = (workflow: TaskWorkflow, taskId: string, eventId: string) => {
  const reset = workflow.worktreeReset(eventId);
  return reset
    ? Effect.succeed(reset.clearsSessionsOf)
    : Effect.fail(
        new HostValidationError({
          field: "eventId",
          message: `Event ${eventId} of task ${taskId} has no worktree.reset effect, so it cannot preview a Reset Implementation. Reload the task and try again.`,
          details: { taskId, eventId },
        }),
      );
};

// Reset and its preview must use the same worktree session list.
export const collectImplementationResetSessionState = (
  dependencies: { gitPort: GitPort; settingsConfig: SettingsConfigPort },
  /** The roles whose sessions the `worktree.reset` effect clears. */
  resetRoles: readonly string[],
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
        resetRoles,
        sessions,
        canonicalWorktree,
      ),
    };
  });

type ImplementationResetActivity = {
  taskActivityGuard: TaskActivityGuardPort | undefined;
  workspaceId: string;
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
      operation: "worktree_reset",
      message:
        "worktree.reset requires runtime session activity checks for task sessions that may use the canonical worktree.",
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
    yield* stopTaskSessionsWithProgress(
      progress,
      activityGuard.cleanupTaskSessions({
        workspaceId: activity.workspaceId,
        repoPath: activity.repoPath,
        taskSessions: [{ taskId: activity.taskId, sessions: activity.sessions }],
      }),
    );
  });

const resolveCanonicalImplementationResetTarget = (
  gitPort: GitPort,
  workspaceSettingsService: Pick<WorkspaceSettingsService, "getRepoConfig">,
  task: TaskRecord,
  repoPath: string,
  canonicalWorktreePath: string,
  workspaceId: string,
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
    const { branch: targetBranch } = yield* loadTaskTargetBranch(workspaceSettingsService, {
      task,
      repoPath,
      workspaceId,
    });
    // The reset keeps this worktree and hard-resets its branch, so the branch must not be the
    // target branch. The branch of the task worktree is the task branch, whatever its name.
    if (branch === checkoutBranch(targetBranch)) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "taskId",
          message: `Cannot reset implementation because canonical worktree ${canonicalWorktreePath} is on the target branch ${branch}. Check out the task branch or reset the task.`,
          details: { repoPath, taskId: task.id, canonicalWorktreePath, actualBranch: branch },
        }),
      );
    }
    const { reference: restoreReference } = yield* resolveTaskWorktreeStartPoint(
      { gitPort, workspaceSettingsService },
      { task, repoPath, workspaceId },
    );
    return { branch, restoreReference, worktreePath };
  });

/** The worktree paths without the canonical worktree, which Reset Implementation keeps. */
const withoutWorktree = (worktreePaths: string[], keptWorktree: string): string[] => {
  const kept = normalizePathForComparison(keptWorktree);
  return worktreePaths.filter((path) => normalizePathForComparison(path) !== kept);
};

const excludeCanonicalImplementationTargets = (
  worktreePaths: string[],
  branchNames: string[],
  canonicalTarget: CanonicalImplementationResetTarget | null,
) => {
  if (!canonicalTarget) {
    return { branchNames, worktreePaths };
  }
  return {
    branchNames: branchNames.filter((branch) => branch !== canonicalTarget.branch),
    worktreePaths: withoutWorktree(worktreePaths, canonicalTarget.worktreePath),
  };
};

/** Every worktree of the reset roles, including an existing canonical worktree. */
const collectImplementationResetWorktreePaths = (
  dependencies: { gitPort: GitPort; settingsConfig: SettingsConfigPort },
  input: {
    repoPath: string;
    managedWorktreeBasePath: string;
    taskId: string;
    sessions: AgentSessionRecord[];
    resetRoles: readonly string[];
  },
) =>
  collectResetWorktreePaths(
    dependencies,
    input.repoPath,
    input.managedWorktreeBasePath,
    input.taskId,
    input.sessions,
    new Set(input.resetRoles),
    "reset implementation",
  );

/**
 * Collects the worktrees and branches of Reset Implementation. `worktreePaths` lists every task
 * worktree, including an existing canonical worktree. The reset keeps that worktree and returns it
 * to its start point, so `cleanupTargets` lists only what the reset removes.
 */
export const collectImplementationResetTargets = (
  dependencies: {
    gitPort: GitPort;
    settingsConfig: SettingsConfigPort;
    workspaceSettingsService: Pick<WorkspaceSettingsService, "getRepoConfig">;
  },
  input: {
    workspaceId: string;
    repoPath: string;
    repoConfig: RepoConfig;
    managedWorktreeBasePath: string;
    /** The existing canonical worktree, or null when it does not exist. */
    canonicalWorktree: string | null;
    task: TaskRecord;
    sessions: AgentSessionRecord[];
    resetRoles: readonly string[];
  },
) =>
  Effect.gen(function* () {
    const { repoPath, repoConfig, task } = input;
    const worktreePaths = yield* collectImplementationResetWorktreePaths(dependencies, {
      ...input,
      taskId: task.id,
    });
    const relatedBranches = yield* collectRelatedTaskBranches(
      dependencies,
      repoConfig,
      repoPath,
      task,
      worktreePaths,
      "reset implementation",
    );
    const canonicalTarget = input.canonicalWorktree
      ? yield* resolveCanonicalImplementationResetTarget(
          dependencies.gitPort,
          dependencies.workspaceSettingsService,
          task,
          repoPath,
          input.canonicalWorktree,
          input.workspaceId,
        )
      : null;
    const cleanupTargets = excludeCanonicalImplementationTargets(
      worktreePaths,
      relatedBranches,
      canonicalTarget,
    );
    return { worktreePaths, canonicalTarget, cleanupTargets };
  });

/**
 * The worktrees that Reset Implementation removes, for its confirmation. It keeps the canonical
 * worktree, so this read needs no branch check of that worktree.
 */
export const collectImplementationResetRemovedPaths = (
  dependencies: { gitPort: GitPort; settingsConfig: SettingsConfigPort },
  repoPath: string,
  target: { taskId: string; sessions: AgentSessionRecord[]; resetRoles: readonly string[] },
  state: Effect.Success<ReturnType<typeof collectImplementationResetSessionState>>,
) =>
  Effect.gen(function* () {
    const worktreePaths = yield* collectImplementationResetWorktreePaths(dependencies, {
      ...target,
      repoPath,
      managedWorktreeBasePath: state.managedWorktreeBasePath,
    });
    if (!state.sessionState.canonicalExists) return worktreePaths;
    return withoutWorktree(
      worktreePaths,
      yield* dependencies.gitPort.canonicalizePath(state.canonicalWorktree),
    );
  });
