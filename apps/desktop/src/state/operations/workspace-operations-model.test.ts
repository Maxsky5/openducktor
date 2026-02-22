import { describe, expect, test } from "bun:test";
import type { GitCurrentBranch } from "@openducktor/contracts";
import {
  BRANCH_SYNC_INTERVAL_MS,
  hasBranchIdentityChanged,
  normalizeRepoPath,
  shouldProbeExternalBranchChange,
  shouldSkipBranchSwitch,
} from "./workspace-operations-model";

const branch = (name: string | undefined, detached = false): GitCurrentBranch => ({
  name,
  detached,
});

describe("workspace-operations-model", () => {
  test("normalizes repo path", () => {
    expect(normalizeRepoPath("  /repo/path  ")).toBe("/repo/path");
  });

  test("checks probe preconditions", () => {
    expect(
      shouldProbeExternalBranchChange({
        activeRepo: "/repo",
        isSwitchingWorkspace: false,
        isSwitchingBranch: false,
        isLoadingBranches: false,
        isSyncInFlight: false,
      }),
    ).toBe(true);

    expect(
      shouldProbeExternalBranchChange({
        activeRepo: "/repo",
        isSwitchingWorkspace: true,
        isSwitchingBranch: false,
        isLoadingBranches: false,
        isSyncInFlight: false,
      }),
    ).toBe(false);
  });

  test("detects branch identity changes", () => {
    expect(hasBranchIdentityChanged(branch("main", false), "main", false)).toBe(false);
    expect(hasBranchIdentityChanged(branch("feature", false), "main", false)).toBe(true);
    expect(hasBranchIdentityChanged(branch(undefined, true), null, false)).toBe(true);
  });

  test("skips no-op branch switch when already attached", () => {
    expect(shouldSkipBranchSwitch(branch("main", false), "main")).toBe(true);
    expect(shouldSkipBranchSwitch(branch("main", true), "main")).toBe(false);
  });

  test("keeps polling interval contract", () => {
    expect(BRANCH_SYNC_INTERVAL_MS).toBe(30000);
  });
});
