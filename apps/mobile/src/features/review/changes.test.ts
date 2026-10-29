import { describe, expect, test } from "bun:test";
import type { GitFileDiff, GitLocalChanges } from "@openducktor/contracts";
import type { DiffDataState } from "@openducktor/frontend-core/git/contracts";
import { createEmptyScopeState } from "@openducktor/frontend-core/git/model/scope-state";
import { buildChangesRows, type ChangesRow, directoryKey } from "./changes-list-model";
import {
  buildChangesItems,
  type ChangedFileItem,
  changedFileKey,
  changesNotices,
  changesScopeStatus,
  changesTotals,
  currentBranchLabel,
  findChangedFileDiff,
  parseChangedFileKey,
  shownTargetCounts,
  upstreamSummary,
} from "./changes-model";
import { changesViewReducer, createChangesViewState, readChangesFocus } from "./changes-view-state";
import { activeGitConflict } from "./conflict-model";
import type { DiffBodyRow } from "./diff-body-model";

const diff = (file: string, type: GitFileDiff["type"] = "modified"): GitFileDiff => ({
  file,
  type,
  additions: 2,
  deletions: 1,
  diff: `@@ -1 +1,2 @@\n-a\n+b\n+c\n`,
});

const SNAPSHOT = { hashVersion: 2, statusHash: "0000000000000001", diffHash: "0000000000000002" };

const localChanges = (): GitLocalChanges => ({
  currentBranch: { name: "feature", detached: false },
  fileStatuses: [],
  unstaged: {
    fileStatuses: [],
    fileDiffs: [diff("src/a.ts"), diff("src/new.ts", "added")],
    snapshot: SNAPSHOT,
  },
  staged: { fileStatuses: [], fileDiffs: [diff("src/a.ts")], snapshot: SNAPSHOT },
  conflicted: { fileStatuses: [], fileDiffs: [diff("src/conflict.ts")] },
  upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 2 },
  snapshot: {
    effectiveWorkingDir: "/repo/wt",
    targetBranch: "HEAD",
    diffScope: "uncommitted",
    observedAtMs: 1,
    ...SNAPSHOT,
  },
});

const diffData = (overrides: Partial<DiffDataState> = {}): DiffDataState => ({
  repoPath: "/repo",
  branch: "feature",
  worktreePath: "/repo/wt",
  targetBranch: "origin/main",
  comparisonReference: "refs/remotes/origin/main",
  comparisonPending: false,
  comparisonUnavailableReason: null,
  gitConflict: null,
  scopeStatesByScope: {
    uncommitted: {
      ...createEmptyScopeState(),
      localChanges: localChanges(),
      uncommittedFileCount: 3,
    },
    target: { ...createEmptyScopeState(), fileDiffs: [diff("src/branch.ts", "deleted")] },
  },
  loadedScopesByScope: { uncommitted: true, target: true },
  commitsAheadBehind: { ahead: 3, behind: 0 },
  upstreamAheadBehind: { ahead: 1, behind: 2 },
  upstreamStatus: "tracking",
  fileStatuses: [],
  hashVersion: null,
  statusHash: null,
  diffHash: null,
  uncommittedFileCount: 3,
  isLoading: false,
  ...overrides,
});

const worktree = (fileCount: number) =>
  ({ fileCount, contextMode: "worktree", directoryProblem: null }) as const;

describe("changed file list", () => {
  test("reads the group and path back from a file key", () => {
    expect(parseChangedFileKey(changedFileKey("staged", "docs/a:b.md"))).toEqual({
      group: "staged",
      path: "docs/a:b.md",
    });
    expect(() => parseChangedFileKey("src/a.ts")).toThrow();
  });

  test("groups uncommitted changes as desktop does, with each status", () => {
    const items = buildChangesItems(diffData(), "uncommitted");
    expect(
      items.map((item) =>
        item.kind === "section" ? `# ${item.title}` : `${item.group}:${item.path}:${item.status}`,
      ),
    ).toEqual([
      "# Conflicts",
      "conflicted:src/conflict.ts:conflicted",
      "# Unstaged",
      "unstaged:src/a.ts:modified",
      "unstaged:src/new.ts:added",
      "# Staged",
      "staged:src/a.ts:modified",
    ]);
    const file = items.find((item) => item.kind === "file" && item.path === "src/new.ts");
    expect(file).toMatchObject({ name: "new.ts", directory: "src", additions: 2, deletions: 1 });
  });

  test("lists target changes without groups", () => {
    expect(buildChangesItems(diffData(), "target")).toEqual([
      expect.objectContaining({
        kind: "file",
        group: "target",
        path: "src/branch.ts",
        status: "deleted",
      }),
    ]);
  });

  test("finds the diff of a listed file in its group", () => {
    expect(findChangedFileDiff(diffData(), "staged", "src/a.ts")?.file).toBe("src/a.ts");
    expect(findChangedFileDiff(diffData(), "target", "src/branch.ts")?.type).toBe("deleted");
    expect(findChangedFileDiff(diffData(), "unstaged", "src/gone.ts")).toBeNull();
  });
});

