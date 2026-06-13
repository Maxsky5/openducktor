import { describe, expect, test } from "bun:test";
import { resolveRuntimeWorkingDirectoryRefState } from "./session-runtime-ref";

describe("resolveRuntimeWorkingDirectoryRefState", () => {
  test("returns no ref state when there is no active session", () => {
    expect(resolveRuntimeWorkingDirectoryRefState({ repoPath: "/repo", session: null })).toEqual({
      runtimeRef: null,
      runtimeRefError: null,
    });
  });

  test("builds the runtime working-directory ref from active session runtime context", () => {
    expect(
      resolveRuntimeWorkingDirectoryRefState({
        repoPath: " /repo ",
        session: {
          runtimeKind: "codex",
          workingDirectory: " /repo/worktree ",
        },
      }),
    ).toEqual({
      runtimeRef: {
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
      },
      runtimeRefError: null,
    });
  });

  test("fails active session runtime context when the working directory is missing", () => {
    expect(
      resolveRuntimeWorkingDirectoryRefState({
        repoPath: "/repo",
        session: {
          runtimeKind: "codex",
          workingDirectory: "   ",
        },
      }),
    ).toEqual({
      runtimeRef: null,
      runtimeRefError: "Active session runtime context is missing working directory.",
    });
  });
});
