import { describe, expect, test } from "bun:test";
import { normalizePathForComparison } from "./path-comparison";

describe("normalizePathForComparison", () => {
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
    ["../../../a", "a"],
    ["../..", ""],
    ["/../repo/task", "/repo/task"],
    [" /repo/worktree/../task/ ", "/repo/task"],
    [" ./repo/./task// ", "repo/task"],
    ["", ""],
    ["   ", ""],
    ["/", "/"],
    [".", ""],
    ["..", ""],
  ])("normalizes %p to %p", (input, expected) => {
    expect(normalizePathForComparison(input)).toBe(expected);
  });
});
