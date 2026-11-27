import {
  backgroundStep,
  updateBackgroundOperation,
} from "../../operation-progress/background-operation-progress";
import type { TaskWorkflow } from "@openducktor/workflows";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../../domain/path-comparison";
import { cleanTaskBranchPrefix } from "../../../domain/task";
import {
  errorMessage,
  HostDependencyError,
  HostOperationError,
  HostValidationError,
} from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { TaskStorePort } from "../../../ports/task-repository-ports";
import type { WorktreeFilePort } from "../../../ports/worktree-file-port";
import {
  type BrowserOwnerCleanupPort,
  closeOwnerBrowserTabs,
} from "../../browser/browser-owner-cleanup";
import {
  type RemoveWorktreeAndFilesystemPathDependencies,
  type RemoveWorktreeAndFilesystemPathInput,
  removeWorktreeAndFilesystemPath,
} from "../../git/worktree-removal";
import { classifyWorkspaceCheckout } from "../../git/workspace-checkout";
import type { TaskTerminalCleanupPort } from "../task-service";
import { type TaskCleanupOperation, type TaskCleanupProgressState } from "./task-cleanup-progress";
import type { OwnerCheckedWorktreePaths } from "./task-worktree-owner-guard";
import { type BeforeWorktreeRemovalScript, runBeforeWorktreeRemovalScript } from "./workflow-hooks";
/**
 * The roles that a whole-task cleanup stops and removes: the roles of the task workflow and the
 * roles of the task sessions. A task that moved to a version without a role keeps the sessions of
 * that role, and the cleanup releases them too.
 */
export const taskCleanupRoles = (
  workflow: TaskWorkflow,
  sessions: readonly AgentSessionRecord[],
): Set<string> =>
  new Set([
    ...workflow.definition.roles.map(({ id }) => id),
    ...sessions.map(({ role }) => role.trim()),
  ]);
export type TaskSessionRecords = {
  taskId: string;
  sessions: AgentSessionRecord[];
};
/**
 * The sessions that a worktree reset stops: the sessions of the reset roles, and every session
 * that works in the canonical task worktree.
 */
export const collectSessionsUsingCanonicalWorktree = (
  gitPort: GitPort,
  settingsConfig: SettingsConfigPort,
  resetRoles: readonly string[],
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
      if (resetRoles.includes(session.role.trim())) {
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
      sessionRoles: taskCleanupRoles(workflow, target.sessions),
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
  workspaceId,
  taskIds,
  terminalService,
}: {
  progress: TaskCleanupProgressState;
  repoPath: string;
  workspaceId: string;
  taskIds: string[];
  terminalService: TaskTerminalCleanupPort;
}) =>
  Effect.gen(function* () {
    const terminalResult = yield* backgroundStep(
      { id: "terminals", label: "Stop task terminals" },
      terminalService.acquireTaskCleanup({
        workspaceId,
        repoPath,
        taskIds,
      }),
      (result) => ({ details: result.closedTerminalIds }),
    );
    if (terminalResult.closedTerminalIds.length > 0)
      progress.completedSteps.push(
        `terminated task terminals: ${terminalResult.closedTerminalIds.join(", ")}`,
      );
  });

/** Reads the agent sessions of each task, in task order. */
export const readTaskSessionRecords = (
  taskStore: Pick<TaskStorePort, "getTaskMetadata">,
  repoPath: string,
  taskIds: readonly string[],
  workspaceId: string,
) =>
  Effect.forEach(taskIds, (taskId) =>
    taskStore.getTaskMetadata({ workspaceId, repoPath, taskId }).pipe(
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
    yield* backgroundStep(
      { id: "browser-tabs", label: "Close task browser tabs" },
      closeOwnerBrowserTabs(
        browserTabs,
        taskIds.map((taskId) => ({ kind: "task", workspaceId, taskId })),
        "task_delete.browser_tabs",
      ),
    );
    progress.completedSteps.push("closed task browser tabs");
  });

/**
 * Removes one task worktree. Each task cleanup removes a worktree here, so the before worktree
 * removal script runs in every existing worktree right before its removal. A failed command keeps
 * the worktree and fails the cleanup.
 */
