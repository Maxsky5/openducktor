import type {
  GitReadContext,
  RepoConfig,
  WorkspaceCheckoutOwner,
  WorkspaceProcessIssue,
  WorkspaceRecord,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { runtimeTitle } from "../../domain/workspace-sessions/workspace-session-title";
import type { HostError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type {
  TaskOwnershipReader,
  TaskStoreError,
  TaskWorktreeDirectories,
} from "../../ports/task-repository-ports";
import type {
  WorkspaceSessionStorePort,
  WorktreeOwnershipChat,
} from "../../ports/workspace-session-store-port";
import { managedWorktreeBaseForRepoConfig } from "../git/managed-worktree-roots";
import { isRelatedTaskBranch } from "../tasks/support/task-cleanup-support";
import { createGitEntryWalk, type GitEntryWalk } from "./git-entry-walk";
import { keyContains, pathKey } from "./process-path-keys";
import {
  type CheckoutRootDependencies,
  type ListedRoot,
  PATH_READ_CONCURRENCY,
  createPathResolver,
  type PathResolver,
  readWorkspaceRoots,
  unreadablePathIssue,
  type WorkspaceRoots,
} from "./workspace-checkout-roots";

export type ProcessCheckoutDependencies = CheckoutRootDependencies & {
  git: Pick<GitPort, "confirmWorktree" | "hasGitEntry">;
  taskOwnership: Pick<TaskOwnershipReader, "listTaskDirectoriesForWorktreeOwnership">;
  workspaceSessions: Pick<WorkspaceSessionStorePort, "listForWorktreeOwnership">;
};

/** One checkout whose processes the Processes view shows. Git confirmed it in this read. */
export type CoveredCheckout = {
  workspaceId: string;
  workspaceName: string;
  /** The canonical checkout root. */
  checkoutPath: string;
  /** The platform comparison key of `checkoutPath`. */
  key: string;
  kind: "repository" | "worktree";
  owners: WorkspaceCheckoutOwner[];
};

type CoverageRoot = { key: string; checkout: CoveredCheckout | null };

/**
 * The covered checkouts and every other root that Git lists for the covered repositories. A root
 * without a checkout is a boundary: Git decides the checkout of a process below it.
 */
export type CheckoutCoverage = {
  checkouts: CoveredCheckout[];
  roots: readonly CoverageRoot[];
  issues: WorkspaceProcessIssue[];
};

/** The helpers of one read. They read each path and folder once. */
export type ProcessRead = {
  context: GitReadContext;
  resolvePath: PathResolver;
  walkGitEntries: GitEntryWalk;
  /** The Git roots of a workspace, or null when its repository folder no longer exists. */
  readRoots: (workspace: WorkspaceRecord) => Effect.Effect<WorkspaceRoots | null, HostError>;
};

/** Git roots from earlier reads, by workspace, with the repository path and time of each read. */
export type RootsReuse = {
  cache: Map<string, { repoPath: string; readAt: number; roots: WorkspaceRoots | null }>;
  maxAgeMs: number;
  now: () => number;
};

/**
 * The helpers of one read. With `reuse`, the read takes the Git roots of a workspace from an
 * earlier read that is younger than `maxAgeMs`, so it starts no Git process for them.
 */
export const createProcessRead = (
  dependencies: ProcessCheckoutDependencies,
  refreshId: string,
  reuse?: RootsReuse,
): ProcessRead => {
  const context = { refreshId };
  const resolvePath = createPathResolver(dependencies);
  const readRoots = (workspace: WorkspaceRecord) => {
    const read = readWorkspaceRoots(dependencies, workspace, context, resolvePath);
    if (!reuse) return read;
    const { workspaceId, repoPath } = workspace;
    const cached = reuse.cache.get(workspaceId);
    const startedAt = reuse.now();
    if (cached?.repoPath === repoPath && startedAt - cached.readAt < reuse.maxAgeMs)
      return Effect.succeed(cached.roots);
    return read.pipe(
      Effect.tap((roots) =>
        Effect.sync(() => reuse.cache.set(workspaceId, { repoPath, readAt: startedAt, roots })),
      ),
    );
  };
  return {
    context,
    resolvePath,
    walkGitEntries: createGitEntryWalk(dependencies),
    readRoots,
  };
};

type WorkspaceLinks = {
  repoConfig: RepoConfig | undefined;
  tasks: readonly TaskWorktreeDirectories[];
  sessions: readonly WorktreeOwnershipChat[];
};

type LinkedRoot = ListedRoot & { owners: WorkspaceCheckoutOwner[] };

type WorkspaceCoverage = {
  checkouts: CoveredCheckout[];
  roots: CoverageRoot[];
  issues: WorkspaceProcessIssue[];
};

type WorkspaceRead =
  | { kind: "read"; roots: WorkspaceRoots }
  | { kind: "missing" }
  | { kind: "failed"; issue: WorkspaceProcessIssue };

const readIssue = (
  workspace: WorkspaceRecord,
  cause: { message: string },
): WorkspaceProcessIssue => ({
  message: `OpenDucktor cannot read the checkouts of workspace ${workspace.workspaceName}. ${cause.message}`,
  nextAction: "Check that the repository exists and Git can read it, then refresh.",
});

/** The deepest root that holds the key. */
const deepestRoot = <Root extends { key: string }>(
  roots: readonly Root[],
  key: string,
): Root | null => {
  let found: Root | null = null;
  for (const root of roots) {
    if (!keyContains(root.key, key)) continue;
    if (!found || root.key.length > found.key.length) found = root;
  }
  return found;
};

/**
 * Links the tasks and Workspace Sessions of one workspace to its listed roots: by the managed
 * worktree path of a task, by a saved session directory, and by the branch of a task.
 */
const linkOwners = (
  dependencies: ProcessCheckoutDependencies,
  read: ProcessRead,
  listed: WorkspaceRoots,
  links: WorkspaceLinks,
) =>
  Effect.gen(function* () {
    const { settingsConfig } = dependencies;
    const keyOf = (path: string) => pathKey(path, dependencies.pathPlatform);
    const { workspace } = listed;
    const { repoConfig } = links;
    const issues: WorkspaceProcessIssue[] = [];
    const roots: LinkedRoot[] = listed.worktrees.map((root) => ({ ...root, owners: [] }));
    const isTaskBranch = (branch: string | null, taskId: string) =>
      repoConfig !== undefined &&
      branch !== null &&
      isRelatedTaskBranch(branch, repoConfig.branchPrefix, taskId);

    // Links a saved path to the listed root whose checkout holds it.
    const linkPath = (path: string) =>
      Effect.gen(function* () {
        const resolved = yield* read.resolvePath(path);
        if (resolved.kind === "failed") issues.push(unreadablePathIssue(path, resolved.message));
        if (resolved.kind !== "path") return null;
        const key = keyOf(resolved.path);
        const root = deepestRoot(roots, key);
        if (!root || root.key === key) return root;
        // A `.git` entry between the path and the root starts another checkout.
        const nested = yield* read.walkGitEntries(resolved.path, root.key);
        if (nested === "unknown")
          issues.push({
            message: `OpenDucktor cannot read the folders of ${path}, so its worktree link is unknown.`,
            nextAction: "Give this account access to the folder, then refresh.",
          });
        return nested === false ? root : null;
      });

    issues.push(...listed.unreadable);
    const managedBase = repoConfig
      ? managedWorktreeBaseForRepoConfig(settingsConfig, repoConfig)
      : null;
    const taskRoots = yield* Effect.forEach(
      links.tasks,
      (task) =>
        Effect.gen(function* () {
          const linked = new Set<LinkedRoot>();
          if (managedBase !== null) {
            const managedPath = settingsConfig.join(managedBase, task.taskId);
            const managed = yield* linkPath(managedPath);
            if (managed) linked.add(managed);
          }
          for (const directory of task.sessionDirectories) {
            const root = yield* linkPath(directory);
            if (root) linked.add(root);
          }
          for (const root of roots) if (isTaskBranch(root.branch, task.taskId)) linked.add(root);
          return linked;
        }),
      { concurrency: PATH_READ_CONCURRENCY },
    );
    links.tasks.forEach((task, index) => {
      for (const root of taskRoots[index] ?? [])
        root.owners.push({
          kind: "task",
          workspaceId: workspace.workspaceId,
          taskId: task.taskId,
          title: task.title,
        });
    });
    const sessionRoots = yield* Effect.forEach(
      links.sessions,
      (session) => linkPath(session.workingDirectory),
      { concurrency: PATH_READ_CONCURRENCY },
    );
    links.sessions.forEach((session, index) => {
      sessionRoots[index]?.owners.push({
        kind: "workspace_session",
        workspaceId: workspace.workspaceId,
        sessionId: session.id,
        title: runtimeTitle(session) ?? "Untitled session",
      });
    });
    return { roots, issues };
  });

/** The covered checkouts of one workspace: its repository and each confirmed linked root. */
const coverWorkspace = (
  dependencies: ProcessCheckoutDependencies,
  read: ProcessRead,
  listed: WorkspaceRoots,
  links: WorkspaceLinks,
): Effect.Effect<WorkspaceCoverage> =>
  Effect.gen(function* () {
    const { workspace } = listed;
    const keyOf = (path: string) => pathKey(path, dependencies.pathPlatform);
    const { roots, issues } = yield* linkOwners(dependencies, read, listed, links);
    const linkedRoots = roots.filter((root) => root.owners.length > 0);
    const confirmed = yield* Effect.forEach(
      linkedRoots,
      (root) => dependencies.git.confirmWorktree(root.path, listed.commonDirectory),
      { concurrency: PATH_READ_CONCURRENCY },
    );
    const confirmedRoots = new Set<LinkedRoot>();
    linkedRoots.forEach((root, index) => {
      const confirmation = confirmed[index];
      if (confirmation?.kind === "confirmed") {
        confirmedRoots.add(root);
        return;
      }
      issues.push(
        confirmation?.kind === "unreadable"
          ? {
              message: `OpenDucktor cannot read the Git files of ${root.path}, so its processes are hidden. ${confirmation.message}`,
              nextAction:
                "Check that this account can read the worktree and that `git status` works in it, then refresh.",
            }
          : {
              message: `Git does not confirm ${root.path} as a worktree of workspace ${workspace.workspaceName}, so its processes are hidden.`,
              nextAction: "Restore or remove the worktree, then refresh.",
            },
      );
    });
    const repository: CoveredCheckout = {
      workspaceId: workspace.workspaceId,
      workspaceName: workspace.workspaceName,
      checkoutPath: listed.repoPath,
      key: keyOf(listed.repoPath),
      kind: "repository",
      owners: [],
    };
    const checkouts = [repository];
    const coverageRoots: CoverageRoot[] = [{ key: repository.key, checkout: repository }];
    for (const root of [...roots].sort((left, right) => left.key.localeCompare(right.key))) {
      // A root without a confirmed link stays a boundary, so Git decides its processes.
      const checkout: CoveredCheckout | null = confirmedRoots.has(root)
        ? {
            workspaceId: workspace.workspaceId,
            workspaceName: workspace.workspaceName,
            checkoutPath: root.path,
            key: root.key,
            kind: "worktree",
            owners: root.owners,
          }
        : null;
      if (checkout) checkouts.push(checkout);
      coverageRoots.push({ key: root.key, checkout });
    }
    return { checkouts, roots: coverageRoots, issues: [...listed.issues, ...issues] };
  });

/**
 * Reads the checkouts of the workspaces and their task and Workspace Session links. Closed tasks
 * and archived sessions keep their links while their worktree exists. Git must confirm each
 * linked worktree as a checkout of its repository, so a stale registration covers nothing.
 */
export const readCheckoutCoverage = (
  dependencies: ProcessCheckoutDependencies,
  workspaces: readonly WorkspaceRecord[],
  read: ProcessRead,
): Effect.Effect<CheckoutCoverage, HostError | TaskStoreError> =>
  Effect.gen(function* () {
    if (workspaces.length === 0) return { checkouts: [], roots: [], issues: [] };
    const scopes = workspaces.map((workspace) => ({
      workspaceId: workspace.workspaceId,
      repoPath: workspace.repoPath,
    }));
    // The Git reads and the stored links load at once. The Git reads keep catalog order for
    // shared checkouts.
    const [reads, config, tasks, sessions] = yield* Effect.all(
      [
        Effect.forEach(
          workspaces,
          (workspace) =>
            read.readRoots(workspace).pipe(
              Effect.match({
                onSuccess: (roots): WorkspaceRead =>
                  roots ? { kind: "read", roots } : { kind: "missing" },
                onFailure: (failure): WorkspaceRead => ({
                  kind: "failed",
                  issue: readIssue(workspace, failure),
                }),
              }),
            ),
          { concurrency: 4 },
        ),
        dependencies.settingsConfig.readConfig(scopes.map((scope) => scope.workspaceId)),
        dependencies.taskOwnership.listTaskDirectoriesForWorktreeOwnership({ workspaces: scopes }),
        dependencies.workspaceSessions.listForWorktreeOwnership({ workspaces: scopes }),
      ],
      { concurrency: 4 },
    );
    const issues: WorkspaceProcessIssue[] = [];
    const readable: WorkspaceRoots[] = [];
    for (const entry of reads) {
      if (entry.kind === "read") readable.push(entry.roots);
      if (entry.kind === "failed") issues.push(entry.issue);
    }
    const covered = yield* Effect.forEach(
      readable,
      (roots) => {
        const { workspaceId } = roots.workspace;
        return coverWorkspace(dependencies, read, roots, {
          repoConfig: config.workspaces[workspaceId],
          tasks: tasks.filter((task) => task.workspaceId === workspaceId),
          sessions: sessions.filter((session) => session.workspaceId === workspaceId),
        });
      },
      { concurrency: 4 },
    );
    return mergeSharedCheckouts({
      checkouts: covered.flatMap((entry) => entry.checkouts),
      roots: covered.flatMap((entry) => entry.roots),
      issues: [...issues, ...covered.flatMap((entry) => entry.issues)],
    });
  });

/**
 * Keeps one group for a checkout that several workspaces link. The workspace that uses it as its
 * repository checkout keeps it, or else the first linked workspace in catalog order.
 */
const mergeSharedCheckouts = (coverage: CheckoutCoverage): CheckoutCoverage => {
  const kept = new Map<string, CoveredCheckout>();
  for (const checkout of coverage.checkouts) {
    const existing = kept.get(checkout.key);
    if (!existing) {
      kept.set(checkout.key, checkout);
      continue;
    }
    const [first, second] =
      checkout.kind === "repository" && existing.kind !== "repository"
        ? [checkout, existing]
        : [existing, checkout];
    kept.set(checkout.key, { ...first, owners: [...first.owners, ...second.owners] });
  }
  const roots = new Map(coverage.roots.map((root) => [root.key, kept.get(root.key) ?? null]));
  return {
    checkouts: [...kept.values()],
    roots: [...roots].map(([key, checkout]) => ({ key, checkout })),
    issues: coverage.issues,
  };
};

/** The key of the parent folder, or null at the file system root. Keys use `/` on every system. */
const parentKey = (key: string): string | null => {
  const index = key.lastIndexOf("/");
  if (index === -1 || key === "/" || /^[A-Z]:\/$/.test(key)) return null;
  const parent = key.slice(0, index);
  if (parent === "") return "/";
  // A Windows drive root keeps its separator, as `pathKey` writes it.
  return /^[A-Z]:$/.test(parent) ? `${parent}/` : parent;
};

const rootIndexes = new WeakMap<CheckoutCoverage, ReadonlyMap<string, CoverageRoot>>();

/**
 * The deepest listed root that holds a key, or null when no covered repository holds it. A read
 * looks up each process of the machine, so the lookup climbs the parent folders of the key in an
 * index instead of comparing the key with every root.
 */
export const findCheckoutRoot = (coverage: CheckoutCoverage, key: string): CoverageRoot | null => {
  let index = rootIndexes.get(coverage);
  if (!index) {
    index = new Map(coverage.roots.map((root) => [root.key, root]));
    rootIndexes.set(coverage, index);
  }
  for (let current: string | null = key; current !== null; current = parentKey(current)) {
    const root = index.get(current);
    if (root) return root;
  }
  return null;
};
