import { describe, expect, test } from "bun:test";
import { emptyDiffCopy } from "./empty-diff-copy";

const copy = (overrides: Partial<Parameters<typeof emptyDiffCopy>[0]> = {}) =>
  emptyDiffCopy({
    targetBranch: "origin/main",
    isLoading: false,
    contextMode: "worktree",
    diffScope: "uncommitted",
    upstreamStatus: "tracking",
    ...overrides,
  });

describe("emptyDiffCopy", () => {
  test("names the comparison target of Branch changes", () => {
    expect(copy({ diffScope: "target" }).title).toBe("No changes against origin/main");
    expect(copy({ diffScope: "target", isLoading: true }).title).toBe(
      "Checking changes against origin/main...",
    );
  });

  test("names local changes of a worktree and of the repository root", () => {
    expect(copy()).toEqual({ title: "No changes detected", description: null });
    expect(copy({ isLoading: true }).title).toBe("Scanning for changes...");
    expect(copy({ contextMode: "repository" }).title).toBe("No repository changes detected");
  });

  test("tells the repository root to push a branch without an upstream", () => {
    const target = { contextMode: "repository", diffScope: "target", targetBranch: "" } as const;
    expect(copy({ ...target, isLoading: true }).title).toBe("Checking branch changes...");
    expect(copy({ ...target, upstreamStatus: "untracked" })).toEqual({
      title: "No upstream branch yet",
      description: "Push the branch first to create its upstream.",
    });
    expect(copy(target)).toEqual({ title: "No branch changes detected", description: null });
  });
});
