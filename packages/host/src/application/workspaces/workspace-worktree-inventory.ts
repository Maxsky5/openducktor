import type { RepoConfig, WorkspaceRecord } from "@openducktor/contracts";
import { pathStartsWith } from "@openducktor/path-support";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import { HostValidationError } from "../../effect/host-errors";
import type { GitPort, GitPortError } from "../../ports/git-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type {
  TaskStoreError,
  TaskStorePort,
  TaskOwnershipReader,
} from "../../ports/task-repository-ports";
import {
  isRelatedTaskBranch,
  managedWorktreeBaseForRepoConfig,
} from "../tasks/support/task-cleanup-support";
import type { WorkspaceSettingsError, WorkspaceSettingsService } from "./workspace-settings-model";

export type WorkspaceWorktreeInventoryError =
  | GitPortError
  | HostValidationError
  | TaskStoreError
  | WorkspaceSettingsError;

export type WorkspaceWorktreeInventoryDependencies = {
  gitPort: Pick<GitPort, "canonicalizePath" | "listWorktrees">;
  settingsConfig: SettingsConfigPort;
  taskStore: Pick<TaskStorePort, "listTaskIds" | "listAgentSessionsForTasks">;
  taskOwnership: Pick<TaskOwnershipReader, "listTaskDirectoriesForWorktreeOwnership">;
  workspaceSettingsService: Pick<WorkspaceSettingsService, "getWorkspaceCatalog">;
};

const branchMatchesTaskId = (branchName: string, taskId: string): boolean => {
  const branchLeaf = branchName.slice(branchName.lastIndexOf("/") + 1);
  return branchLeaf === taskId || branchLeaf.startsWith(`${taskId}-`);
};

