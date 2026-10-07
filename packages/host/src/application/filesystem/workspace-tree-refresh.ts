import type {
  WorkspaceFileTreeContext,
  WorkspaceFileTreeCursor,
  WorkspaceFileTreeEntry,
  WorkspaceFileTreeRefreshInput,
  WorkspaceFileTreeRefreshResult,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError, type HostValidationErrorAggregate } from "../../effect/host-errors";
import type { FilesystemPort } from "../../ports/filesystem-port";
import type {
  GitPort,
  GitChangedFile,
  GitFileStatus,
  GitFileListEntry,
  GitPortError,
} from "../../ports/git-port";
import {
  canonicalizeWorkspaceRoot,
  loadWorkspaceFileEntries,
  workspaceFileValidationError,
} from "./workspace-file-access";
import { toWorkspaceRelativeGitPath } from "./workspace-files-paths";
import { compareWorkspacePaths, buildWorkspaceTree } from "./workspace-files-projection";
import { topPaths, inRegion, parentPath, WorkspaceTreeIndex } from "./workspace-tree-index";
import { createSerialGate } from "../../effect/serial-gate";

type TreeGit = Pick<
  GitPort,
  | "getFileTreeContext"
  | "listFileRegions"
  | "getRepositoryRoot"
  | "getStatus"
  | "listChangedFiles"
  | "isGitRepository"
  | "listFiles"
>;
type Change = {
  before: WorkspaceFileTreeEntry | undefined;
  after: WorkspaceFileTreeEntry | undefined;
};
type View = {
  context: WorkspaceFileTreeContext;
  cursor: WorkspaceFileTreeCursor;
  inventory: WorkspaceTreeIndex<GitFileListEntry>;
  visible: WorkspaceTreeIndex<WorkspaceFileTreeEntry>;
  statuses: GitFileStatus[];
  comparison: GitChangedFile[];
  journal: { revision: number; changes: Map<string, Change> }[];
  journalSize: number;
  retainedFrom: number;
};
type Reset = Extract<WorkspaceFileTreeRefreshResult, { kind: "reset_required" }>;
type History = Pick<View, "context" | "cursor" | "journal" | "retainedFrom">;
/** Share reads by refresh ID, lock each root, and drop retained views on shutdown. */
export const createWorkspaceTreeRefresh = (filesystem: FilesystemPort, git: TreeGit) => {
  const views = new Map<string, View>();
  let disposed = false;
  const locks = createSerialGate();
  type Operation = {
    read: Effect.Effect<WorkspaceFileTreeRefreshResult, HostValidationErrorAggregate>;
    settled: boolean;
    contextKey: string;
    viewId?: string;
    history?: History;
  };
  const requests = new Map<string, Operation>();
  const respond = (
    operation: Operation,
    result: WorkspaceFileTreeRefreshResult,
    input: WorkspaceFileTreeRefreshInput,
  ): WorkspaceFileTreeRefreshResult => {
    return input.mode === "incremental" && operation.history
      ? patchSince(operation.history, input.base)
      : result;
  };
  const pruneRequests = () => {
    for (const [key, operation] of requests) {
      if (!operation.settled) continue;
      if (
        (operation.viewId && views.get(operation.contextKey)?.cursor.viewId !== operation.viewId) ||
        requests.size > 64
      )
        requests.delete(key);
    }
  };

  const refresh = (input: WorkspaceFileTreeRefreshInput) =>
    Effect.gen(function* () {
      if (disposed)
        return yield* new HostValidationError({
          message: "Workspace file service has stopped. Restart the host to refresh files.",
        });
      const root = yield* canonicalizeWorkspaceRoot(filesystem, input.rootPath);
      const key = JSON.stringify([root, input.targetBranch ?? null]);
      // Full and incremental reads cache different response forms.
      const requestKey = JSON.stringify([key, input.refreshId, input.mode]);
      const existing = requests.get(requestKey);
      if (existing) return respond(existing, yield* existing.read, input);
      const needsFull = input.mode === "full" && views.has(key);
      const run = locks
        .run(
          key,
          Effect.gen(function* () {
            if (disposed)
              return yield* new HostValidationError({
                message: "Workspace file service has stopped. Restart the host to refresh files.",
              });
            const view = views.get(key);
            if (input.mode === "incremental" && (!view || view.cursor.viewId !== input.base.viewId))
              return reset("missing_view");
            const context = yield* git.getFileTreeContext(root, input.targetBranch);
            if (input.mode === "incremental" && view && !sameContext(context, view.context))
              return reset("context_changed");
            const repositoryRoot = yield* git.getRepositoryRoot(root);
            const needsSnapshot = !view || needsFull || !sameContext(context, view.context);
            // Inventory reads can take time. Read Git badges after that inventory.
            const files = needsSnapshot ? yield* loadWorkspaceFileEntries(git, root) : [];
            // Earlier Git captures can miss unstaged edits without changing this context.
            const statuses = yield* git.getStatus(root);
            const comparison = input.targetBranch
              ? yield* git.listChangedFiles(root, input.targetBranch)
              : [];
            if (needsSnapshot) {
              const tree = yield* buildWorkspaceTree(
                filesystem,
                repositoryRoot,
                root,
                files,
                statuses,
                comparison,
              );
              const closing = yield* git.getFileTreeContext(root, input.targetBranch);
              if (!sameContext(context, closing)) return reset("context_changed");
              const inventory = new WorkspaceTreeIndex<GitFileListEntry>();
              const visible = new WorkspaceTreeIndex<WorkspaceFileTreeEntry>();
              for (const entry of files) inventory.set(entry);
              for (const entry of tree.entries) visible.set(entry);
              const fresh: View = {
                context,
                cursor: { viewId: crypto.randomUUID(), revision: 0 },
                inventory,
                visible,
                statuses,
                comparison,
                journal: [],
                journalSize: 0,
                retainedFrom: 0,
              };
              views.delete(key);
              views.set(key, fresh);
              while (views.size > 8) views.delete(views.keys().next().value!);
              return fresh;
            }

            const resetResult = yield* updateTree(
              filesystem,
              git,
              view,
              root,
              repositoryRoot,
              statuses,
              comparison,
            );
            if (resetResult) return resetResult;
            views.delete(key);
            views.set(key, view);
            return view;
          }).pipe(
            Effect.map((result): WorkspaceFileTreeRefreshResult => {
              if ("kind" in result) return result;
              operation.viewId = result.cursor.viewId;
              if (input.mode === "full") return snapshot(result);
              // Keep this revision's history before another refresh changes or prunes the view.
              operation.history = {
                context: result.context,
                cursor: result.cursor,
                journal: [...result.journal],
                retainedFrom: result.retainedFrom,
              };
              return patchSince(operation.history, input.base);
            }),
          ),
        )
        .pipe(
          Effect.mapError((cause) =>
            workspaceFileValidationError(
              cause,
              `Unable to refresh workspace files: ${cause.message}`,
              { rootPath: root },
            ),
          ),
        );
      const operation: Operation = { read: run, settled: false, contextKey: key };
      operation.read = Effect.runSync(
        Effect.cached(
          run.pipe(
            Effect.ensuring(
              Effect.sync(() => {
                operation.settled = true;
                pruneRequests();
              }),
            ),
          ),
        ),
      );
      requests.set(requestKey, operation);
      pruneRequests();
      return yield* operation.read;
    });
  return Object.assign(refresh, {
    dispose: () =>
      Effect.gen(function* () {
        disposed = true;
        yield* locks.drain();
        views.clear();
        requests.clear();
      }),
  });
};

