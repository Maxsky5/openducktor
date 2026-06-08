import {
  type AgentSessionRecord,
  DEFAULT_BRANCH_PREFIX,
  type RepoConfig,
  type TaskCard,
  type TaskStatus,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../../domain/path-comparison";
import { errorMessage, HostOperationError, HostValidationError } from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
export const implementationSessionRoleNames = ["build", "qa"] as const;
export const taskResetSessionRoleNames = ["spec", "planner", "build", "qa"] as const;
export const implementationSessionRoles = new Set<string>(implementationSessionRoleNames);
export const taskResetSessionRoles = new Set<string>(taskResetSessionRoleNames);
export type TaskSessionRecords = {
  taskId: string;
  sessions: AgentSessionRecord[];
};
export const taskHasImplementationSessions = (sessions: AgentSessionRecord[]): boolean =>
  sessions.some((session) => implementationSessionRoles.has(session.role.trim()));
export const managedWorktreeBaseForRepoConfig = (
  settingsConfig: SettingsConfigPort,
  repoConfig: RepoConfig,
): string =>
  repoConfig.worktreeBasePath !== undefined
    ? settingsConfig.resolveConfiguredPath(repoConfig.worktreeBasePath)
    : settingsConfig.defaultWorktreeBasePath(repoConfig.workspaceId);
export const collectTaskDeleteTargets = (
  tasks: TaskCard[],
  taskId: string,
  deleteSubtasks: boolean,
): TaskCard[] => {
  const targetIds = new Set([taskId]);
  if (deleteSubtasks) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const task of tasks) {
        if (task.parentId && targetIds.has(task.parentId) && !targetIds.has(task.id)) {
          targetIds.add(task.id);
          changed = true;
        }
      }
    }
  }
  return tasks.filter((task) => targetIds.has(task.id));
};
export const isRelatedTaskBranch = (
  branchName: string,
  branchPrefix: string,
  taskId: string,
): boolean => {
  const cleanPrefix = branchPrefix.trim() || DEFAULT_BRANCH_PREFIX;
  const taskPrefix = `${cleanPrefix}/${taskId}`;
  return branchName === taskPrefix || branchName.startsWith(`${taskPrefix}-`);
};
export const collectRelatedTaskBranches = (
  gitPort: GitPort,
  repoPath: string,
  branchPrefix: string,
  taskIds: string[],
) =>
  Effect.gen(function* () {
    const branches = yield* gitPort.listBranches(repoPath);
    const names = new Set<string>();
    for (const branch of branches) {
      if (branch.isRemote) {
        continue;
      }
      if (taskIds.some((taskId) => isRelatedTaskBranch(branch.name, branchPrefix, taskId))) {
        names.add(branch.name);
      }
    }
    return [...names].sort();
  });
export const collectDeleteWorktreePaths = (
  dependencies: {
    gitPort: GitPort;
    settingsConfig: SettingsConfigPort;
  },
  repoPath: string,
  branchPrefix: string,
  targetTaskSessions: TaskSessionRecords[],
) =>
  Effect.gen(function* () {
    const normalizedRepo = normalizePathForComparison(repoPath);
    const seen = new Set<string>();
    const paths: string[] = [];
    for (const { taskId, sessions } of targetTaskSessions) {
      for (const session of sessions) {
        if (!implementationSessionRoles.has(session.role.trim())) {
          continue;
        }
        const workingDirectory = session.workingDirectory.trim();
        if (!workingDirectory) {
          continue;
        }
        const normalizedWorktree = normalizePathForComparison(workingDirectory);
        if (normalizedWorktree === normalizedRepo) {
          continue;
        }
        if (yield* dependencies.settingsConfig.pathExists(workingDirectory)) {
          const currentBranch = yield* dependencies.gitPort.getCurrentBranch(workingDirectory);
          const branchName = currentBranch.name?.trim();
          if (!branchName || !isRelatedTaskBranch(branchName, branchPrefix, taskId)) {
            continue;
          }
        }
        if (!seen.has(normalizedWorktree)) {
          seen.add(normalizedWorktree);
          paths.push(workingDirectory);
        }
      }
    }
    return paths;
  });
