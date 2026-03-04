import { describe, expect, test } from "bun:test";
import type { GitCurrentBranch } from "@openducktor/contracts";
import {
  BRANCH_PROBE_ERROR_TOAST_THROTTLE_MS,
  BRANCH_SYNC_INTERVAL_MS,
  branchProbeErrorSignature,
  classifyBranchProbeError,
  hasBranchIdentityChanged,
  normalizeRepoPath,
  shouldProbeExternalBranchChange,
  shouldReportBranchProbeError,
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

  test("classifies branch probe errors with typed code and stage", () => {
    const authorization = classifyBranchProbeError(
      new Error("Permission denied for workspace repository"),
      "current_branch_probe",
    );
    expect(authorization.code).toBe("authorization_failed");
    expect(authorization.stage).toBe("current_branch_probe");

    const gitFailure = classifyBranchProbeError("git rev-parse failed", "branch_refresh");
    expect(gitFailure.code).toBe("git_command_failed");
    expect(gitFailure.stage).toBe("branch_refresh");

    const runtimeUnavailable = classifyBranchProbeError(
      new Error("Tauri runtime not available. Run inside the desktop shell."),
      "current_branch_probe",
    );
    expect(runtimeUnavailable.code).toBe("runtime_unavailable");
  });

  test("reports probe failures when signature changes or throttle interval elapses", () => {
    const signature = branchProbeErrorSignature(
      classifyBranchProbeError(new Error("git fetch failed"), "current_branch_probe"),
    );

    expect(
      shouldReportBranchProbeError({
        nowMs: 1000,
        throttleMs: BRANCH_PROBE_ERROR_TOAST_THROTTLE_MS,
        errorSignature: signature,
        lastReportedAtMs: null,
        lastReportedSignature: null,
      }),
    ).toBe(true);

    expect(
      shouldReportBranchProbeError({
        nowMs: 5000,
        throttleMs: BRANCH_PROBE_ERROR_TOAST_THROTTLE_MS,
        errorSignature: signature,
        lastReportedAtMs: 1000,
        lastReportedSignature: signature,
      }),
    ).toBe(false);

    expect(
      shouldReportBranchProbeError({
        nowMs: 7000,
        throttleMs: BRANCH_PROBE_ERROR_TOAST_THROTTLE_MS,
        errorSignature: `${signature}:next`,
        lastReportedAtMs: 1000,
        lastReportedSignature: signature,
      }),
    ).toBe(true);
  });
});