const sameEntry = (
  a: WorkspaceFileTreeEntry | undefined,
  b: WorkspaceFileTreeEntry | undefined,
): boolean =>
  a === b ||
  (a !== undefined && b !== undefined && a.kind === b.kind && a.gitStatus === b.gitStatus);
const sameContext = (a: WorkspaceFileTreeContext, b: WorkspaceFileTreeContext): boolean =>
  JSON.stringify(a) === JSON.stringify(b);
const orderedEntries = (view: View): WorkspaceFileTreeEntry[] =>
  [...view.visible.entries.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return compareWorkspacePaths(a.path, b.path);
  });
const snapshot = (view: View): WorkspaceFileTreeRefreshResult => ({
  kind: "snapshot",
  rootPath: view.context.rootPath,
  context: view.context,
  cursor: view.cursor,
  entries: orderedEntries(view),
});
const reset = (reason: "missing_view" | "expired_revision" | "context_changed"): Reset => ({
  kind: "reset_required",
  reason,
});
const patchSince = (
  view: History,
  base: WorkspaceFileTreeCursor,
): WorkspaceFileTreeRefreshResult => {
  if (base.viewId !== view.cursor.viewId) return reset("missing_view");
  if (base.revision < view.retainedFrom || base.revision > view.cursor.revision)
    return reset("expired_revision");
  const net = new Map<string, Change>();
  for (const item of view.journal) {
    if (item.revision <= base.revision) continue;
    for (const [path, change] of item.changes) {
      const prior = net.get(path);
      net.set(path, { before: prior ? prior.before : change.before, after: change.after });
    }
  }
  const upserts: WorkspaceFileTreeEntry[] = [],
    removals: string[] = [];
  for (const [path, change] of net) {
    if (sameEntry(change.before, change.after)) continue;
    if (change.after) upserts.push(change.after);
    else removals.push(path);
  }
  const common = {
    rootPath: view.context.rootPath,
    context: view.context,
    base,
    cursor: view.cursor,
  };
  return upserts.length || removals.length
    ? { kind: "patch", ...common, upserts, removals }
    : { kind: "unchanged", ...common };
};