export const collectResetWorktreePaths = (
  dependencies: {
    gitPort: GitPort;
    settingsConfig: SettingsConfigPort;
  },
  repoPath: string,
  branchPrefix: string,
  taskId: string,
  sessions: AgentSessionRecord[],
  sessionRoles: Set<string>,
  operationLabel: "reset implementation" | "reset task",
) =>
  Effect.gen(function* () {
    const normalizedRepo = normalizePathForComparison(repoPath);
    const seen = new Set<string>();
    const paths: string[] = [];
    for (const session of sessions) {
      if (!sessionRoles.has(session.role.trim())) {
        continue;
      }
      const workingDirectory = session.workingDirectory.trim();
      if (!workingDirectory) {
        continue;
      }
      const normalizedWorktree = normalizePathForComparison(workingDirectory);
      if (normalizedWorktree === normalizedRepo) {
        continue;
      }
      if (yield* dependencies.settingsConfig.pathExists(workingDirectory)) {
        const currentBranch = yield* dependencies.gitPort.getCurrentBranch(workingDirectory);
        const branchName = currentBranch.name?.trim();
        if (!branchName) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "taskId",
              message: `Cannot ${operationLabel} task ${taskId} because worktree ${workingDirectory} is detached or has no active branch.`,
              details: { repoPath, taskId, workingDirectory },
            }),
          );
        }
        if (!isRelatedTaskBranch(branchName, branchPrefix, taskId)) {
          continue;
        }
      }
      if (!seen.has(normalizedWorktree)) {
        seen.add(normalizedWorktree);
        paths.push(workingDirectory);
      }
    }
    return paths;
  });
type TaskCleanupProgressInput = {
  operation: "task_close" | "task_delete" | "task_reset";
  label: "Close" | "Delete" | "Reset";
  retryVerb: "close" | "delete" | "reset";
  removedWorktrees: string[];
  deletedBranches: string[];
  completedSteps?: string[];
};

export const appendTaskCleanupProgress = <E>(
  error: E,
  {
    operation,
    label,
    retryVerb,
    removedWorktrees,
    deletedBranches,
    completedSteps = [],
  }: TaskCleanupProgressInput,
): E | HostOperationError => {
  const progress: string[] = [];
  if (removedWorktrees.length > 0) {
    progress.push(`${label} cleanup already removed worktrees: ${removedWorktrees.join(", ")}.`);
  }
  if (deletedBranches.length > 0) {
    progress.push(`${label} cleanup already deleted branches: ${deletedBranches.join(", ")}.`);
  }
  if (completedSteps.length > 0) {
    progress.push(`${label} cleanup already completed: ${completedSteps.join(", ")}.`);
  }
  if (progress.length === 0) {
    return error;
  }
  progress.push(`Retry ${retryVerb} to finish cleanup safely.`);
  return new HostOperationError({
    operation: `${operation}.cleanup`,
    message: `${errorMessage(error)}\n${progress.join("\n")}`,
    cause: error,
  });
};
export const taskHasSessionsForRoles = (
  sessions: AgentSessionRecord[],
  roles: Set<string>,
): boolean => sessions.some((session) => roles.has(session.role.trim()));
export const resetImplementationRollbackStatus = (task: TaskCard): TaskStatus => {
  if (task.documentSummary.plan.has) {
    return "ready_for_dev";
  }
  if (task.documentSummary.spec.has) {
    return "spec_ready";
  }
  return "open";
};
export const replaceTaskInList = (tasks: TaskCard[], updated: TaskCard): TaskCard[] =>
  tasks.map((task) => (task.id === updated.id ? updated : task));
