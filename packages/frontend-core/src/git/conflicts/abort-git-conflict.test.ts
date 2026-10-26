import { describe, expect, test } from "bun:test";
import type { GitConflict } from "../contracts";
import { abortGitConflict, isAbortableGitConflict } from "./abort-git-conflict";

const conflict = (overrides: Partial<GitConflict> = {}): GitConflict => ({
  operation: "rebase",
  currentBranch: "feature",
  targetBranch: "origin/main",
  conflictedFiles: ["src/a.ts"],
  output: "CONFLICT (content): Merge conflict in src/a.ts",
  workingDir: "/repo/wt",
  ...overrides,
});

describe("isAbortableGitConflict", () => {
  test("needs the operation and the directory of the conflict", () => {
    expect(isAbortableGitConflict(conflict())).toBe(true);
    expect(isAbortableGitConflict(conflict({ operation: null }))).toBe(false);
    expect(isAbortableGitConflict(conflict({ workingDir: null }))).toBe(false);
    expect(isAbortableGitConflict(conflict({ workingDir: "" }))).toBe(false);
  });
});

describe("abortGitConflict", () => {
  test("aborts the operation in the conflict directory", async () => {
    const calls: unknown[][] = [];
    const target = conflict({ operation: "direct_merge_squash" });
    if (!isAbortableGitConflict(target)) throw new Error("The fixture must be abortable.");

    const result = await abortGitConflict(
      {
        gitAbortConflict: async (...args) => {
          calls.push(args);
          return { output: "" };
        },
      },
      "/repo",
      target,
    );

    expect(calls).toEqual([["/repo", "direct_merge_squash", "/repo/wt"]]);
    expect(result).toEqual({ kind: "aborted", title: "Merge aborted" });
  });

  test("returns the host failure with the failure title of the operation", async () => {
    const failure = new Error("Not a rebase.");
    const target = conflict();
    if (!isAbortableGitConflict(target)) throw new Error("The fixture must be abortable.");

    const result = await abortGitConflict(
      {
        gitAbortConflict: async () => {
          throw failure;
        },
      },
      "/repo",
      target,
    );

    expect(result).toEqual({ kind: "failed", title: "Failed to abort rebase", error: failure });
  });
});
