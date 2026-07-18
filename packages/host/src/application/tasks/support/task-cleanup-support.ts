import {
  type AgentSessionRecord,
  DEFAULT_BRANCH_PREFIX,
  type RepoConfig,
  type TaskCard,
  type TaskStatus,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../../domain/path-comparison";
import {
  errorMessage,
  HostDependencyError,
  HostOperationError,
  HostValidationError,
} from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { WorktreeFilePort } from "../../../ports/worktree-file-port";
import type { DevServerService } from "../../dev-servers/dev-server-service";
import { removeWorktreeAndFilesystemPath } from "../../git/worktree-removal";
import type { TaskTerminalCleanupPort } from "../task-service";
export const implementationSessionRoleNames = ["build", "qa"] as const;
export const workflowCleanupSessionRoleNames = ["spec", "planner", "build", "qa"] as const;
const implementationSessionRoles = new Set<string>(implementationSessionRoleNames);
export const workflowCleanupSessionRoles = new Set<string>(workflowCleanupSessionRoleNames);
export type TaskSessionRecords = {
  taskId: string;
  sessions: AgentSessionRecord[];
};
export const collectSessionsUsingCanonicalWorktree = (
  gitPort: GitPort,
  settingsConfig: SettingsConfigPort,
  sessions: AgentSessionRecord[],
  canonicalWorktreePath: string,
) =>
  Effect.gen(function* () {
    const guarded: AgentSessionRecord[] = [];
    const canonicalExists = yield* settingsConfig.pathExists(canonicalWorktreePath);
    const canonical = canonicalExists
      ? normalizePathForComparison(yield* gitPort.canonicalizePath(canonicalWorktreePath))
      : null;
    for (const session of sessions) {
      if (implementationSessionRoles.has(session.role.trim())) {
        guarded.push(session);
      } else if (
        canonical &&
        (yield* settingsConfig.pathExists(session.workingDirectory)) &&
        normalizePathForComparison(yield* gitPort.canonicalizePath(session.workingDirectory)) ===
          canonical
      ) {
        guarded.push(session);
      }
    }
    return { canonicalExists, guarded };
  });
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
const isRelatedTaskBranch = (branchName: string, branchPrefix: string, taskId: string): boolean => {
  const cleanPrefix = branchPrefix.trim().replace(/\/+$/g, "") || DEFAULT_BRANCH_PREFIX;
  const taskPrefix = `${cleanPrefix}/${taskId}`;
  return branchName === taskPrefix || branchName.startsWith(`${taskPrefix}-`);
};
export const validateExistingTaskWorktreeCandidate = (
  gitPort: GitPort,
  repoPath: string,
  worktreePath: string,
  branchPrefix: string,
  taskId: string,
  operationLabel: string,
) =>
  Effect.gen(function* () {
    const canonicalRepoPath = yield* gitPort.canonicalizePath(repoPath);
    const canonicalWorktreePath = yield* gitPort.canonicalizePath(worktreePath);
    if (
      normalizePathForComparison(canonicalWorktreePath) ===
      normalizePathForComparison(canonicalRepoPath)
    ) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "taskId",
          message: `Cannot ${operationLabel} task ${taskId} because worktree ${worktreePath} resolves to the repository root.`,
          details: { repoPath: canonicalRepoPath, taskId, worktreePath: canonicalWorktreePath },
        }),
      );
    }
    if (!(yield* gitPort.isGitRepository(canonicalWorktreePath))) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "taskId",
          message: `Cannot ${operationLabel} task ${taskId} because ${worktreePath} is not a Git worktree owned by the repository.`,
          details: { repoPath: canonicalRepoPath, taskId, worktreePath: canonicalWorktreePath },
        }),
      );
    }
    const [sharesCommonDirectory, registered] = yield* Effect.all([
      gitPort.shareGitCommonDirectory(canonicalRepoPath, canonicalWorktreePath),
      gitPort.isRegisteredWorktree(canonicalRepoPath, canonicalWorktreePath),
    ]);
    if (!sharesCommonDirectory || !registered) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "taskId",
          message: `Cannot ${operationLabel} task ${taskId} because ${worktreePath} is not a registered worktree of ${canonicalRepoPath}.`,
          details: { repoPath: canonicalRepoPath, taskId, worktreePath: canonicalWorktreePath },
        }),
      );
    }
    const currentBranch = yield* gitPort.getCurrentBranch(canonicalWorktreePath);
    const branchName = currentBranch.name?.trim();
    if (
      !branchName ||
      currentBranch.detached ||
      !isRelatedTaskBranch(branchName, branchPrefix, taskId)
    ) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "taskId",
          message: `Cannot ${operationLabel} task ${taskId} because worktree ${worktreePath} is not on its task branch.`,
          details: {
            repoPath: canonicalRepoPath,
            taskId,
            worktreePath: canonicalWorktreePath,
            actualBranch: branchName,
          },
        }),
      );
    }
    return canonicalWorktreePath;
  });
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
const collectManagedTaskWorktreePaths = (
  dependencies: {
    gitPort: GitPort;
    settingsConfig: SettingsConfigPort;
  },
  repoPath: string,
  managedWorktreeBasePath: string,
  branchPrefix: string,
  targetTaskSessions: Array<TaskSessionRecords & { sessionRoles: Set<string> }>,
  operationLabel: "delete" | "reset implementation" | "reset task",
) =>
  Effect.gen(function* () {
    const normalizedRepo = normalizePathForComparison(repoPath);
    const seen = new Set<string>();
    const paths: string[] = [];
    for (const { taskId, sessions, sessionRoles } of targetTaskSessions) {
      const canonicalWorktree = dependencies.settingsConfig.join(managedWorktreeBasePath, taskId);
      const normalizedCanonical = normalizePathForComparison(canonicalWorktree);
      if (normalizedCanonical === normalizedRepo) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `Cannot ${operationLabel} task ${taskId} because its canonical worktree resolves to the repository root.`,
            details: { repoPath, taskId, canonicalWorktree },
          }),
        );
      }
      if (yield* dependencies.settingsConfig.pathExists(canonicalWorktree)) {
        const validated = yield* validateExistingTaskWorktreeCandidate(
          dependencies.gitPort,
          repoPath,
          canonicalWorktree,
          branchPrefix,
          taskId,
          operationLabel,
        );
        seen.add(normalizePathForComparison(validated));
        paths.push(validated);
      }
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
        if (seen.has(normalizedWorktree)) {
          continue;
        }
        if (yield* dependencies.settingsConfig.pathExists(workingDirectory)) {
          const validated = yield* validateExistingTaskWorktreeCandidate(
            dependencies.gitPort,
            repoPath,
            workingDirectory,
            branchPrefix,
            taskId,
            operationLabel,
          );
          const normalizedValidated = normalizePathForComparison(validated);
          if (seen.has(normalizedValidated)) continue;
          seen.add(normalizedValidated);
          paths.push(validated);
          continue;
        }
        seen.add(normalizedWorktree);
        paths.push(workingDirectory);
      }
    }
    return paths;
  });

