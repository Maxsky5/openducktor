import { describe, expect, test } from "bun:test";
import { requireRepoRuntimeRef, requireSessionWorkingDirectory } from "./runtime-connections";

describe("runtime-connections", () => {
  test("requireRepoRuntimeRef trims and validates logical runtime identity", () => {
    expect(
      requireRepoRuntimeRef(
        {
          repoPath: " /repo ",
          runtimeKind: "opencode",
        },
        "list models",
      ),
    ).toEqual({
      repoPath: "/repo",
      runtimeKind: "opencode",
    });
  });

  test("requireRepoRuntimeRef rejects missing repo path", () => {
    expect(() =>
      requireRepoRuntimeRef({ repoPath: " ", runtimeKind: "opencode" }, "list models"),
    ).toThrow("Repository path is required to list models.");
  });

  test("requireSessionWorkingDirectory trims and validates the session cwd", () => {
    expect(requireSessionWorkingDirectory(" /repo/worktree ", "load history")).toBe(
      "/repo/worktree",
    );
  });

  test("requireSessionWorkingDirectory rejects missing session cwd", () => {
    expect(() => requireSessionWorkingDirectory(" ", "load history")).toThrow(
      "Session workingDirectory is required to load history.",
    );
  });
});
