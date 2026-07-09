import { describe, expect, test } from "bun:test";
import {
  createDisabledUpdateState,
  createUpdateError,
  markAvailable,
  markDisabledManualCheck,
  markDownloaded,
  markDownloadedInstallError,
  markDownloading,
  markDownloadProgress,
  markUpdateError,
  markUpToDate,
  updateErrorCodeForOperation,
} from "./app-update-state-machine";

describe("app update state machine", () => {
  test("marks disabled manual checks without changing the disabled reason", () => {
    const disabled = createDisabledUpdateState({
      code: "missing_update_config",
      currentVersion: "0.4.2",
      reason: "No update feed.",
    });

    expect(markDisabledManualCheck(disabled, "menu", "2026-07-08T22:00:00.000Z")).toEqual({
      status: "disabled",
      currentVersion: "0.4.2",
      disabledCode: "missing_update_config",
      disabledReason: "No update feed.",
      checkInitiator: "menu",
      checkedAt: "2026-07-08T22:00:00.000Z",
    });
  });

  test("preserves manual-check context across check results and downloads", () => {
    const checking = {
      status: "checking" as const,
      currentVersion: "0.4.2",
      checkInitiator: "settings" as const,
    };
    const available = markAvailable({
      availableVersion: "0.4.3",
      checkedAt: "2026-07-08T22:00:00.000Z",
      currentVersion: "0.4.2",
      previousState: checking,
    });
    const downloading = markDownloading({
      availableVersion: available.availableVersion,
      currentVersion: "0.4.2",
      previousState: available,
    });

    expect(available).toMatchObject({
      status: "available",
      checkInitiator: "settings",
      checkedAt: "2026-07-08T22:00:00.000Z",
    });
    expect(downloading).toMatchObject({
      status: "downloading",
      availableVersion: "0.4.3",
      progressPercent: 0,
      checkInitiator: "settings",
      checkedAt: "2026-07-08T22:00:00.000Z",
    });
  });

  test("clamps download progress and marks downloaded progress complete", () => {
    const downloading = {
      status: "downloading" as const,
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      progressPercent: 24,
      checkInitiator: "settings" as const,
      checkedAt: "2026-07-08T22:00:00.000Z",
    };

    expect(
      markDownloadProgress({
        currentVersion: "0.4.2",
        percent: 140,
        previousState: downloading,
      }),
    ).toMatchObject({
      status: "downloading",
      progressPercent: 100,
      availableVersion: "0.4.3",
      checkInitiator: "settings",
    });
    expect(
      markDownloaded({
        availableVersion: "0.4.3",
        currentVersion: "0.4.2",
        previousState: downloading,
      }),
    ).toMatchObject({
      status: "downloaded",
      progressPercent: 100,
      availableVersion: "0.4.3",
      checkInitiator: "settings",
    });
  });

  test("builds actionable errors with stable operation codes", () => {
    const cause = new TypeError("network failed");
    const error = createUpdateError({
      cause,
      code: "check_failed",
      message: cause.message,
      operation: "check",
    });

    expect(error).toEqual({
      code: "check_failed",
      message: "network failed",
      operation: "check",
      causeName: "TypeError",
    });
    expect(updateErrorCodeForOperation("check")).toBe("check_failed");
    expect(updateErrorCodeForOperation("download")).toBe("download_failed");
    expect(updateErrorCodeForOperation("install")).toBe("install_failed");
  });

  test("omits cause name when an error cause is not available", () => {
    expect(
      createUpdateError({
        cause: "network failed",
        code: "check_failed",
        message: "network failed",
        operation: "check",
      }),
    ).toEqual({
      code: "check_failed",
      message: "network failed",
      operation: "check",
    });
  });

  test("keeps downloaded updates retryable when install fails", () => {
    const downloaded = {
      status: "downloaded" as const,
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      progressPercent: 100,
    };

    expect(
      markDownloadedInstallError({
        cause: new Error("shutdown failed"),
        message: "shutdown failed",
        previousState: downloaded,
      }),
    ).toMatchObject({
      status: "downloaded",
      availableVersion: "0.4.3",
      error: {
        code: "install_failed",
        message: "shutdown failed",
        operation: "install",
        causeName: "Error",
      },
    });
  });

  test("marks up-to-date and error states with previous check context", () => {
    const checking = {
      status: "checking" as const,
      currentVersion: "0.4.2",
      checkInitiator: "menu" as const,
    };

    expect(
      markUpToDate({
        checkedAt: "2026-07-08T22:00:00.000Z",
        currentVersion: "0.4.2",
        previousState: checking,
      }),
    ).toMatchObject({
      status: "upToDate",
      checkInitiator: "menu",
      checkedAt: "2026-07-08T22:00:00.000Z",
    });
    expect(
      markUpdateError({
        checkedAt: "2026-07-08T22:00:00.000Z",
        code: "updater_unavailable",
        currentVersion: "0.4.2",
        message: "No updater result.",
        operation: "check",
        previousState: checking,
      }),
    ).toMatchObject({
      status: "error",
      checkInitiator: "menu",
      checkedAt: "2026-07-08T22:00:00.000Z",
      error: {
        code: "updater_unavailable",
        message: "No updater result.",
        operation: "check",
      },
    });
  });
});