export const collectWorkspaceTaskWorktreePaths = (
  dependencies: WorkspaceWorktreeInventoryDependencies,
  repoConfig: RepoConfig,
  pendingWorktreePath: string | null = null,
) =>
  Effect.gen(function* () {
    const { repoPath, workspaceId } = repoConfig;
    const taskIds = yield* dependencies.taskStore.listTaskIds({ workspaceId, repoPath });
    const sessionsByTask =
      taskIds.length === 0
        ? []
        : yield* dependencies.taskStore.listAgentSessionsForTasks({
            workspaceId,
            repoPath,
            taskIds,
          });
    const managedWorktreeBasePath = managedWorktreeBaseForRepoConfig(
      dependencies.settingsConfig,
      repoConfig,
    );
    const catalog = yield* dependencies.workspaceSettingsService.getWorkspaceCatalog();
    const completeWorkspaces = [...catalog.openWorkspaces, ...catalog.closedWorkspaces];
    const otherWorkspaces = [
      ...completeWorkspaces,
      ...catalog.incompleteRemovals.map((removal) => removal.workspace),
    ].filter((workspace) => workspace.workspaceId !== workspaceId);
    const otherWorkspacePaths = new Set(
      otherWorkspaces.map((workspace) => normalizePathForComparison(workspace.repoPath)),
    );
    const overlapsOtherWorkspace = (candidatePath: string): boolean =>
      otherWorkspaces.some(
        (workspace) =>
          pathStartsWith(candidatePath, workspace.repoPath) ||
          pathStartsWith(workspace.repoPath, candidatePath),
      );
    const sharedBaseWorkspaces = otherWorkspaces.filter(
      (workspace) =>
        workspace.effectiveWorktreeBasePath !== null &&
        normalizePathForComparison(workspace.effectiveWorktreeBasePath) ===
          normalizePathForComparison(managedWorktreeBasePath),
    );
    const otherWorkspaceClaims =
      sharedBaseWorkspaces.length === 0
        ? new Set<string>()
        : yield* collectWorkspaceClaims(dependencies, sharedBaseWorkspaces);

    const candidates = new Map<string, { path: string; taskId: string | null }>();
    if (pendingWorktreePath !== null) {
      candidates.set(normalizePathForComparison(pendingWorktreePath), {
        path: pendingWorktreePath,
        taskId: null,
      });
    }
    for (const taskId of taskIds) {
      const canonicalPath = dependencies.settingsConfig.join(managedWorktreeBasePath, taskId);
      candidates.set(normalizePathForComparison(canonicalPath), {
        path: canonicalPath,
        taskId,
      });
    }
    for (const record of sessionsByTask) {
      for (const session of record.agentSessions) {
        const workingDirectory = session.workingDirectory.trim();
        if (workingDirectory) {
          candidates.set(normalizePathForComparison(workingDirectory), {
            path: workingDirectory,
            taskId: record.taskId,
          });
        }
      }
    }

    const inventory = yield* dependencies.gitPort.listWorktrees(repoPath);
    const previousPrefixTaskPaths = new Set<string>();
    for (const worktree of inventory) {
      const { branch } = worktree;
      if (branch === null) continue;
      const taskId = taskIds.find((candidate) =>
        isRelatedTaskBranch(branch, repoConfig.branchPrefix, candidate),
      );
      if (taskId) {
        candidates.set(normalizePathForComparison(worktree.worktreePath), {
          path: worktree.worktreePath,
          taskId,
        });
      } else if (taskIds.some((candidate) => branchMatchesTaskId(branch, candidate))) {
        previousPrefixTaskPaths.add(normalizePathForComparison(worktree.worktreePath));
      }
    }
    const inventoryPaths = new Set(
      inventory.map((worktree) => normalizePathForComparison(worktree.worktreePath)),
    );
    const repoPathComparison = normalizePathForComparison(repoPath);
    const seen = new Set<string>();
    const worktreePaths: string[] = [];

    for (const [candidateComparison, candidate] of candidates) {
      if (
        candidateComparison === repoPathComparison ||
        otherWorkspacePaths.has(candidateComparison) ||
        otherWorkspaceClaims.has(candidateComparison) ||
        overlapsOtherWorkspace(candidate.path)
      ) {
        continue;
      }
      if (!(yield* dependencies.settingsConfig.pathExists(candidate.path))) {
        continue;
      }
      const canonicalPath = yield* dependencies.gitPort.canonicalizePath(candidate.path);
      const canonicalComparison = normalizePathForComparison(canonicalPath);
      if (
        canonicalComparison === repoPathComparison ||
        otherWorkspacePaths.has(canonicalComparison) ||
        otherWorkspaceClaims.has(canonicalComparison) ||
        overlapsOtherWorkspace(canonicalPath)
      ) {
        continue;
      }
      if (seen.has(canonicalComparison)) {
        continue;
      }
      if (!inventoryPaths.has(canonicalComparison)) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Cannot establish that ${canonicalPath} is a registered worktree of ${repoPath}. Remove it manually, or retry without removing task worktrees.`,
            field: "worktreePath",
            details: { repoPath, taskId: candidate.taskId, worktreePath: canonicalPath },
          }),
        );
      }
      seen.add(canonicalComparison);
      worktreePaths.push(canonicalPath);
    }

    // A worktree under our base with no task or session evidence cannot be
    // attributed. Stop instead of guessing ownership or skipping it.
    const unclassifiedPaths: string[] = [];
    for (const worktree of inventory) {
      const normalized = normalizePathForComparison(worktree.worktreePath);
      if (seen.has(normalized)) {
        continue;
      }
      if (
        !pathStartsWith(worktree.worktreePath, managedWorktreeBasePath) &&
        !previousPrefixTaskPaths.has(normalized)
      ) {
        continue;
      }
      if (
        normalized === repoPathComparison ||
        otherWorkspacePaths.has(normalized) ||
        overlapsOtherWorkspace(worktree.worktreePath)
      ) {
        continue;
      }
      if (otherWorkspaceClaims.has(normalized)) {
        continue;
      }
      if (!(yield* dependencies.settingsConfig.pathExists(worktree.worktreePath))) {
        continue;
      }
      unclassifiedPaths.push(worktree.worktreePath);
    }
    if (unclassifiedPaths.length > 0) {
      return yield* Effect.fail(
        new HostValidationError({
          message: `Cannot classify registered worktree(s) for ${repoPath}: ${unclassifiedPaths.join(
            ", ",
          )}. Remove them manually, or retry without removing task worktrees.`,
          field: "worktreePath",
          details: { repoPath, unclassifiedPaths },
        }),
      );
    }

    return worktreePaths;
  });

const collectWorkspaceClaims = (
  dependencies: WorkspaceWorktreeInventoryDependencies,
  workspaces: WorkspaceRecord[],
) =>
  Effect.gen(function* () {
    const claims = new Set<string>();
    const basePaths = new Map(
      workspaces.map((workspace) => [workspace.workspaceId, workspace.effectiveWorktreeBasePath]),
    );
    const tasks = yield* dependencies.taskOwnership.listTaskDirectoriesForWorktreeOwnership({
      workspaces,
    });
    for (const task of tasks) {
      const basePath = basePaths.get(task.workspaceId) ?? null;
      if (basePath !== null)
        claims.add(
          normalizePathForComparison(dependencies.settingsConfig.join(basePath, task.taskId)),
        );
      for (const directory of task.sessionDirectories)
        claims.add(normalizePathForComparison(directory));
    }
    return claims;
  });
