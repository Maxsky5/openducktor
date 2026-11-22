import { pathStartsWith } from "@openducktor/path-support";
import { normalizePathForComparison } from "../path-comparison";
import type { UsageWorkspace } from "./usage-projects";

/** A registered workspace with its resolved worktree folder. */
export type UsageWorkspaceLocation = {
  workspaceId: string;
  name: string;
  repoPath: string;
  worktreeBase: string;
};

/** A task of a workspace that shares its worktree folder, and the folders of its sessions. */
export type UsageWorktreeTask = {
  workspaceId: string;
  taskId: string;
  sessionDirectories: readonly string[];
};

/** The folders that group recorded usage into projects. */
export type UsageWorkspaceFolders = {
  workspaces: UsageWorkspace[];
  /** Folders without a single owner. A recorded folder inside one stays its own project. */
  separateFolders: string[];
};

/** The workspaces whose worktree folder another workspace also uses. */
export const workspacesWithSharedWorktrees = <Workspace extends UsageWorkspaceLocation>(
  workspaces: readonly Workspace[],
): Workspace[] => {
  const users = new Map<string, number>();
  for (const { worktreeBase } of workspaces) {
    const key = normalizePathForComparison(worktreeBase);
    users.set(key, (users.get(key) ?? 0) + 1);
  }
  return workspaces.filter(
    ({ worktreeBase }) => (users.get(normalizePathForComparison(worktreeBase)) ?? 0) > 1,
  );
};

/**
 * Assigns folders to workspaces. A workspace owns its repository and its worktree folder.
 *
 * Workspaces can share one worktree folder. Then each one claims only `<folder>/<task ID>` and
 * the session folders below the shared folder of its own tasks. A claim with one owner goes to
 * that workspace. The shared folder and each folder that two workspaces claim, such as an
 * imported task ID that repeats, have no single owner, so they are separate folders.
 */
export const usageWorkspaceFolders = (
  workspaces: readonly UsageWorkspaceLocation[],
  sharedTasks: readonly UsageWorktreeTask[],
  join: (...parts: string[]) => string,
): UsageWorkspaceFolders => {
  const shared = new Set(
    workspacesWithSharedWorktrees(workspaces).map((workspace) => workspace.workspaceId),
  );
  const baseOf = new Map(
    workspaces.map((workspace) => [workspace.workspaceId, workspace.worktreeBase]),
  );

  const claims = new Map<string, { path: string; owners: Set<string> }>();
  const claim = (workspaceId: string, path: string) => {
    const key = normalizePathForComparison(path);
    const entry = claims.get(key) ?? { path, owners: new Set<string>() };
    entry.owners.add(workspaceId);
    claims.set(key, entry);
  };
  for (const task of sharedTasks) {
    const base = baseOf.get(task.workspaceId);
    if (base === undefined || !shared.has(task.workspaceId)) continue;
    claim(task.workspaceId, join(base, task.taskId));
    const comparableBase = normalizePathForComparison(base);
    // A session folder below the shared folder, but never the shared folder itself.
    for (const directory of task.sessionDirectories)
      if (
        pathStartsWith(directory, base) &&
        normalizePathForComparison(directory) !== comparableBase
      )
        claim(task.workspaceId, directory);
  }

  const separateFolders = new Map<string, string>();
  for (const workspace of workspaces)
    if (shared.has(workspace.workspaceId))
      separateFolders.set(
        normalizePathForComparison(workspace.worktreeBase),
        workspace.worktreeBase,
      );
  for (const [key, { path, owners }] of claims) if (owners.size > 1) separateFolders.set(key, path);

  const ownedBy = (workspaceId: string) =>
    [...claims.values()]
      .filter(({ owners }) => owners.size === 1 && owners.has(workspaceId))
      .map(({ path }) => path);

  return {
    separateFolders: [...separateFolders.values()],
    workspaces: workspaces.map((workspace) => ({
      workspaceId: workspace.workspaceId,
      name: workspace.name,
      repoPath: workspace.repoPath,
      roots: [
        workspace.repoPath,
        ...(shared.has(workspace.workspaceId)
          ? ownedBy(workspace.workspaceId)
          : [workspace.worktreeBase]),
      ],
    })),
  };
};
