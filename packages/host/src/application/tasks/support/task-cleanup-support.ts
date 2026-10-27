import type { TaskWorkflow } from "@openducktor/workflows";
import { type AgentSessionRecord, type RepoConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../../domain/path-comparison";
import { cleanTaskBranchPrefix } from "../../../domain/task";
import { HostDependencyError, HostValidationError } from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { TaskStorePort } from "../../../ports/task-repository-ports";
import type { WorktreeFilePort } from "../../../ports/worktree-file-port";
import {
  type BrowserOwnerCleanupPort,
  closeOwnerBrowserTabs,
} from "../../browser/browser-owner-cleanup";
import { removeWorktreeAndFilesystemPath } from "../../git/worktree-removal";
import { classifyWorkspaceCheckout } from "../../git/workspace-checkout";
import type { TaskTerminalCleanupPort } from "../task-service";
import { type TaskCleanupOperation, type TaskCleanupProgressState } from "./task-cleanup-progress";
/** The roles of the task workflow. Cleanup stops and removes only their sessions. */
export const workflowRoleIds = (workflow: TaskWorkflow): Set<string> =>
  new Set(workflow.definition.roles.map(({ id }) => id));
export type TaskSessionRecords = {
  taskId: string;
  sessions: AgentSessionRecord[];
};
export const collectSessionsUsingCanonicalWorktree = (
  gitPort: GitPort,
  settingsConfig: SettingsConfigPort,
  workflow: TaskWorkflow,
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
      if (workflow.worktreeRoles.includes(session.role.trim())) {
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
export const isRelatedTaskBranch = (
  branchName: string,
  branchPrefix: string,
  taskId: string,
): boolean => {
  const taskPrefix = `${cleanTaskBranchPrefix(branchPrefix)}/${taskId}`;
  return branchName === taskPrefix || branchName.startsWith(`${taskPrefix}-`);
};
export const validateExistingTaskWorktreeCandidate = (
  gitPort: GitPort,
  repoPath: string,
  worktreePath: string,
  taskId: string,
  operationLabel: string,
) =>
  Effect.gen(function* () {
    const canonicalRepoPath = yield* gitPort.canonicalizePath(repoPath);
    const canonicalWorktreePath = yield* gitPort.canonicalizePath(worktreePath);
    const checkout = yield* classifyWorkspaceCheckout(gitPort, {
      canonicalRepoPath,
      canonicalDirectory: canonicalWorktreePath,
    });
    if (checkout !== "local_worktree") {
      const reason = {
        local_repo_root: `worktree ${worktreePath} resolves to the repository root`,
        not_git_directory: `${worktreePath} is not a Git worktree owned by the repository`,
        outside_workspace: `${worktreePath} is not a registered worktree of ${canonicalRepoPath}`,
      }[checkout];
      return yield* Effect.fail(
        new HostValidationError({
          field: "taskId",
          message: `Cannot ${operationLabel} task ${taskId} because ${reason}.`,
          details: { repoPath: canonicalRepoPath, taskId, worktreePath: canonicalWorktreePath },
        }),
      );
    }
    return canonicalWorktreePath;
  });
/**
 * Lists the local task branches that cleanup deletes. Fails when a worktree that the cleanup
 * keeps has one of them checked out: Git refuses to delete that branch, and the cleanup
 * deletes branches only after it removes the task worktrees.
 */
export const collectRelatedTaskBranches = (
  gitPort: GitPort,
  repoPath: string,
  branchPrefix: string,
  taskIds: string[],
  removedWorktreePaths: string[],
  operationLabel: string,
) =>
  Effect.gen(function* () {
    const branches = yield* gitPort.listBranches(repoPath);
    const removedWorktrees = new Set(removedWorktreePaths.map(normalizePathForComparison));
    const names = new Set<string>();
    for (const branch of branches) {
      if (branch.isRemote) {
        continue;
      }
      const taskId = taskIds.find((candidate) =>
        isRelatedTaskBranch(branch.name, branchPrefix, candidate),
      );
      if (!taskId) {
        continue;
      }
      if (
        branch.worktreePath &&
        !removedWorktrees.has(normalizePathForComparison(branch.worktreePath))
      ) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `Cannot ${operationLabel} task ${taskId} because branch ${branch.name} is checked out in worktree ${branch.worktreePath}. Switch that worktree to another branch, then try again.`,
            details: { repoPath, taskId, branch: branch.name, worktreePath: branch.worktreePath },
          }),
        );
      }
      names.add(branch.name);
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
  targetTaskSessions: (TaskSessionRecords & { workflow: TaskWorkflow })[],
) =>
  collectManagedTaskWorktreePaths(
    dependencies,
    repoPath,
    managedWorktreeBasePath,
    targetTaskSessions.map(({ workflow, ...target }) => ({
      ...target,
      sessionRoles: workflowRoleIds(workflow),
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
  taskId: string,
  sessions: AgentSessionRecord[],
  sessionRoles: Set<string>,
  operationLabel: "reset implementation" | "reset task",
) =>
  collectManagedTaskWorktreePaths(
    dependencies,
    repoPath,
    managedWorktreeBasePath,
    [{ taskId, sessions, sessionRoles }],
    operationLabel,
  );

type TaskWorktreeCleanupOperation = TaskCleanupOperation;

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

export const runTaskRuntimeCleanup = ({
  progress,
  repoPath,
  taskIds,
  terminalService,
}: {
  progress: TaskCleanupProgressState;
  repoPath: string;
  taskIds: string[];
  terminalService: TaskTerminalCleanupPort;
}) =>
  Effect.gen(function* () {
    const terminalResult = yield* terminalService.acquireTaskCleanup({ repoPath, taskIds });
    progress.completedSteps.push(
      terminalResult.closedTerminalIds.length > 0
        ? `terminated task terminals: ${terminalResult.closedTerminalIds.join(", ")}`
        : "checked task terminals",
    );
  });

/** Reads the agent sessions of each task, in task order. */
export const readTaskSessionRecords = (
  taskStore: Pick<TaskStorePort, "getTaskMetadata">,
  repoPath: string,
  taskIds: readonly string[],
) =>
  Effect.forEach(taskIds, (taskId) =>
    taskStore.getTaskMetadata({ repoPath, taskId }).pipe(
      Effect.map((metadata): TaskSessionRecords => ({
        taskId,
        sessions: metadata.agentSessions,
      })),
    ),
  );

/** Closes the browser tabs of the deleted tasks before the task store deletes them. */
export const runTaskBrowserTabCleanup = ({
  browserTabs,
  progress,
  taskIds,
  workspaceId,
}: {
  browserTabs: BrowserOwnerCleanupPort | undefined;
  progress: TaskCleanupProgressState;
  taskIds: readonly string[];
  workspaceId: string;
}) =>
  Effect.gen(function* () {
    if (!browserTabs) {
      return yield* new HostDependencyError({
        dependency: "BrowserService",
        operation: "task_delete",
        message: "The browser service is required for task_delete.",
      });
    }
    yield* closeOwnerBrowserTabs(
      browserTabs,
      taskIds.map((taskId) => ({ kind: "task", workspaceId, taskId })),
      "task_delete.browser_tabs",
    );
    progress.completedSteps.push("closed task browser tabs");
  });

export const runTaskLocalCleanup = ({
  branchNames,
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
  forceWorktreeRemoval = true,
  onBranchDeleting,
}: {
  branchNames: string[];
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
  /** False makes a worktree with uncommitted changes fail the cleanup. */
  forceWorktreeRemoval?: boolean;
  /** Gets each branch and its tip just before Git deletes it, so a caller can restore it. */
  onBranchDeleting?: ((branch: { name: string; oid: string }) => void) | undefined;
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
    const cleanupFiles =
      worktreePaths.length > 0
        ? yield* requireTaskCleanupWorktreeFiles(worktreeFiles, worktreeCleanupOperation)
        : null;

    yield* runTaskRuntimeCleanup({
      progress,
      repoPath,
      taskIds,
      terminalService,
    });

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
            force: forceWorktreeRemoval,
            managedWorktreeBasePath,
            missingOutsideManagedRootPathPolicy: "skip",
          },
        );
        progress.removedWorktrees.push(worktreePath);
      }
    }

    for (const branchName of branchNames) {
      yield* gitPort.deleteLocalBranch(repoPath, branchName, true, onBranchDeleting);
      progress.deletedBranches.push(branchName);
    }
  });

export const taskHasSessionsForRoles = (
  sessions: AgentSessionRecord[],
  roles: Set<string>,
): boolean => sessions.some((session) => roles.has(session.role.trim()));

export const selectWorkflowCleanupSessionRecords = (
  workflow: TaskWorkflow,
  sessions: AgentSessionRecord[],
): AgentSessionRecord[] => sessions.filter((session) => workflow.hasRole(session.role.trim()));