export const removeTaskWorktree = (
  dependencies: RemoveWorktreeAndFilesystemPathDependencies & {
    beforeWorktreeRemoval: BeforeWorktreeRemovalScript;
  },
  input: RemoveWorktreeAndFilesystemPathInput,
) =>
  Effect.gen(function* () {
    const worktreePath = dependencies.worktreeFiles.resolveWorktreePath(
      input.repoPath,
      input.worktreePath,
    );
    if (yield* dependencies.settingsConfig.pathExists(worktreePath)) {
      yield* runBeforeWorktreeRemovalScript(dependencies.beforeWorktreeRemoval, worktreePath);
    }
    yield* removeWorktreeAndFilesystemPath(dependencies, input);
  });

export const runTaskLocalCleanup = ({
  beforeWorktreeRemoval,
  branchNames,
  gitPort,
  managedWorktreeBasePath,
  progress,
  repoPath,
  workspaceId,
  settingsConfig,
  taskIds,
  terminalService,
  worktreeCleanupOperation,
  worktreeFiles,
  worktreePaths,
  forceWorktreeRemoval = true,
  onBranchDeleting,
}: {
  /** Runs in each existing worktree right before its removal. */
  beforeWorktreeRemoval: BeforeWorktreeRemovalScript;
  branchNames: string[];
  gitPort: GitPort;
  managedWorktreeBasePath: string;
  progress: TaskCleanupProgressState;
  repoPath: string;
  workspaceId: string;
  settingsConfig: SettingsConfigPort;
  taskIds: string[];
  terminalService: TaskTerminalCleanupPort | undefined;
  worktreeCleanupOperation: TaskWorktreeCleanupOperation;
  worktreeFiles: WorktreeFilePort | undefined;
  /** The worktrees to remove, after `acquireRemovableWorktrees` checked them. */
  worktreePaths: OwnerCheckedWorktreePaths;
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

    yield* updateBackgroundOperation((operation) =>
      operation.plan(
        [
          { id: "terminals", label: "Stop task terminals" },
          ...(cleanupFiles ? [{ id: "worktrees", label: "Remove worktrees" }] : []),
          ...(branchNames.length > 0 ? [{ id: "branches", label: "Delete local branches" }] : []),
        ],
        "terminals",
      ),
    );
    yield* runTaskRuntimeCleanup({
      workspaceId,
      progress,
      repoPath,
      taskIds,
      terminalService,
    });

    if (cleanupFiles) {
      yield* backgroundStep(
        { id: "worktrees", label: "Remove worktrees" },
        Effect.gen(function* () {
          for (const worktreePath of worktreePaths) {
            yield* removeTaskWorktree(
              {
                beforeWorktreeRemoval,
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
            yield* updateBackgroundOperation((operation) =>
              operation.addResource("worktrees", {
                kind: "worktree",
                value: worktreePath,
                state: "removed",
              }),
            );
          }
        }),
      );
    }

    if (branchNames.length > 0)
      yield* backgroundStep(
        { id: "branches", label: "Delete local branches" },
        Effect.gen(function* () {
          for (const [index, branchName] of branchNames.entries()) {
            // The task worktrees are gone, so a retry cannot find a branch that only the worktree
            // checkout tied to the task. The error names each branch that stays.
            yield* gitPort.deleteLocalBranch(repoPath, branchName, true, onBranchDeleting).pipe(
              Effect.mapError((cause) => {
                const remaining = branchNames.slice(index).join(" ");
                return new HostOperationError({
                  operation: "task.cleanup.delete_branch",
                  message: `${errorMessage(cause)} OpenDucktor removed the task worktrees, so a retry may not find the branches ${remaining}. Delete them with git branch -D ${remaining}.`,
                  cause,
                });
              }),
            );
            progress.deletedBranches.push(branchName);
            yield* updateBackgroundOperation((operation) =>
              operation.addResource("branches", {
                kind: "branch",
                value: branchName,
                state: "removed",
              }),
            );
          }
        }),
      );
  });
