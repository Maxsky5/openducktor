import { describe, expect, test } from "bun:test";
import { normalizeWorkingDirectory } from "./working-directory";

describe("normalizeWorkingDirectory", () => {
  test("preserves Windows drive roots", () => {
    expect(normalizeWorkingDirectory("C:\\")).toBe("C:\\");
    expect(normalizeWorkingDirectory("C:/")).toBe("C:/");
  });

  test("removes trailing separators from non-root paths", () => {
    expect(normalizeWorkingDirectory("/tmp/repo/worktree/")).toBe("/tmp/repo/worktree");
    expect(normalizeWorkingDirectory("C:\\repo\\worktree\\")).toBe("C:\\repo\\worktree");
  });
});
