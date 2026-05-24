import { describe, expect, test } from "bun:test";
import { resolveAttachedSessionRuntimeQueryState } from "./session-runtime-query-state";

describe("resolveAttachedSessionRuntimeQueryState", () => {
  test("returns no query state when there is no active session", () => {
    expect(resolveAttachedSessionRuntimeQueryState(null)).toEqual({
      runtimeQueryInput: null,
      runtimeQueryError: null,
    });
  });

  test("builds query input from active session runtime context", () => {
    expect(
      resolveAttachedSessionRuntimeQueryState({
        repoPath: " /repo ",
        runtimeKind: "codex",
        workingDirectory: " /repo/worktree ",
      }),
    ).toEqual({
      runtimeQueryInput: {
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
      },
      runtimeQueryError: null,
    });
  });

  test("fails active session runtime context when the working directory is missing", () => {
    expect(
      resolveAttachedSessionRuntimeQueryState({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "   ",
      }),
    ).toEqual({
      runtimeQueryInput: null,
      runtimeQueryError: "Active session runtime context is missing working directory.",
    });
  });
});