describe("scope status", () => {
  test("shows loading, errors, unavailable comparisons, and empty scopes with desktop texts", () => {
    const empty = diffData({
      scopeStatesByScope: {
        uncommitted: createEmptyScopeState(),
        target: createEmptyScopeState(),
      },
      loadedScopesByScope: { uncommitted: false, target: false },
    });
    expect(changesScopeStatus(empty, "uncommitted", worktree(0))).toEqual({
      kind: "loading",
      title: "Scanning for changes...",
    });
    expect(changesScopeStatus(empty, "target", worktree(0))).toEqual({
      kind: "loading",
      title: "Checking changes against origin/main...",
    });
    expect(
      changesScopeStatus(
        diffData({
          scopeStatesByScope: {
            ...empty.scopeStatesByScope,
            uncommitted: { ...createEmptyScopeState(), error: "Git failed." },
          },
        }),
        "uncommitted",
        worktree(0),
      ),
    ).toEqual({ kind: "error", title: "Changes could not load", message: "Git failed." });
    expect(
      changesScopeStatus(
        diffData({
          comparisonReference: null,
          comparisonUnavailableReason: "Fetch origin/main first.",
        }),
        "target",
        worktree(0),
      ),
    ).toEqual({
      kind: "unavailable",
      title: "Branch changes are unavailable",
      message: "Fetch origin/main first.",
    });
    expect(changesScopeStatus(diffData(), "uncommitted", worktree(0))).toEqual({
      kind: "empty",
      title: "No changes detected",
      message: null,
    });
    expect(changesScopeStatus(diffData(), "target", worktree(0))).toEqual({
      kind: "empty",
      title: "No changes against origin/main",
      message: null,
    });
    expect(changesScopeStatus(diffData(), "target", worktree(1))).toEqual({ kind: "ready" });
    expect(
      changesScopeStatus(diffData(), "uncommitted", {
        ...worktree(0),
        directoryProblem: "Task worktree is unavailable.",
      }),
    ).toEqual({
      kind: "error",
      title: "Changes are unavailable",
      message: "Task worktree is unavailable.",
    });
    expect(
      changesScopeStatus(diffData({ isLoading: true }), "uncommitted", {
        ...worktree(0),
        directoryProblem: "Resolving task worktree...",
      }).kind,
    ).not.toBe("error");
  });

  test("a chat in the repository root names the repository and its upstream", () => {
    const repository = { fileCount: 0, contextMode: "repository", directoryProblem: null } as const;
    expect(changesScopeStatus(diffData(), "uncommitted", repository)).toEqual({
      kind: "empty",
      title: "No repository changes detected",
      message: null,
    });
    const target = diffData({ targetBranch: "" });
    target.scopeStatesByScope.target.upstreamStatus = "untracked";
    expect(changesScopeStatus(target, "target", repository)).toEqual({
      kind: "empty",
      title: "No upstream branch yet",
      message: "Push the branch first to create its upstream.",
    });
  });

  test("describes the branch, the target counts, and the upstream as desktop does", () => {
    expect(currentBranchLabel({ detached: true, revision: "abcdef1234" }, null, false)).toBe(
      "Detached HEAD at abcdef1",
    );
    expect(currentBranchLabel(null, "feature", false)).toBe("feature");
    expect(currentBranchLabel(null, null, true)).toBe("Reading branch...");
    // A failed branch read leaves no branch once Git stops reading.
    expect(currentBranchLabel(null, null, false)).toBe("Branch unavailable");
    expect(shownTargetCounts(diffData())).toEqual({ ahead: 3, behind: 0 });
    expect(shownTargetCounts(diffData({ commitsAheadBehind: { ahead: 0, behind: 0 } }))).toBeNull();
    expect(shownTargetCounts(diffData({ comparisonPending: true }))).toBeNull();
    expect(upstreamSummary(diffData())).toEqual({ kind: "counts", ahead: 1, behind: 2 });
    expect(upstreamSummary(diffData({ upstreamAheadBehind: { ahead: 0, behind: 0 } }))).toEqual({
      kind: "none",
    });
    expect(
      upstreamSummary(
        diffData({ upstreamStatus: "untracked", upstreamAheadBehind: { ahead: 1, behind: 0 } }),
      ),
    ).toEqual({ kind: "unpublished", ahead: 1 });
    expect(upstreamSummary(diffData({ upstreamStatus: "error" }))).toEqual({ kind: "none" });
  });

  test("leaves a missing comparison branch to the Branch changes list", () => {
    const missing = diffData({
      comparisonReference: null,
      comparisonUnavailableReason: "Fetch origin/main first.",
    });
    expect(changesNotices(missing, null, "target")).toEqual([]);
    expect(changesNotices(missing, null, "uncommitted")).toEqual([
      { key: "comparison", tone: "muted", text: "Fetch origin/main first." },
    ]);
  });

  test("counts the list totals", () => {
    // src/a.ts is in two groups: it counts once as a file and twice in the line totals.
    expect(changesTotals(buildChangesItems(diffData(), "uncommitted"))).toEqual({
      fileCount: 3,
      additions: 8,
      deletions: 4,
    });
  });
});