/** Keep the retained view unchanged until all reads pass in the same Git context. */
const updateTree = (
  filesystem: FilesystemPort,
  git: TreeGit,
  view: View,
  root: string,
  repositoryRoot: string,
  statuses: GitFileStatus[],
  comparison: GitChangedFile[],
): Effect.Effect<void | Reset, GitPortError> =>
  Effect.gen(function* () {
    const context = view.context;
    const affected = new Set<string>();
    const workspacePath = (path: string) =>
      toWorkspaceRelativeGitPath(filesystem, repositoryRoot, root, path);
    for (const record of [...view.statuses, ...view.comparison, ...statuses, ...comparison]) {
      for (const raw of [record.path, record.originalPath]) {
        if (!raw) continue;
        const path = workspacePath(raw);
        if (!path) continue;
        affected.add(path);
        let parent = parentPath(path);
        while (parent) {
          if (view.inventory.entries.has(parent)) affected.add(parent);
          parent = parentPath(parent);
        }
      }
    }
    const regions = topPaths(affected);
    const files = yield* git.listFileRegions(root, regions);
    // Keep both rename paths when only the old path lies inside this root.
    const changesInRegions = <A extends GitChangedFile>(records: A[]): A[] =>
      records.filter((record) => {
        const path = workspacePath(record.path),
          original = record.originalPath ? workspacePath(record.originalPath) : null;
        return regions.some(
          (region) => (path && inRegion(path, region)) || (original && inRegion(original, region)),
        );
      });
    const tree = yield* buildWorkspaceTree(
      filesystem,
      repositoryRoot,
      root,
      files,
      changesInRegions(statuses),
      changesInRegions(comparison),
    );
    const closing = yield* git.getFileTreeContext(root, context.targetBranch ?? undefined);
    if (!sameContext(context, closing)) return reset("context_changed");

    // Change the indexes only after all reads pass and the context still matches.
    const replacements = new Map(tree.entries.map((entry) => [entry.path, entry]));
    const changes = new Map<string, Change>();
    const stage = (path: string, after: WorkspaceFileTreeEntry | undefined) => {
      const before = view.visible.entries.get(path);
      if (!sameEntry(before, after)) changes.set(path, { before, after });
    };
    const parents = new Set<string>();
    for (const region of regions) {
      for (const old of view.visible.subtree(region)) stage(old.path, replacements.get(old.path));
      for (const old of view.inventory.subtree(region)) view.inventory.delete(old.path);
      let parent = parentPath(region);
      while (parent) {
        parents.add(parent);
        parent = parentPath(parent);
      }
    }
    for (const entry of files) view.inventory.set(entry);
    for (const entry of tree.entries) {
      if (regions.some((region) => inRegion(entry.path, region))) stage(entry.path, entry);
      else parents.add(entry.path);
    }
    for (const [path, change] of changes) {
      if (change.after) view.visible.set(change.after);
      else view.visible.delete(path);
    }
    for (const path of [...parents].sort((a, b) => b.length - a.length)) {
      const before = view.visible.entries.get(path);
      const after = view.visible.children.get(path)?.size
        ? (before ?? {
            path,
            kind: "directory" as const,
            size: null,
            mtimeMs: null,
            gitStatus: null,
          })
        : undefined;
      if (!sameEntry(before, after)) {
        changes.set(path, { before, after });
        if (after) view.visible.set(after);
        else view.visible.delete(path);
      }
    }
    view.statuses = statuses;
    view.comparison = comparison;
    if (changes.size) {
      view.cursor = { ...view.cursor, revision: view.cursor.revision + 1 };
      view.journal.push({ revision: view.cursor.revision, changes });
      view.journalSize += changes.size;
      while (view.journal.length > 32 || view.journalSize > 10_000) {
        const oldest = view.journal.shift()!;
        view.journalSize -= oldest.changes.size;
        view.retainedFrom = oldest.revision;
      }
    }
  });
