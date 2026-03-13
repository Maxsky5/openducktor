import { describe, expect, test } from "bun:test";
import {
  canonicalTargetBranch,
  checkoutTargetBranch,
  DEFAULT_TARGET_BRANCH,
  normalizeTargetBranch,
  targetBranchFromSelection,
  targetBranchRemote,
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
});
