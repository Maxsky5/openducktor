import { describe, expect, test } from "bun:test";
import type { GitBranch } from "@openducktor/contracts";
import {
  changeWorktreeMode,
  existingBranchError,
  existingBranchUnavailableReason,
  localWorktreeBranches,
  newWorktreeBranchState,
  selectExistingBranch,
  WORKTREE_NAME_RULE,
  worktreeDirectoryName,
  worktreeNameError,
} from "./workspace-session-worktree-rules";

const branch = (overrides: Partial<GitBranch> & Pick<GitBranch, "name">): GitBranch => ({
  isCurrent: false,
  isRemote: false,
  ...overrides,
});

describe("worktree rules", () => {
  test("keeps the worktree name when the mode changes", () => {
    const fromName = { mode: "from_name" as const, name: "feature", branchName: "custom" };
    expect(changeWorktreeMode(fromName, "from_branch")).toEqual({
      mode: "from_branch",
      name: "feature",
      branchName: "",
    });
    expect(changeWorktreeMode(changeWorktreeMode(fromName, "from_branch"), "from_name")).toEqual({
      mode: "from_name",
      name: "feature",
      branchName: null,
    });
  });

  test("turns spaces and slashes into hyphens and rejects unsafe names", () => {
    expect(worktreeDirectoryName("my feature/one")).toBe("my-feature-one");
    expect(worktreeDirectoryName("-bad")).toBeNull();
    expect(worktreeNameError("", null)).toBeNull();
    expect(worktreeNameError("-bad", null)).toBe(WORKTREE_NAME_RULE);
    expect(worktreeNameError("good", { field: "worktree.name", message: "Name is taken." })).toBe(
      "Name is taken.",
    );
  });

  test("offers only local branches and explains a branch that another worktree uses", () => {
    const branches = [
      branch({ name: "main" }),
      branch({ name: "origin/main", isRemote: true }),
      branch({ name: "busy", worktreePath: "/repo/.worktrees/busy" }),
    ];
    const local = localWorktreeBranches(branches);
    expect(local.map((entry) => entry.name)).toEqual(["main", "busy"]);
    expect(local.map(existingBranchUnavailableReason)).toEqual([
      null,
      "Already checked out at /repo/.worktrees/busy",
    ]);
    const selected = selectExistingBranch(
      changeWorktreeMode({ mode: "from_name", name: "", branchName: null }, "from_branch"),
      "busy",
    );
    expect(existingBranchError(selected, local, null)).toBe(
      "This branch is already checked out at /repo/.worktrees/busy. Choose another branch or use Current checkout.",
    );
    expect(existingBranchError(selectExistingBranch(selected, "main"), local, null)).toBeNull();
  });

  test("names the worktree after a chosen branch only when it has no name yet", () => {
    const empty = { mode: "from_branch" as const, name: "", branchName: "" };
    expect(selectExistingBranch(empty, "feature/login-flow").name).toBe("feature-login-flow");
    expect(selectExistingBranch({ ...empty, name: "kept" }, "feature/x").name).toBe("kept");
  });

  test("derives the new branch from the repository prefix and checks a typed branch", () => {
    const value = { mode: "from_name" as const, name: "login flow", branchName: null };
    expect(newWorktreeBranchState(value, "odt")).toEqual({
      branchError: false,
      defaultBranch: "odt/login-flow",
    });
    expect(newWorktreeBranchState(value, undefined).defaultBranch).toBe("");
    expect(newWorktreeBranchState({ ...value, branchName: "bad..name" }, "odt").branchError).toBe(
      true,
    );
  });
});