export const collectDeleteWorktreePaths = (
  dependencies: {
    gitPort: GitPort;
    settingsConfig: SettingsConfigPort;
  },
  repoPath: string,
  managedWorktreeBasePath: string,
  branchPrefix: string,
  targetTaskSessions: TaskSessionRecords[],
) =>
  collectManagedTaskWorktreePaths(
    dependencies,
    repoPath,
    managedWorktreeBasePath,
    branchPrefix,
    targetTaskSessions.map((target) => ({
      ...target,
      sessionRoles: workflowCleanupSessionRoles,
    })),
    "delete",
  );

export const collectResetWorktreePaths = (
  dependencies: {
    gitPort: GitPort;
    settingsConfig: SettingsConfigPort;
  },
  repoPath: string,
  managedWorktreeBasePath: string,
  branchPrefix: string,
  taskId: string,
  sessions: AgentSessionRecord[],
  sessionRoles: Set<string>,
  operationLabel: "reset implementation" | "reset task",
) =>
  collectManagedTaskWorktreePaths(
    dependencies,
    repoPath,
    managedWorktreeBasePath,
    branchPrefix,
    [{ taskId, sessions, sessionRoles }],
    operationLabel,
  );
const taskCleanupProgressCopy = {
  task_close: { label: "Close", retryVerb: "close" },
  task_delete: { label: "Delete", retryVerb: "delete" },
  task_reset: { label: "Reset", retryVerb: "reset" },
  task_reset_implementation: {
    label: "Reset implementation",
    retryVerb: "reset implementation",
  },
} as const;

type TaskCleanupProgressInput = {
  operation: keyof typeof taskCleanupProgressCopy;
  removedWorktrees: string[];
  deletedBranches: string[];
  completedSteps?: string[];
};

