import {
  DEFAULT_BRANCH_PREFIX,
  type RepoConfig,
  type TaskCard,
  type TaskStatus,
} from "@openducktor/contracts";
import type { GitPort } from "../../../ports/git-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import { normalizePathForComparison } from "./builder-worktree-cleanup";

export const implementationSessionRoleNames = ["build", "qa"] as const;
export const taskResetSessionRoleNames = ["spec", "planner", "build", "qa"] as const;
export const implementationSessionRoles = new Set<string>(implementationSessionRoleNames);
export const taskResetSessionRoles = new Set<string>(taskResetSessionRoleNames);

export const taskHasImplementationSessions = (task: TaskCard): boolean =>
  (task.agentSessions ?? []).some((session) => implementationSessionRoles.has(session.role.trim()));

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

export const relatedTaskBranch = (
  branchName: string,
  branchPrefix: string,
  taskId: string,
): boolean => {
  const cleanPrefix = branchPrefix.trim() || DEFAULT_BRANCH_PREFIX;
  const taskPrefix = `${cleanPrefix}/${taskId}`;
  return branchName === taskPrefix || branchName.startsWith(`${taskPrefix}-`);
};

export const collectRelatedTaskBranches = async (
  gitPort: GitPort,
  repoPath: string,
  branchPrefix: string,
  taskIds: string[],
): Promise<string[]> => {
  const branches = await gitPort.listBranches(repoPath);
  const names = new Set<string>();
  for (const branch of branches) {
    if (branch.isRemote) {
      continue;
    }
    if (taskIds.some((taskId) => relatedTaskBranch(branch.name, branchPrefix, taskId))) {
      names.add(branch.name);
    }
  }

  return [...names].sort();
};

export const collectDeleteWorktreePaths = async (
  dependencies: {
    gitPort: GitPort;
    settingsConfig: SettingsConfigPort;
  },
  repoPath: string,
  branchPrefix: string,
  targetTasks: TaskCard[],
): Promise<string[]> => {
  const normalizedRepo = normalizePathForComparison(repoPath);
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const task of targetTasks) {
    for (const session of task.agentSessions ?? []) {
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
      if (await dependencies.settingsConfig.pathExists(workingDirectory)) {
        const currentBranch = await dependencies.gitPort.getCurrentBranch(workingDirectory);
        const branchName = currentBranch.name?.trim();
        if (!branchName || !relatedTaskBranch(branchName, branchPrefix, task.id)) {
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
};

export const collectResetWorktreePaths = async (
  dependencies: {
    gitPort: GitPort;
    settingsConfig: SettingsConfigPort;
  },
  repoPath: string,
  branchPrefix: string,
  task: TaskCard,
  sessionRoles: Set<string>,
  operationLabel: "reset implementation" | "reset task",
): Promise<string[]> => {
  const normalizedRepo = normalizePathForComparison(repoPath);
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const session of task.agentSessions ?? []) {
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
    if (await dependencies.settingsConfig.pathExists(workingDirectory)) {
      const currentBranch = await dependencies.gitPort.getCurrentBranch(workingDirectory);
      const branchName = currentBranch.name?.trim();
      if (!branchName) {
        throw new Error(
          `Cannot ${operationLabel} task ${task.id} because worktree ${workingDirectory} is detached or has no active branch.`,
        );
      }
      if (!relatedTaskBranch(branchName, branchPrefix, task.id)) {
        continue;
      }
    }
    if (!seen.has(normalizedWorktree)) {
      seen.add(normalizedWorktree);
      paths.push(workingDirectory);
    }
  }

  return paths;
};

export const appendDeleteCleanupProgress = (
  error: unknown,
  removedWorktrees: string[],
  deletedBranches: string[],
): Error => {
  const base = error instanceof Error ? error : new Error(String(error));
  const progress: string[] = [];
  if (removedWorktrees.length > 0) {
    progress.push(`Delete cleanup already removed worktrees: ${removedWorktrees.join(", ")}.`);
  }
  if (deletedBranches.length > 0) {
    progress.push(`Delete cleanup already deleted branches: ${deletedBranches.join(", ")}.`);
  }
  if (progress.length === 0) {
    return base;
  }

  progress.push("Retry delete to finish cleanup safely.");
  return new Error(`${base.message}\n${progress.join("\n")}`, { cause: base });
};

export const appendResetCleanupProgress = (
  error: unknown,
  removedWorktrees: string[],
  deletedBranches: string[],
  completedSteps: string[] = [],
): Error => {
  const base = error instanceof Error ? error : new Error(String(error));
  const progress: string[] = [];
  if (removedWorktrees.length > 0) {
    progress.push(`Reset cleanup already removed worktrees: ${removedWorktrees.join(", ")}.`);
  }
  if (deletedBranches.length > 0) {
    progress.push(`Reset cleanup already deleted branches: ${deletedBranches.join(", ")}.`);
  }
  if (completedSteps.length > 0) {
    progress.push(`Reset cleanup already completed: ${completedSteps.join(", ")}.`);
  }
  if (progress.length === 0) {
    return base;
  }

  progress.push("Retry reset to finish cleanup safely.");
  return new Error(`${base.message}\n${progress.join("\n")}`, { cause: base });
};

export const taskHasSessionsForRoles = (task: TaskCard, roles: Set<string>): boolean =>
  (task.agentSessions ?? []).some((session) => roles.has(session.role.trim()));

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
