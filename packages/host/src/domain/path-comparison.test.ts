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
    ["/repo\\.\\worktree\\task", "/repo/worktree/task"],
    ["/repo/./worktree/./task", "/repo/worktree/task"],
    ["/repo/worktree/../task", "/repo/task"],
    ["repo/worktree/../task", "repo/task"],
    ["../repo/task", "repo/task"],
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
