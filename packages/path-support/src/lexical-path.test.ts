import { describe, expect, test } from "bun:test";
import {
  basenameForPath,
  isAbsolutePath,
  normalizePathForComparison,
  normalizePathSeparators,
  pathStartsWith,
  resolveAgainstWorkingDirectory,
  toDisplayRelativePath,
  toProjectRelativePath,
  trimTrailingPathSeparators,
} from "./lexical-path";

describe("lexical path helpers", () => {
  test.each([
    ["/repo/worktree", "/repo/worktree"],
    ["/repo/worktree/", "/repo/worktree"],
    ["/repo//worktree///task", "/repo/worktree/task"],
    ["repo/worktree/task", "repo/worktree/task"],
    ["repo/worktree/", "repo/worktree"],
    ["repo\\worktree\\task", "repo/worktree/task"],
    ["\\repo\\worktree\\task", "/repo/worktree/task"],
    [" \\repo\\worktree\\task ", "/repo/worktree/task"],
    ["C:\\Repo\\Worktree\\Task", "c:/repo/worktree/task"],
    ["c:/Repo//Worktree/../Task", "c:/repo/task"],
    ["C:\\repo\\..\\task", "c:/task"],
    ["C:\\..\\task", "c:/task"],
    ["C:\\subdir\\..\\..\\task", "c:/task"],
    ["C:relative\\Repo", "C:relative/Repo"],
    ["\\\\server\\share\\repo\\task", "/server/share/repo/task"],
    ["\\\\server/share\\repo", "/server/share/repo"],
    ["//server/share/./repo", "/server/share/repo"],
    ["//server\\share\\repo", "/server/share/repo"],
    ["/repo\\.\\worktree\\task", "/repo/worktree/task"],
    ["/repo/./worktree/./task", "/repo/worktree/task"],
    ["/repo/worktree/../task", "/repo/task"],
    ["/repo/..", "/"],
    ["repo/..", ""],
    ["a/b/..", "a"],
    ["repo/worktree/../task", "repo/task"],
    ["../repo/task", "repo/task"],
    ["../../a", "a"],
    ["../..", ""],
    ["/../repo/task", "/repo/task"],
    [" /repo/worktree/../task/ ", "/repo/task"],
    [" ./repo/./task// ", "repo/task"],
    ["", ""],
    ["   ", ""],
    ["/", "/"],
    [".", ""],
    ["..", ""],
  ])("normalizes %p to %p for comparison", (input, expected) => {
    expect(normalizePathForComparison(input)).toBe(expected);
  });

  test("normalizes separators and trims trailing separators without collapsing roots", () => {
    expect(normalizePathSeparators("src\\components\\App.tsx")).toBe("src/components/App.tsx");
    expect(trimTrailingPathSeparators("/repo/worktree///")).toBe("/repo/worktree");
    expect(trimTrailingPathSeparators("/")).toBe("/");
    expect(trimTrailingPathSeparators("C:\\")).toBe("C:\\");
    expect(trimTrailingPathSeparators("\\")).toBe("\\");
  });

  test("detects absolute paths across POSIX and Windows drive spellings", () => {
    expect(isAbsolutePath("/repo/worktree")).toBe(true);
    expect(isAbsolutePath("C:\\repo\\worktree")).toBe(true);
    expect(isAbsolutePath("C:/repo/worktree")).toBe(true);
    expect(isAbsolutePath("C:relative\\repo")).toBe(false);
    expect(isAbsolutePath("repo/worktree")).toBe(false);
  });

  test("reads basenames after separator and trailing slash normalization", () => {
    expect(basenameForPath("src\\components\\")).toBe("components");
    expect(basenameForPath("/repo/worktree/src/main.ts")).toBe("main.ts");
    expect(basenameForPath("/")).toBe("");
  });

  test("checks path containment using comparison semantics", () => {
    expect(pathStartsWith("/repo/worktree/src", "/repo/worktree")).toBe(true);
    expect(pathStartsWith("/repo/worktree", "/repo/worktree")).toBe(true);
    expect(pathStartsWith("/repo/worktree-other", "/repo/worktree")).toBe(false);
    expect(pathStartsWith("C:\\Repo\\Worktree\\src", "c:/repo/worktree")).toBe(true);
  });

  test("converts absolute paths under a working directory to project-relative paths", () => {
    expect(toProjectRelativePath("/repo/worktree/src/main.ts", "/repo/worktree")).toBe(
      "src/main.ts",
    );
    expect(toProjectRelativePath("/repo/worktree/src/components/", "/repo/worktree")).toBe(
      "src/components",
    );
    expect(toProjectRelativePath("src/main.ts", "/repo/worktree")).toBe("src/main.ts");
    expect(toProjectRelativePath("/other/src/main.ts", "/repo/worktree")).toBe(
      "/other/src/main.ts",
    );
    expect(toProjectRelativePath("C:\\Repo\\Worktree\\src\\main.ts", "c:/repo/worktree")).toBe(
      "src/main.ts",
    );
  });

  test("resolves relative paths against a working directory", () => {
    expect(resolveAgainstWorkingDirectory("/repo/worktree", "src/main.ts")).toBe(
      "/repo/worktree/src/main.ts",
    );
    expect(resolveAgainstWorkingDirectory("/repo/worktree/", "./src/main.ts")).toBe(
      "/repo/worktree/src/main.ts",
    );
    expect(resolveAgainstWorkingDirectory("/repo/worktree", "/tmp/file.txt")).toBe("/tmp/file.txt");
  });

  test("relativizes display paths while preserving unrelated display strings", () => {
    expect(toDisplayRelativePath("/repo/worktree/src/main.ts", "/repo/worktree")).toBe(
      "src/main.ts",
    );
    expect(toDisplayRelativePath("/repo/worktree", "/repo/worktree")).toBe(".");
    expect(toDisplayRelativePath("/other/src/main.ts", "/repo/worktree")).toBe(
      "/other/src/main.ts",
    );
    expect(toDisplayRelativePath("C:\\other\\main.ts", "C:\\repo\\worktree")).toBe(
      "C:\\other\\main.ts",
    );
    expect(toDisplayRelativePath("src/main.ts", "/repo/worktree")).toBe("src/main.ts");
    expect(toDisplayRelativePath("/repo/worktree/src/main.ts", null)).toBe(
      "/repo/worktree/src/main.ts",
    );
  });
});
