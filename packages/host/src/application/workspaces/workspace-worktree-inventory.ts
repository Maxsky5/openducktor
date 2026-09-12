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
  pendingWorktreePath: string | null = null,
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
    const managedBaseComparison = normalizePathForComparison(managedBaseForComparison);
    const otherWorkspacePaths: { workspaceId: string; comparison: string }[] = [];
    const overlappingBaseWorkspaces: {
      workspace: WorkspaceRecord;
      baseComparison: string;
    }[] = [];
    for (const workspace of otherWorkspaces) {
      otherWorkspacePaths.push({
        workspaceId: workspace.workspaceId,
        comparison: normalizePathForComparison(workspace.repoPath),
      });
      otherWorkspacePaths.push({
        workspaceId: workspace.workspaceId,
        comparison: normalizePathForComparison(
          yield* canonicalizeExistingPath(
            dependencies,
            dependencies.gitPort.canonicalizePath(workspace.repoPath),
            workspace.repoPath,
          ),
        ),
      });
      const otherBasePath = workspace.effectiveWorktreeBasePath;
      if (otherBasePath === null) {
        continue;
      }
      const otherBaseForComparison = normalizePathForComparison(
        yield* canonicalizeExistingPath(
          dependencies,
          dependencies.settingsConfig.canonicalizePath(otherBasePath),
          otherBasePath,
        ),
      );
      if (
        pathStartsWith(otherBaseForComparison, managedBaseComparison) ||
        pathStartsWith(managedBaseComparison, otherBaseForComparison)
      ) {
        overlappingBaseWorkspaces.push({
          workspace,
          baseComparison: otherBaseForComparison,
        });
      }
    }
    const unreadableOverlappingBaseRemoval = overlappingBaseWorkspaces.find((entry) =>
      incompleteRemovalWorkspaceIds.has(entry.workspace.workspaceId),
    );
    if (unreadableOverlappingBaseRemoval) {
      return yield* Effect.fail(
        new HostValidationError({
          message: `Cannot check task worktree ownership under ${managedWorktreeBasePath}: workspace ${unreadableOverlappingBaseRemoval.workspace.workspaceId} has an incomplete removal on an overlapping worktree base. Finish that removal first, or retry without removing task worktrees.`,
          field: "worktreePath",
          details: {
            repoPath,
            overlappingWorkspaceId: unreadableOverlappingBaseRemoval.workspace.workspaceId,
          },
        }),
      );
    }
    const deletedTaskStoreWorkspaceIds = new Set(
      catalog.incompleteRemovals
        .filter((removal) => removal.record.phase === "attachments")
        .map((removal) => removal.workspace.workspaceId),
    );
    const claimSourceWorkspaces = otherWorkspaces.filter(
      (workspace) => !deletedTaskStoreWorkspaceIds.has(workspace.workspaceId),
    );
    const otherWorkspaceClaims =
      claimSourceWorkspaces.length === 0
        ? new Set<string>()
        : yield* collectWorkspaceClaims(dependencies, claimSourceWorkspaces);

    const isOtherWorkspacePath = (comparison: string): boolean =>
      otherWorkspacePaths.some((entry) => entry.comparison === comparison);
    const findRelatedOtherWorkspacePath = (
      comparison: string,
    ): { workspaceId: string; relation: "contains" | "inside" } | undefined => {
      for (const entry of otherWorkspacePaths) {
        if (entry.comparison === comparison) {
          continue;
        }
        if (pathStartsWith(entry.comparison, comparison)) {
          return { workspaceId: entry.workspaceId, relation: "contains" };
        }
        if (pathStartsWith(comparison, entry.comparison)) {
          return { workspaceId: entry.workspaceId, relation: "inside" };
        }
      }
      return undefined;
    };

    const candidates = new Map<string, { path: string; taskId: string | null }>();
    if (pendingWorktreePath !== null) {
      candidates.set(normalizePathForComparison(pendingWorktreePath), {
        path: pendingWorktreePath,
        taskId: null,
      });
    }
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
      if (candidateComparison === repoPathComparison || isOtherWorkspacePath(candidateComparison)) {
        continue;
      }
      if (!(yield* dependencies.settingsConfig.pathExists(candidate.path))) {
        continue;
      }
      const canonicalPath = yield* dependencies.gitPort.canonicalizePath(candidate.path);
      const canonicalComparison = normalizePathForComparison(canonicalPath);
      if (canonicalComparison === repoPathComparison || isOtherWorkspacePath(canonicalComparison)) {
        continue;
      }
      if (seen.has(canonicalComparison)) {
        continue;
      }
      const containingBase = overlappingBaseWorkspaces.find((entry) =>
        pathStartsWith(entry.baseComparison, canonicalComparison),
      );
      if (containingBase) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Cannot remove ${canonicalPath}: it contains the worktree base of workspace ${containingBase.workspace.workspaceId}. Change that base first, or retry without removing task worktrees.`,
            field: "worktreePath",
            details: {
              repoPath,
              taskId: candidate.taskId,
              worktreePath: canonicalPath,
              overlappingWorkspaceId: containingBase.workspace.workspaceId,
            },
          }),
        );
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
      const nestedOtherWorkspacePath = findRelatedOtherWorkspacePath(canonicalComparison);
      if (nestedOtherWorkspacePath) {
        const relationDescription =
          nestedOtherWorkspacePath.relation === "contains"
            ? "it contains the repository of"
            : "it is inside the repository of";
        return yield* Effect.fail(
          new HostValidationError({
            message: `Cannot remove ${canonicalPath}: ${relationDescription} workspace ${nestedOtherWorkspacePath.workspaceId}. Move that repository or change the worktree base first, or retry without removing task worktrees.`,
            field: "worktreePath",
            details: {
              repoPath,
              taskId: candidate.taskId,
              worktreePath: canonicalPath,
              overlappingWorkspaceId: nestedOtherWorkspacePath.workspaceId,
            },
          }),
        );
      }
      const isPendingWorktreePath =
        pendingWorktreePath !== null &&
        normalizePathForComparison(pendingWorktreePath) === canonicalComparison;
      if (!isPendingWorktreePath && !inventoryPaths.has(canonicalComparison)) {
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
      if (
        normalized === repoPathComparison ||
        isOtherWorkspacePath(normalized) ||
        findRelatedOtherWorkspacePath(normalized) !== undefined
      ) {
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