describe("view state focus", () => {
  test("opens the scope of a focus with the diff of its file in each group", () => {
    const branch = createChangesViewState("list", { scope: "target", path: "src/a.ts" });
    expect(branch.scope).toBe("target");
    expect(branch.viewMode).toBe("list");
    expect([...branch.expandedFiles]).toEqual(["target:src/a.ts"]);
    const local = createChangesViewState("tree", { scope: "uncommitted", path: "b.ts" });
    expect(local.scope).toBe("uncommitted");
    expect([...local.expandedFiles]).toEqual(["conflicted:b.ts", "unstaged:b.ts", "staged:b.ts"]);
  });

  test("reads a focus only from a known scope and a file", () => {
    expect(readChangesFocus("target", "a.ts")).toEqual({ scope: "target", path: "a.ts" });
    expect(readChangesFocus("uncommitted", "a.ts")).toEqual({ scope: "uncommitted", path: "a.ts" });
    expect(readChangesFocus("staged", "a.ts")).toBeNull();
    expect(readChangesFocus("target", "")).toBeNull();
    expect(readChangesFocus(undefined, "a.ts")).toBeNull();
  });
});

describe("view state", () => {
  test("keeps the expanded files when the scope changes, and toggles each choice", () => {
    const state = createChangesViewState();
    expect(state.viewMode).toBe("tree");
    const expanded = changesViewReducer(state, { type: "file_toggled", fileKey: "a" });
    expect([...expanded.expandedFiles]).toEqual(["a"]);
    const target = changesViewReducer(expanded, { type: "scope_selected", scope: "target" });
    expect(target.scope).toBe("target");
    expect(target.expandedFiles).toBe(expanded.expandedFiles);
    expect(changesViewReducer(target, { type: "scope_selected", scope: "target" })).toBe(target);
    expect([
      ...changesViewReducer(expanded, { type: "file_toggled", fileKey: "a" }).expandedFiles,
    ]).toEqual([]);
    const closed = changesViewReducer(state, { type: "group_toggled", group: "staged" });
    expect(closed.collapsedGroups.has("staged")).toBe(true);
    expect(
      changesViewReducer(state, { type: "view_mode_selected", viewMode: "list" }).viewMode,
    ).toBe("list");
  });
});

const bodyOf = (file: ChangedFileItem): DiffBodyRow[] => [
  { kind: "end", key: `${file.key}|end`, fileKey: file.key },
];

const describeRow = (row: ChangesRow): string => {
  switch (row.kind) {
    case "group":
      return `# ${row.title} (${row.count})${row.open === false ? " closed" : ""}`;
    case "group-empty":
      return `  ${row.text}`;
    case "directory":
      return `${"  ".repeat(row.depth)}${row.open ? "v" : ">"} ${row.name}/`;
    case "file":
      return `${"  ".repeat(row.depth)}${row.file.name}${row.showsDirectory ? ` (${row.file.directory})` : ""}`;
    default:
      return `  [${row.kind}]`;
  }
};

