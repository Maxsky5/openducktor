import type { RepoConfig, WorkspaceRecord } from "@openducktor/contracts";
import { pathStartsWith } from "@openducktor/path-support";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import {
  type HostOperationErrorAggregate,
  type HostPathAccessErrorAggregate,
  HostValidationError,
} from "../../effect/host-errors";
import type { GitPort, GitPortError } from "../../ports/git-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { TaskStoreError, TaskStorePort } from "../../ports/task-repository-ports";
import { managedWorktreeBaseForRepoConfig } from "../tasks/support/task-cleanup-support";
import type { WorkspaceSettingsError, WorkspaceSettingsService } from "./workspace-settings-model";

export type WorkspaceWorktreeInventoryError =
  | GitPortError
  | HostOperationErrorAggregate
  | HostValidationError
  | TaskStoreError
  | WorkspaceSettingsError;

export type WorkspaceWorktreeInventoryDependencies = {
  gitPort: Pick<GitPort, "canonicalizePath" | "listWorktrees">;
  settingsConfig: SettingsConfigPort;
  taskStore: Pick<TaskStorePort, "listTasks" | "listAgentSessionsForTasks">;
  workspaceSettingsService: Pick<WorkspaceSettingsService, "getWorkspaceCatalog">;
};

const canonicalizeExistingPath = <E>(
  dependencies: Pick<WorkspaceWorktreeInventoryDependencies, "settingsConfig">,
  canonicalize: Effect.Effect<string, E>,
  path: string,
): Effect.Effect<string, E | HostPathAccessErrorAggregate> =>
  Effect.gen(function* () {
    const result = yield* Effect.either(canonicalize);
    if (result._tag === "Right") {
      return result.right;
    }
    if (yield* dependencies.settingsConfig.pathExists(path)) {
      return yield* Effect.fail(result.left);
    }
    return path;
  });

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
    const managedBaseForComparison = yield* canonicalizeExistingPath(
      dependencies,
      dependencies.settingsConfig.canonicalizePath(managedWorktreeBasePath),
      managedWorktreeBasePath,
    );
    const catalog = yield* dependencies.workspaceSettingsService.getWorkspaceCatalog();
    const otherWorkspaces = [
      ...catalog.openWorkspaces,
      ...catalog.closedWorkspaces,
      ...catalog.incompleteRemovals.map((removal) => removal.workspace),
    ].filter((workspace) => workspace.workspaceId !== workspaceId);
    const incompleteRemovalWorkspaceIds = new Set(
      catalog.incompleteRemovals.map((removal) => removal.workspace.workspaceId),
    );
    const otherWorkspacePaths = new Set<string>();
    const sharedBaseWorkspaces: WorkspaceRecord[] = [];
    for (const workspace of otherWorkspaces) {
      otherWorkspacePaths.add(normalizePathForComparison(workspace.repoPath));
      otherWorkspacePaths.add(
        normalizePathForComparison(
          yield* canonicalizeExistingPath(
            dependencies,
            dependencies.gitPort.canonicalizePath(workspace.repoPath),
            workspace.repoPath,
          ),
        ),
      );
      const otherBasePath = workspace.effectiveWorktreeBasePath;
      if (otherBasePath === null) {
        continue;
      }
      const otherBaseForComparison = yield* canonicalizeExistingPath(
        dependencies,
        dependencies.settingsConfig.canonicalizePath(otherBasePath),
        otherBasePath,
      );
      if (
        normalizePathForComparison(otherBaseForComparison) ===
        normalizePathForComparison(managedBaseForComparison)
      ) {
        sharedBaseWorkspaces.push(workspace);
      }
    }
    const unreadableSharedBaseRemoval = sharedBaseWorkspaces.find((workspace) =>
      incompleteRemovalWorkspaceIds.has(workspace.workspaceId),
    );
    if (unreadableSharedBaseRemoval) {
      return yield* Effect.fail(
        new HostValidationError({
          message: `Cannot check task worktree ownership under ${managedWorktreeBasePath}: workspace ${unreadableSharedBaseRemoval.workspaceId} has an incomplete removal on the same worktree base. Finish that removal first, or retry without removing task worktrees.`,
          field: "worktreePath",
          details: {
            repoPath,
            sharedBaseWorkspaceId: unreadableSharedBaseRemoval.workspaceId,
          },
        }),
      );
    }
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
    const inventoryPaths = new Map<string, string>();
    for (const worktree of inventory) {
      const canonical = yield* Effect.either(
        dependencies.gitPort.canonicalizePath(worktree.worktreePath),
      );
      let registeredWorktreePath = worktree.worktreePath;
      if (canonical._tag === "Right") {
        registeredWorktreePath = canonical.right;
      } else if (yield* dependencies.settingsConfig.pathExists(worktree.worktreePath)) {
        return yield* Effect.fail(canonical.left);
      }
      inventoryPaths.set(normalizePathForComparison(registeredWorktreePath), worktree.worktreePath);
    }
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
      if (otherWorkspaceClaims.has(canonicalComparison)) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Cannot remove ${canonicalPath}: another workspace also claims it. Remove it manually, or retry without removing task worktrees.`,
            field: "worktreePath",
            details: { repoPath, taskId: candidate.taskId, worktreePath: canonicalPath },
          }),
        );
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
    for (const [normalized, worktreePath] of inventoryPaths) {
      if (seen.has(normalized)) {
        continue;
      }
      if (!pathStartsWith(normalized, managedBaseForComparison)) {
        continue;
      }
      if (normalized === repoPathComparison || otherWorkspacePaths.has(normalized)) {
        continue;
      }
      if (otherWorkspaceClaims.has(normalized)) {
        continue;
      }
      if (!(yield* dependencies.settingsConfig.pathExists(worktreePath))) {
        continue;
      }
      unclassifiedPaths.push(worktreePath);
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
    const addClaim = (claimPath: string) =>
      Effect.gen(function* () {
        claims.add(
          normalizePathForComparison(
            yield* canonicalizeExistingPath(
              dependencies,
              dependencies.gitPort.canonicalizePath(claimPath),
              claimPath,
            ),
          ),
        );
      });
    for (const workspace of workspaces) {
      const tasks = yield* dependencies.taskStore.listTasks({ repoPath: workspace.repoPath });
      if (tasks.length === 0) {
        continue;
      }
      const basePath = workspace.effectiveWorktreeBasePath;
      if (basePath !== null) {
        for (const task of tasks) {
          yield* addClaim(dependencies.settingsConfig.join(basePath, task.id));
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
            yield* addClaim(workingDirectory);
          }
        }
      }
    }
    return claims;
  });
