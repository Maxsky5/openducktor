import type {
  GitReadContext,
  WorkspaceProcessIssue,
  WorkspaceRecord,
} from "@openducktor/contracts";
import type { CanonicalPathPlatform } from "@openducktor/path-support";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import { pathKey } from "./process-path-keys";

export type CheckoutRootDependencies = {
  git: Pick<GitPort, "canonicalizePath" | "getCurrentBranch" | "listWorktrees" | "readCheckout">;
  settingsConfig: SettingsConfigPort;
  pathPlatform: CanonicalPathPlatform;
};

/** A checkout root that Git lists for a repository. Each canonical path has one entry. */
export type ListedRoot = {
  /** The canonical path. */
  path: string;
  key: string;
  /** The branch of the checkout. Null for a detached HEAD or a branch that the read missed. */
  branch: string | null;
};

export type WorkspaceRoots = {
  workspace: WorkspaceRecord;
  /** The canonical repository path of the workspace. */
  repoPath: string;
  /** The canonical shared Git directory of the repository. */
  commonDirectory: string;
  /** The listed roots other than `repoPath`. */
  worktrees: ListedRoot[];
  /** The registered worktrees whose paths the host cannot read. */
  unreadable: WorkspaceProcessIssue[];
  issues: WorkspaceProcessIssue[];
};

export const PATH_READ_CONCURRENCY = 16;

type ResolvedPath =
  | { kind: "path"; path: string }
  | { kind: "missing" }
  | { kind: "failed"; message: string };

/**
 * The canonical path, or `missing` when the path no longer exists, so a removed worktree links
 * nothing. Any other read failure stays visible, because it hides processes.
 */
export type PathResolver = (path: string) => Effect.Effect<ResolvedPath>;

/** A resolver for one read. Tasks and sessions often save the same path, so it reads each once. */
export const createPathResolver = (
  dependencies: Pick<CheckoutRootDependencies, "git" | "settingsConfig">,
): PathResolver => {
  const resolved = new Map<string, ResolvedPath>();
  const read = (path: string): Effect.Effect<ResolvedPath> =>
    Effect.gen(function* () {
      const exists = yield* dependencies.settingsConfig.pathExists(path).pipe(Effect.result);
      if (exists._tag === "Failure") return { kind: "failed", message: exists.failure.message };
      if (!exists.success) return { kind: "missing" };
      const canonical = yield* dependencies.git.canonicalizePath(path).pipe(Effect.result);
      return canonical._tag === "Success"
        ? { kind: "path", path: canonical.success }
        : { kind: "failed", message: canonical.failure.message };
    });
  return (path) =>
    Effect.gen(function* () {
      const known = resolved.get(path);
      if (known) return known;
      const result = yield* read(path);
      resolved.set(path, result);
      return result;
    });
};

export const unreadablePathIssue = (path: string, message: string): WorkspaceProcessIssue => ({
  message: `OpenDucktor cannot read ${path}, so the processes of that worktree are hidden. ${message}`,
  nextAction: "Give this account access to the worktree, then refresh.",
});

/**
 * The root of one canonical path. Git keeps the branch of each registration, so one registration
 * gives the branch of its checkout once `confirmWorktree` proves the link. When several
 * registrations lead to one path, such as through a link, only the checkout can say its branch.
 */
const listedRoot = (
  dependencies: CheckoutRootDependencies,
  path: string,
  branches: readonly (string | null)[],
  readContext: GitReadContext,
  issues: WorkspaceProcessIssue[],
): Effect.Effect<ListedRoot> => {
  const key = pathKey(path, dependencies.pathPlatform);
  const [only] = branches;
  if (branches.length === 1) return Effect.succeed({ path, key, branch: only ?? null });
  return dependencies.git.getCurrentBranch(path, readContext).pipe(
    Effect.match({
      onSuccess: (current) => ({ path, key, branch: current.name ?? null }),
      onFailure: (failure) => {
        issues.push({
          message: `OpenDucktor cannot read the branch of ${path}, so its task link is unknown. ${failure.message}`,
          nextAction: "Check that Git can read the worktree, then refresh.",
        });
        return { path, key, branch: null };
      },
    }),
  );
};

/**
 * Reads the repository of a workspace and every root that Git lists for it. Null when the
 * repository folder no longer exists: no process can run in it, so it is not a partial read.
 */
export const readWorkspaceRoots = (
  dependencies: CheckoutRootDependencies,
  workspace: WorkspaceRecord,
  readContext: GitReadContext,
  resolvePath: PathResolver,
) =>
  Effect.gen(function* () {
    const keyOf = (path: string) => pathKey(path, dependencies.pathPlatform);
    if (!(yield* dependencies.settingsConfig.pathExists(workspace.repoPath))) return null;
    const repoPath = yield* dependencies.git.canonicalizePath(workspace.repoPath);
    const repository = yield* dependencies.git.readCheckout(repoPath, readContext);
    if (!repository || keyOf(repository.root) !== keyOf(repoPath))
      return yield* new HostOperationError({
        operation: "processes.readCheckouts",
        message: `Git does not read ${repoPath} as a checkout root.`,
      });
    const listed = yield* dependencies.git.listWorktrees(repoPath);
    const resolved = yield* Effect.forEach(
      listed,
      (entry) => resolvePath(entry.worktreePath).pipe(Effect.map((path) => ({ entry, path }))),
      { concurrency: PATH_READ_CONCURRENCY },
    );
    const unreadable: WorkspaceProcessIssue[] = [];
    const branchesByPath = new Map<string, { path: string; branches: (string | null)[] }>();
    for (const { entry, path } of resolved) {
      if (path.kind === "failed")
        unreadable.push(unreadablePathIssue(entry.worktreePath, path.message));
      if (path.kind !== "path") continue;
      const key = keyOf(path.path);
      const group = branchesByPath.get(key) ?? { path: path.path, branches: [] };
      group.branches.push(entry.branch);
      branchesByPath.set(key, group);
    }
    // A workspace can open a linked worktree, so the main worktree can be another root.
    branchesByPath.delete(keyOf(repoPath));
    const issues: WorkspaceProcessIssue[] = [];
    const worktrees = yield* Effect.forEach(
      [...branchesByPath.values()],
      (group) => listedRoot(dependencies, group.path, group.branches, readContext, issues),
      { concurrency: PATH_READ_CONCURRENCY },
    );
    return {
      workspace,
      repoPath,
      commonDirectory: repository.commonDirectory,
      worktrees,
      unreadable,
      issues,
    } satisfies WorkspaceRoots;
  });
