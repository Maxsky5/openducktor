import type { RepoConfig, WorkspaceRecord } from "@openducktor/contracts";
import { pathStartsWith } from "@openducktor/path-support";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import { HostValidationError } from "../../effect/host-errors";
import type { GitPort, GitPortError } from "../../ports/git-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { TaskStoreError, TaskStorePort } from "../../ports/task-repository-ports";
import { managedWorktreeBaseForRepoConfig } from "../tasks/support/task-cleanup-support";
import type { WorkspaceSettingsError, WorkspaceSettingsService } from "./workspace-settings-model";

export type WorkspaceWorktreeInventoryError =
  | GitPortError
  | HostValidationError
  | TaskStoreError
  | WorkspaceSettingsError;

export type WorkspaceWorktreeInventoryDependencies = {
  gitPort: Pick<GitPort, "canonicalizePath" | "listWorktrees">;
  settingsConfig: SettingsConfigPort;
  taskStore: Pick<TaskStorePort, "listTasks" | "listAgentSessionsForTasks">;
  workspaceSettingsService: Pick<WorkspaceSettingsService, "getWorkspaceCatalog">;
};

export const collectWorkspaceTaskWorktreePaths = (
  dependencies: WorkspaceWorktreeInventoryDependencies,
  repoConfig: RepoConfig,
) =>
  Effect.gen(function* () {
    const { repoPath, workspaceId } = repoConfig;
    const tasks = yield* dependencies.taskStore.listTasks({ repoPath });
    const taskIds = tasks.map((task) => task.id);
    const sessionsByTask =
      taskIds.length === 0
        ? []
        : yield* dependencies.taskStore.listAgentSessionsForTasks({ repoPath, taskIds });
    const managedWorktreeBasePath = managedWorktreeBaseForRepoConfig(
      dependencies.settingsConfig,
      repoConfig,
    );
    const catalog = yield* dependencies.workspaceSettingsService.getWorkspaceCatalog();
    const otherWorkspaces = [...catalog.openWorkspaces, ...catalog.closedWorkspaces].filter(
      (workspace) => workspace.workspaceId !== workspaceId,
    );
    const otherWorkspacePaths = new Set(
      otherWorkspaces.map((workspace) => normalizePathForComparison(workspace.repoPath)),
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

    const candidates = new Map<string, { path: string; taskId: string }>();
    for (const task of tasks) {
      const canonicalPath = dependencies.settingsConfig.join(managedWorktreeBasePath, task.id);
      candidates.set(normalizePathForComparison(canonicalPath), {
        path: canonicalPath,
        taskId: task.id,
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
    const inventoryPaths = new Set(
      inventory.map((worktree) => normalizePathForComparison(worktree.worktreePath)),
    );
    const repoPathComparison = normalizePathForComparison(repoPath);
    const seen = new Set<string>();
    const worktreePaths: string[] = [];

    for (const [candidateComparison, candidate] of candidates) {
      if (
        candidateComparison === repoPathComparison ||
        otherWorkspacePaths.has(candidateComparison)
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
        otherWorkspacePaths.has(canonicalComparison)
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
      if (!pathStartsWith(worktree.worktreePath, managedWorktreeBasePath)) {
        continue;
      }
      if (normalized === repoPathComparison || otherWorkspacePaths.has(normalized)) {
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
          message: `Cannot classify registered worktree(s) under ${managedWorktreeBasePath}: ${unclassifiedPaths.join(
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
    for (const workspace of workspaces) {
      const tasks = yield* dependencies.taskStore.listTasks({ repoPath: workspace.repoPath });
      if (tasks.length === 0) {
        continue;
      }
      const basePath = workspace.effectiveWorktreeBasePath;
      if (basePath !== null) {
        for (const task of tasks) {
          claims.add(
            normalizePathForComparison(dependencies.settingsConfig.join(basePath, task.id)),
          );
        }
      }
      const sessionsByTask = yield* dependencies.taskStore.listAgentSessionsForTasks({
        repoPath: workspace.repoPath,
        taskIds: tasks.map((task) => task.id),
      });
      for (const record of sessionsByTask) {
        for (const session of record.agentSessions) {
          const workingDirectory = session.workingDirectory.trim();
          if (workingDirectory) {
            claims.add(normalizePathForComparison(workingDirectory));
          }
        }
      }
    }
    return claims;
  });
