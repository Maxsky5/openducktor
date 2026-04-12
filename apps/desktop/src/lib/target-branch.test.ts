import { describe, expect, test } from "bun:test";
import {
  canonicalTargetBranch,
  checkoutTargetBranch,
  DEFAULT_TARGET_BRANCH,
  effectiveTaskTargetBranch,
  INVALID_TASK_TARGET_BRANCH_LABEL,
  normalizeTargetBranch,
  resolveTaskTargetBranchState,
  targetBranchFromSelection,
  targetBranchRemote,
  targetBranchSelectionValue,
  taskTargetBranchValidationError,
  UPSTREAM_TARGET_BRANCH,
} from "./target-branch";

describe("target-branch helpers", () => {
  test("keeps structured refs normalized", () => {
    expect(normalizeTargetBranch({ remote: " upstream ", branch: " release " })).toEqual({
      remote: "upstream",
      branch: "release",
    });
    expect(normalizeTargetBranch({ remote: "origin", branch: "origin/main" })).toEqual({
      remote: "origin",
      branch: "main",
    });
    expect(normalizeTargetBranch({ branch: "refs/remotes/upstream/release" })).toEqual({
      remote: "upstream",
      branch: "release",
    });
    expect(normalizeTargetBranch({ branch: "refs/heads/release/2026.03" })).toEqual({
      branch: "release/2026.03",
    });
    expect(normalizeTargetBranch({ remote: "origin", branch: "" })).toEqual(DEFAULT_TARGET_BRANCH);
  });

  test("derives canonical, checkout, and remote values", () => {
    const target = { remote: "upstream", branch: "release" };
    expect(canonicalTargetBranch(target)).toBe("upstream/release");
    expect(checkoutTargetBranch(target)).toBe("release");
    expect(targetBranchRemote(target)).toBe("upstream");
    expect(canonicalTargetBranch({ branch: UPSTREAM_TARGET_BRANCH })).toBe(UPSTREAM_TARGET_BRANCH);
    expect(targetBranchRemote({ branch: UPSTREAM_TARGET_BRANCH })).toBeNull();
  });

  test("formats branch selector values for local and remote branches", () => {
    expect(targetBranchSelectionValue({ remote: "origin", branch: "main" })).toBe(
      "refs/remotes/origin/main",
    );
    expect(targetBranchSelectionValue({ branch: "release/2026.04" })).toBe(
      "refs/heads/release/2026.04",
    );
  });

  test("parses explicit branch selector values without guessing remotes", () => {
    expect(targetBranchFromSelection("refs/remotes/upstream/release")).toEqual({
      remote: "upstream",
      branch: "release",
    });
    expect(targetBranchFromSelection("refs/heads/release/2026.03")).toEqual({
      branch: "release/2026.03",
    });
    expect(targetBranchFromSelection(UPSTREAM_TARGET_BRANCH)).toEqual({
      branch: UPSTREAM_TARGET_BRANCH,
    });
  });

  test("prefers persisted task target branches before repo defaults", () => {
    expect(
      effectiveTaskTargetBranch(
        { remote: "upstream", branch: "release" },
        { remote: "origin", branch: "main" },
      ),
    ).toEqual({ remote: "upstream", branch: "release" });
    expect(effectiveTaskTargetBranch(undefined, { remote: "origin", branch: "main" })).toEqual({
      remote: "origin",
      branch: "main",
    });
  });

  test("normalizes task target branch validation errors", () => {
    expect(taskTargetBranchValidationError(undefined)).toBeNull();
    expect(taskTargetBranchValidationError("   ")).toBeNull();
    expect(taskTargetBranchValidationError(" invalid branch ")).toBe("invalid branch");
  });

  test("resolves task target branch view state from effective branch and validation error", () => {
    expect(
      resolveTaskTargetBranchState({
        taskTargetBranch: { remote: "upstream", branch: "release" },
        taskTargetBranchError: null,
        defaultTargetBranch: { remote: "origin", branch: "main" },
      }),
    ).toEqual({
      effectiveTargetBranch: { remote: "upstream", branch: "release" },
      validationError: null,
      displayTargetBranch: "upstream/release",
      selectionValue: "refs/remotes/upstream/release",
    });

    expect(
      resolveTaskTargetBranchState({
        taskTargetBranch: { remote: "upstream", branch: "release" },
        taskTargetBranchError: " malformed metadata ",
        defaultTargetBranch: { remote: "origin", branch: "main" },
      }),
    ).toEqual({
      effectiveTargetBranch: { remote: "upstream", branch: "release" },
      validationError: "malformed metadata",
      displayTargetBranch: INVALID_TASK_TARGET_BRANCH_LABEL,
      selectionValue: "refs/remotes/upstream/release",
    });
  });
});
