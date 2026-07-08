import { describe, expect, test } from "bun:test";
import type { WorkspaceFileTreeEntry } from "@openducktor/contracts";
import {
  buildTaskExecutionFileTreeGitStatusEntries,
  buildTaskExecutionFileTreeInputPaths,
  normalizeTaskExecutionFileTreeSelectionPath,
  resolveTaskExecutionFileTreeSelectionEntry,
} from "./task-execution-file-explorer-model";

const fileEntry = (
  path: string,
  gitStatus: WorkspaceFileTreeEntry["gitStatus"] = null,
): WorkspaceFileTreeEntry => ({
  kind: "file",
  path,
  size: 24,
  mtimeMs: 1_760_000_000_000,
  gitStatus,
});

const directoryEntry = (path: string): WorkspaceFileTreeEntry => ({
  kind: "directory",
  path,
  size: null,
  mtimeMs: null,
  gitStatus: null,
});

describe("normalizeTaskExecutionFileTreeSelectionPath", () => {
  test("removes PierreTrees file selection prefixes", () => {
    expect(normalizeTaskExecutionFileTreeSelectionPath("f::src/App.tsx")).toBe("src/App.tsx");
  });

  test("keeps directory and unprefixed paths unchanged", () => {
    expect(normalizeTaskExecutionFileTreeSelectionPath("src")).toBe("src");
    expect(normalizeTaskExecutionFileTreeSelectionPath("src/App.tsx")).toBe("src/App.tsx");
  });
});

describe("buildTaskExecutionFileTreeInputPaths", () => {
  test("passes only file leaves to PierreTrees", () => {
    expect(
      buildTaskExecutionFileTreeInputPaths([
        directoryEntry(".agent"),
        directoryEntry(".agent/.shared"),
        fileEntry(".agent/.shared/charts.csv"),
      ]),
    ).toEqual([".agent/.shared/charts.csv"]);
  });
});

describe("buildTaskExecutionFileTreeGitStatusEntries", () => {
  test("passes changed file statuses to PierreTrees", () => {
    expect(
      buildTaskExecutionFileTreeGitStatusEntries([
        directoryEntry("packages"),
        directoryEntry("packages/frontend"),
        fileEntry("packages/frontend/src/App.tsx", "modified"),
      ]),
    ).toEqual([{ path: "packages/frontend/src/App.tsx", status: "modified" }]);
  });

  test("keeps file statuses exact", () => {
    expect(
      buildTaskExecutionFileTreeGitStatusEntries([
        fileEntry("packages/frontend/src/App.tsx", "added"),
        fileEntry("packages/frontend/src/index.ts", "deleted"),
      ]),
    ).toEqual([
      { path: "packages/frontend/src/App.tsx", status: "added" },
      { path: "packages/frontend/src/index.ts", status: "deleted" },
    ]);
  });
});

describe("resolveTaskExecutionFileTreeSelectionEntry", () => {
  test("resolves exact file paths", () => {
    const entry = fileEntry("src/App.tsx");
    const entriesByPath = new Map([[entry.path, entry]]);

    expect(resolveTaskExecutionFileTreeSelectionEntry("src/App.tsx", entriesByPath)).toBe(entry);
  });

  test("resolves flattened PierreTrees file paths", () => {
    const entry = fileEntry("src/App.tsx");
    const entriesByPath = new Map([[entry.path, entry]]);

    expect(resolveTaskExecutionFileTreeSelectionEntry("f::src/App.tsx", entriesByPath)).toBe(entry);
  });

  test("resolves unique flattened suffix paths", () => {
    const entry = fileEntry(".agent/.shared/.shared/scripts/core.py");
    const entriesByPath = new Map([[entry.path, entry]]);

    expect(resolveTaskExecutionFileTreeSelectionEntry("core.py", entriesByPath)).toBe(entry);
  });

  test("rejects ambiguous suffix paths", () => {
    const firstEntry = fileEntry("scripts/core.py");
    const secondEntry = fileEntry("tools/core.py");
    const entriesByPath = new Map([
      [firstEntry.path, firstEntry],
      [secondEntry.path, secondEntry],
    ]);

    expect(resolveTaskExecutionFileTreeSelectionEntry("core.py", entriesByPath)).toBeNull();
  });

  test("returns directories for callers to ignore", () => {
    const entry = directoryEntry("src");
    const entriesByPath = new Map([[entry.path, entry]]);

    expect(resolveTaskExecutionFileTreeSelectionEntry("src", entriesByPath)).toBe(entry);
  });
});
