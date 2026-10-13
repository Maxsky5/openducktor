import { describe, expect, test } from "bun:test";
import type { FileStatus, GitFileDiff, GitLocalChanges } from "@openducktor/contracts";
import { applyPendingChanges } from "./pending-local-changes";

const SNAPSHOT = { hashVersion: 2, statusHash: "0000000000000001", diffHash: "0000000000000002" };

const status = (path: string, value: string, staged: boolean): FileStatus => ({
  path,
  status: value,
  staged,
});
const diff = (file: string, type: GitFileDiff["type"] = "modified"): GitFileDiff => ({
  file,
  type,
  additions: 1,
  deletions: 0,
  diff: `@@ -1 +1 @@\n+${file}\n`,
});

const changes = (): GitLocalChanges => ({
  currentBranch: { name: "feature", detached: false, revision: "a".repeat(40) },
  fileStatuses: [],
  unstaged: {
    fileStatuses: [status("a.ts", "modified", false), status("new.ts", "untracked", false)],
    fileDiffs: [diff("a.ts"), diff("new.ts", "added")],
    snapshot: SNAPSHOT,
  },
  staged: {
    fileStatuses: [status("b.ts", "modified", true)],
    fileDiffs: [diff("b.ts")],
    snapshot: { ...SNAPSHOT, statusHash: "0000000000000003" },
  },
  conflicted: { fileStatuses: [], fileDiffs: [] },
  upstreamAheadBehind: { outcome: "untracked", ahead: 0 },
  snapshot: {
    effectiveWorkingDir: "/repo",
    targetBranch: "HEAD",
    diffScope: "uncommitted",
    observedAtMs: 1,
    ...SNAPSHOT,
  },
});

const paths = (group: GitLocalChanges["unstaged"]) => ({
  statuses: group.fileStatuses.map((entry) => `${entry.path}:${entry.status}`),
  diffs: group.fileDiffs.map((entry) => entry.file),
});

describe("applyPendingChanges", () => {
  test("moves a staged file at once and keeps the snapshots that Git sent", () => {
    const source = changes();
    const shown = applyPendingChanges(source, [
      { action: "stage", group: "unstaged", selection: { kind: "file", filePath: "new.ts" } },
    ]);

    expect(paths(shown.unstaged)).toEqual({ statuses: ["a.ts:modified"], diffs: ["a.ts"] });
    expect(paths(shown.staged)).toEqual({
      statuses: ["b.ts:modified", "new.ts:added"],
      diffs: ["b.ts", "new.ts"],
    });
    expect(shown.staged.fileStatuses.every((entry) => entry.staged)).toBe(true);
    expect(shown.unstaged.snapshot).toBe(source.unstaged.snapshot);
    expect(shown.staged.snapshot).toBe(source.staged.snapshot);
  });

  test("applies queued changes in order, including Stage all and Unstage all", () => {
    const shown = applyPendingChanges(changes(), [
      { action: "stage", group: "unstaged", selection: { kind: "all" } },
      { action: "unstage", group: "staged", selection: { kind: "file", filePath: "new.ts" } },
    ]);

    expect(paths(shown.staged)).toEqual({
      statuses: ["a.ts:modified", "b.ts:modified"],
      diffs: ["a.ts", "b.ts"],
    });
    expect(paths(shown.unstaged)).toEqual({ statuses: ["new.ts:untracked"], diffs: ["new.ts"] });

    const unstagedAll = applyPendingChanges(changes(), [
      { action: "unstage", group: "staged", selection: { kind: "all" } },
    ]);
    expect(unstagedAll.staged.fileStatuses).toEqual([]);
    expect(paths(unstagedAll.unstaged).diffs).toEqual(["a.ts", "b.ts", "new.ts"]);
  });

  test("keeps the entry of a partly staged file in the other group until Git joins them", () => {
    const source = changes();
    source.staged.fileStatuses.push(status("a.ts", "modified", true));
    source.staged.fileDiffs.unshift({ ...diff("a.ts"), additions: 7 });

    const shown = applyPendingChanges(source, [
      { action: "stage", group: "unstaged", selection: { kind: "file", filePath: "a.ts" } },
    ]);

    expect(shown.unstaged.fileDiffs.map((entry) => entry.file)).toEqual(["new.ts"]);
    expect(shown.staged.fileDiffs.filter((entry) => entry.file === "a.ts")).toEqual([
      { ...diff("a.ts"), additions: 7 },
    ]);
  });

  test("leaves chunk changes and Discard to the Git result", () => {
    const source = changes();
    const shown = applyPendingChanges(source, [
      {
        action: "stage",
        group: "unstaged",
        selection: { kind: "hunk", filePath: "a.ts", hunkIndex: 0 },
      },
      { action: "discard", group: "unstaged", selection: { kind: "file", filePath: "a.ts" } },
    ]);

    expect(shown).toBe(source);
  });
});
