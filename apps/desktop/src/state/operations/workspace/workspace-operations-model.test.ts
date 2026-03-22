import { describe, expect, test } from "bun:test";
import type { GitCurrentBranch } from "@openducktor/contracts";
import {
  BRANCH_PROBE_ERROR_TOAST_THROTTLE_MS,
  branchProbeErrorSignature,
  classifyBranchProbeError,
  hasBranchIdentityChanged,
  normalizeRepoPath,
  shouldProbeExternalBranchChange,
  shouldReportBranchProbeError,
  shouldResetBranchStateForRepoChange,
  shouldSkipBranchSwitch,
} from "./workspace-operations-model";

const branch = (
  name: string | undefined,
  detached = false,
  revision?: string,
): GitCurrentBranch => ({
  name,
  detached,
  revision,
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

  test("does not reset branch state for initial persisted repo hydration", () => {
    expect(shouldResetBranchStateForRepoChange(null, "/repo")).toBe(false);
    expect(shouldResetBranchStateForRepoChange(null, null)).toBe(false);
  });

  test("resets branch state for real repo transitions", () => {
    expect(shouldResetBranchStateForRepoChange("/repo-a", "/repo-b")).toBe(true);
    expect(shouldResetBranchStateForRepoChange("/repo-a", null)).toBe(true);
    expect(shouldResetBranchStateForRepoChange("/repo-a", "/repo-a")).toBe(false);
  });

  test("detects branch identity changes", () => {
    expect(hasBranchIdentityChanged(branch("main", false), "main", false, null)).toBe(false);
    expect(hasBranchIdentityChanged(branch("feature", false), "main", false, null)).toBe(true);
    expect(hasBranchIdentityChanged(branch(undefined, true), null, false, null)).toBe(true);
    expect(hasBranchIdentityChanged(branch(undefined, true, "abc123"), null, true, null)).toBe(
      true,
    );
  });

  test("skips no-op branch switch when already attached", () => {
    expect(shouldSkipBranchSwitch(branch("main", false), "main")).toBe(true);
    expect(shouldSkipBranchSwitch(branch("main", true), "main")).toBe(false);
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

    const structuredAuthorization = classifyBranchProbeError(
      {
        code: "GIT_COMMAND_UNAUTHORIZED",
        message: "Command failed",
      },
      "branch_refresh",
    );
    expect(structuredAuthorization.code).toBe("authorization_failed");
  });

  test("reports probe failures when stage/code signature changes or throttle interval elapses", () => {
    const initialError = classifyBranchProbeError(
      new Error("git fetch failed on origin/main"),
      "current_branch_probe",
    );
    const initialSignature = branchProbeErrorSignature(initialError);
    const sameClassDifferentMessageSignature = branchProbeErrorSignature(
      classifyBranchProbeError(
        new Error("git fetch failed on origin/develop"),
        "current_branch_probe",
      ),
    );
    const changedStageSignature = branchProbeErrorSignature(
      classifyBranchProbeError(new Error("git fetch failed"), "branch_refresh"),
    );

    expect(
      shouldReportBranchProbeError({
        nowMs: 1000,
        throttleMs: BRANCH_PROBE_ERROR_TOAST_THROTTLE_MS,
        errorSignature: initialSignature,
        lastReportedAtMs: null,
        lastReportedSignature: null,
      }),
    ).toBe(true);

    expect(
      shouldReportBranchProbeError({
        nowMs: 5000,
        throttleMs: BRANCH_PROBE_ERROR_TOAST_THROTTLE_MS,
        errorSignature: sameClassDifferentMessageSignature,
        lastReportedAtMs: 1000,
        lastReportedSignature: initialSignature,
      }),
    ).toBe(false);

    expect(
      shouldReportBranchProbeError({
        nowMs: 7000,
        throttleMs: BRANCH_PROBE_ERROR_TOAST_THROTTLE_MS,
        errorSignature: changedStageSignature,
        lastReportedAtMs: 1000,
        lastReportedSignature: initialSignature,
      }),
    ).toBe(true);
  });
});
