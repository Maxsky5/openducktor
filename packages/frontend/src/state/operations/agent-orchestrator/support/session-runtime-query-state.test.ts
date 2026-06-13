import { describe, expect, test } from "bun:test";
import { resolveSessionRuntimeQueryState } from "./session-runtime-query-state";

describe("resolveSessionRuntimeQueryState", () => {
  test("returns no query state when there is no active session", () => {
    expect(resolveSessionRuntimeQueryState(null)).toEqual({
      runtimeQueryInput: null,
      runtimeQueryError: null,
    });
  });

  test("builds query input from active session runtime context", () => {
    expect(
      resolveSessionRuntimeQueryState({
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
      resolveSessionRuntimeQueryState({
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
