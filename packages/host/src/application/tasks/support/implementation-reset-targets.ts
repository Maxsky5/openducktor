import type { TaskWorkflow } from "@openducktor/workflows";
import type { AgentSessionRecord, RepoConfig } from "@openducktor/contracts";
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
  collectRelatedTaskBranches,
  collectResetWorktreePaths,
  collectSessionsUsingCanonicalWorktree,
  isRelatedTaskBranch,
  managedWorktreeBaseForRepoConfig,
} from "./task-cleanup-support";
import { effectiveTargetBranchForTask, resolveBuildStartPoint } from "./task-worktree-cleanup";
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

// Reset and its preview must use the same worktree session list.
export const collectImplementationResetSessionState = (
  dependencies: { gitPort: GitPort; settingsConfig: SettingsConfigPort },
  workflow: TaskWorkflow,
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
        workflow,
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
    const { stoppedSessionCount } = yield* activityGuard.cleanupTaskSessions({
      repoPath: activity.repoPath,
      taskSessions: [{ taskId: activity.taskId, sessions: activity.sessions }],
    });
    recordStoppedAgentSessionCount(progress, stoppedSessionCount);
  });

const resolveCanonicalImplementationResetTarget = (
  gitPort: GitPort,
  workspaceSettingsService: WorkspaceSettingsService,
  task: TaskRecord,
  repoPath: string,
  canonicalWorktreePath: string,
  branchPrefix: string,
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
    // The reset keeps this worktree and hard-resets its branch, so the branch must belong to the task.
    if (!isRelatedTaskBranch(branch, branchPrefix, task.id)) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "taskId",
          message: `Cannot reset implementation because canonical worktree ${canonicalWorktreePath} is on branch ${branch}, which is not a task branch. Check out the task branch or reset the task.`,
          details: { repoPath, taskId: task.id, canonicalWorktreePath, actualBranch: branch },
        }),
      );
    }
    const effectiveTarget = yield* effectiveTargetBranchForTask(
      workspaceSettingsService,
      task,
      repoPath,
      workspaceId,
    );
    const restoreReference = (yield* resolveBuildStartPoint(
      { gitPort },
      repoPath,
      effectiveTarget,
      task.targetBranch === undefined,
    )).reference;
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
    workflow: TaskWorkflow;
  },
) =>
  collectResetWorktreePaths(
    dependencies,
    input.repoPath,
    input.managedWorktreeBasePath,
    input.taskId,
    input.sessions,
    new Set(input.workflow.worktreeRoles),
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
    workspaceSettingsService: WorkspaceSettingsService;
  },
  input: {
    workspaceId: string;
    repoPath: string;
    branchPrefix: string;
    managedWorktreeBasePath: string;
    /** The existing canonical worktree, or null when it does not exist. */
    canonicalWorktree: string | null;
    task: TaskRecord;
    sessions: AgentSessionRecord[];
    workflow: TaskWorkflow;
  },
) =>
  Effect.gen(function* () {
    const { repoPath, branchPrefix, task } = input;
    const worktreePaths = yield* collectImplementationResetWorktreePaths(dependencies, {
      ...input,
      taskId: task.id,
    });
    const relatedBranches = yield* collectRelatedTaskBranches(
      dependencies.gitPort,
      repoPath,
      branchPrefix,
      [task.id],
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
          branchPrefix,
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
  target: { taskId: string; sessions: AgentSessionRecord[]; workflow: TaskWorkflow },
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