describe("changes rows", () => {
  const listRows = (
    data: DiffDataState,
    choices: {
      expandedFiles?: ReadonlySet<string>;
      collapsedGroups?: ReadonlySet<"unstaged" | "staged">;
    } = {},
  ): string[] =>
    buildChangesRows({
      items: buildChangesItems(data, "uncommitted"),
      viewMode: "list",
      expandedFiles: choices.expandedFiles ?? new Set(),
      collapsedGroups: choices.collapsedGroups ?? new Set(),
      closedDirectories: new Set(),
      diffBody: bodyOf,
    }).map(describeRow);

  test("shows each group in list view, with the diff of an expanded file under its row", () => {
    expect(
      listRows(diffData(), {
        expandedFiles: new Set([changedFileKey("unstaged", "src/new.ts")]),
      }),
    ).toEqual([
      "# Conflicts (1)",
      "conflict.ts (src)",
      "# Unstaged (2)",
      "a.ts (src)",
      "new.ts (src)",
      "  [end]",
      "# Staged (1)",
      "a.ts (src)",
    ]);
  });

  test("closes a group and names an empty group, as desktop does", () => {
    const local = localChanges();
    const noStaged = diffData({
      scopeStatesByScope: {
        uncommitted: {
          ...createEmptyScopeState(),
          localChanges: {
            ...local,
            conflicted: { fileStatuses: [], fileDiffs: [] },
            staged: { ...local.staged, fileDiffs: [] },
          },
        },
        target: createEmptyScopeState(),
      },
    });
    expect(listRows(noStaged, { collapsedGroups: new Set(["unstaged"]) })).toEqual([
      "# Unstaged (2) closed",
      "# Staged (0)",
      "  No staged changes",
    ]);
  });

  test("keeps directory totals for nested, joined, and closed directories", () => {
    const tree = diffData({
      scopeStatesByScope: {
        uncommitted: createEmptyScopeState(),
        target: {
          ...createEmptyScopeState(),
          fileDiffs: [
            diff("packages/app/src/b.ts"),
            { ...diff("packages/app/src/lib/c.ts"), additions: 5, deletions: 0 },
            diff("README.md"),
            { ...diff("packages/app/src/A.ts"), additions: 0, deletions: 3 },
            { ...diff("packages/app/src/logo.png"), additions: 0, deletions: 0 },
          ],
        },
      },
    });
    const treeRows = (closed: ReadonlySet<string>): ChangesRow[] =>
      buildChangesRows({
        items: buildChangesItems(tree, "target"),
        viewMode: "tree",
        expandedFiles: new Set(),
        collapsedGroups: new Set(),
        closedDirectories: closed,
        diffBody: bodyOf,
      });
    expect(treeRows(new Set()).map(describeRow)).toEqual([
      "v packages/app/src/",
      "  v lib/",
      "    c.ts",
      "  A.ts",
      "  b.ts",
      "  logo.png",
      "README.md",
    ]);
    expect(
      treeRows(new Set([directoryKey("target", "packages/app/src/lib")])).map(describeRow),
    ).toEqual(["v packages/app/src/", "  > lib/", "  A.ts", "  b.ts", "  logo.png", "README.md"]);
    const parentTotals = { path: "packages/app/src", fileCount: 4, additions: 7, deletions: 4 };
    const nestedTotals = { path: "packages/app/src/lib", fileCount: 1, additions: 5, deletions: 0 };
    for (const { closed, expectedDirectories } of [
      { closed: new Set<string>(), expectedDirectories: [parentTotals, nestedTotals] },
      {
        closed: new Set([directoryKey("target", "packages/app/src/lib")]),
        expectedDirectories: [parentTotals, nestedTotals],
      },
      {
        closed: new Set([directoryKey("target", "packages/app/src")]),
        expectedDirectories: [parentTotals],
      },
    ]) {
      const directories = treeRows(closed).filter((row) => row.kind === "directory");
      expect(directories).toMatchObject(expectedDirectories);
    }
  });

  test("keeps directory totals separate for each local change group", () => {
    const data = diffData();
    const local = localChanges();
    data.scopeStatesByScope.uncommitted.localChanges = {
      ...local,
      staged: {
        ...local.staged,
        fileDiffs: [{ ...diff("src/a.ts"), additions: 7, deletions: 4 }],
      },
    };
    const rows = buildChangesRows({
      items: buildChangesItems(data, "uncommitted"),
      viewMode: "tree",
      expandedFiles: new Set(),
      collapsedGroups: new Set(),
      closedDirectories: new Set(),
      diffBody: bodyOf,
    });
    expect(rows.filter((row) => row.kind === "directory")).toMatchObject([
      {
        directoryKey: directoryKey("conflicted", "src"),
        fileCount: 1,
        additions: 2,
        deletions: 1,
      },
      {
        directoryKey: directoryKey("unstaged", "src"),
        fileCount: 2,
        additions: 4,
        deletions: 2,
      },
      {
        directoryKey: directoryKey("staged", "src"),
        fileCount: 1,
        additions: 7,
        deletions: 4,
      },
    ]);
  });
});

describe("git conflict", () => {
  test("uses the conflict that Git reports", () => {
    const conflict = {
      operation: "rebase" as const,
      currentBranch: "feature",
      targetBranch: "origin/main",
      conflictedFiles: ["src/conflict.ts"],
      output: "CONFLICT",
      workingDir: "/repo/wt",
    };
    expect(activeGitConflict(diffData({ gitConflict: conflict }))).toBe(conflict);
  });

  test("shows unmerged files as a conflict without an operation", () => {
    const conflict = activeGitConflict(
      diffData({ fileStatuses: [{ path: "src/conflict.ts", status: "unmerged", staged: false }] }),
    );
    expect(conflict).toMatchObject({
      operation: null,
      conflictedFiles: ["src/conflict.ts"],
      workingDir: "/repo/wt",
      currentBranch: "feature",
    });
    expect(activeGitConflict(diffData())).toBeNull();
  });
});