type TaskCleanupOperation = keyof typeof taskCleanupProgressCopy;

type TaskWorktreeCleanupOperation = TaskCleanupOperation;

export type TaskCleanupProgressState = {
  removedWorktrees: string[];
  deletedBranches: string[];
  completedSteps: string[];
};

export const createTaskCleanupProgressState = (): TaskCleanupProgressState => ({
  removedWorktrees: [],
  deletedBranches: [],
  completedSteps: [],
});

const requireTaskCleanupWorktreeFiles = (
  worktreeFiles: WorktreeFilePort | undefined,
  operation: TaskWorktreeCleanupOperation,
): Effect.Effect<WorktreeFilePort, HostDependencyError> => {
  if (!worktreeFiles) {
    return Effect.fail(
      new HostDependencyError({
        dependency: "task dependency",
        message: `Worktree file port is required for ${operation}.`,
      }),
    );
  }

  return Effect.succeed(worktreeFiles);
};

export const runTaskLocalCleanup = ({
  branchNames,
  devServerService,
  gitPort,
  managedWorktreeBasePath,
  progress,
  repoPath,
  settingsConfig,
  taskIds,
  terminalService,
  worktreeCleanupOperation,
  worktreeFiles,
  worktreePaths,
}: {
  branchNames: string[];
  devServerService: DevServerService;
  gitPort: GitPort;
  managedWorktreeBasePath: string;
  progress: TaskCleanupProgressState;
  repoPath: string;
  settingsConfig: SettingsConfigPort;
  taskIds: string[];
  terminalService: TaskTerminalCleanupPort | undefined;
  worktreeCleanupOperation: TaskWorktreeCleanupOperation;
  worktreeFiles: WorktreeFilePort | undefined;
  worktreePaths: string[];
}) =>
  Effect.gen(function* () {
    if (!terminalService) {
      return yield* Effect.fail(
        new HostDependencyError({
          dependency: "TerminalService",
          operation: worktreeCleanupOperation,
          message: `Terminal service is required for ${worktreeCleanupOperation}.`,
        }),
      );
    }
    const terminalResult = yield* terminalService.acquireTaskCleanup({ repoPath, taskIds });
    progress.completedSteps.push(
      terminalResult.closedTerminalIds.length > 0
        ? `terminated task terminals: ${terminalResult.closedTerminalIds.join(", ")}`
        : "checked task terminals",
    );
    const cleanupFiles =
      worktreePaths.length > 0
        ? yield* requireTaskCleanupWorktreeFiles(worktreeFiles, worktreeCleanupOperation)
        : null;

    for (const taskId of taskIds) {
      yield* devServerService.stop({ repoPath, taskId });
    }
    progress.completedSteps.push("stopped task dev servers");

    if (cleanupFiles) {
      for (const worktreePath of worktreePaths) {
        yield* removeWorktreeAndFilesystemPath(
          {
            gitPort,
            settingsConfig,
            worktreeFiles: cleanupFiles,
          },
          {
            repoPath,
            worktreePath,
            force: true,
            managedWorktreeBasePath,
            missingOutsideManagedRootPathPolicy: "skip",
          },
        );
        progress.removedWorktrees.push(worktreePath);
      }
    }

    for (const branchName of branchNames) {
      yield* gitPort.deleteLocalBranch(repoPath, branchName, true);
      progress.deletedBranches.push(branchName);
    }
  });

export const appendTaskCleanupProgress = <E>(
  error: E,
  { operation, removedWorktrees, deletedBranches, completedSteps = [] }: TaskCleanupProgressInput,
): E | HostOperationError => {
  const copy = taskCleanupProgressCopy[operation];
  const progress: string[] = [];
  if (removedWorktrees.length > 0) {
    progress.push(
      `${copy.label} cleanup already removed worktrees: ${removedWorktrees.join(", ")}.`,
    );
  }
  if (deletedBranches.length > 0) {
    progress.push(`${copy.label} cleanup already deleted branches: ${deletedBranches.join(", ")}.`);
  }
  if (completedSteps.length > 0) {
    progress.push(`${copy.label} cleanup already completed: ${completedSteps.join(", ")}.`);
  }
  if (progress.length === 0) {
    return error;
  }
  progress.push(`Retry ${copy.retryVerb} to finish cleanup safely.`);
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
