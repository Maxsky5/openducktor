import { describe, expect, test } from "bun:test";
import {
  appUpdateCheckInputSchema,
  appUpdateCommandResultSchema,
  appUpdateErrorSchema,
  appUpdateStateSchema,
  canDownloadAppUpdate,
  canInstallAppUpdate,
} from "./app-update-schemas";

describe("app update schemas", () => {
  test("parses an available update state", () => {
    expect(
      appUpdateStateSchema.parse({
        status: "available",
        currentVersion: "0.4.2",
        availableVersion: "0.4.3",
        checkInitiator: "background",
        checkedAt: "2026-07-08T22:00:00.000Z",
      }),
    ).toEqual({
      status: "available",
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      checkInitiator: "background",
      checkedAt: "2026-07-08T22:00:00.000Z",
    });
  });

  test("rejects unknown statuses", () => {
    expect(() =>
      appUpdateStateSchema.parse({
        status: "not-available",
        currentVersion: "0.4.2",
      }),
    ).toThrow();
  });

  test("rejects status payloads with impossible fields", () => {
    expect(() =>
      appUpdateStateSchema.parse({
        status: "available",
        currentVersion: "0.4.2",
        checkedAt: "2026-07-08T22:00:00.000Z",
      }),
    ).toThrow();

    expect(() =>
      appUpdateStateSchema.parse({
        status: "idle",
        currentVersion: "0.4.2",
        availableVersion: "0.4.3",
      }),
    ).toThrow();
  });

  test("parses incompatible app signature errors", () => {
    expect(
      appUpdateErrorSchema.parse({
        code: "incompatible_app_signature",
        message: "Install the signed release manually.",
        operation: "install",
      }),
    ).toEqual({
      code: "incompatible_app_signature",
      message: "Install the signed release manually.",
      operation: "install",
    });
  });

  test("parses browser runner update policy", () => {
    expect(
      appUpdateStateSchema.parse({
        status: "disabled",
        currentVersion: "0.4.2",
        disabledCode: "unsupported_web_runner",
        disabledReason: "The browser runner does not install updates in OpenDucktor.",
      }),
    ).toEqual({
      status: "disabled",
      currentVersion: "0.4.2",
      disabledCode: "unsupported_web_runner",
      disabledReason: "The browser runner does not install updates in OpenDucktor.",
    });
  });

  test("keeps update command eligibility in the shared contract", () => {
    expect(
      canDownloadAppUpdate({
        status: "error",
        currentVersion: "0.4.2",
        availableVersion: "0.4.3",
        checkedAt: "2026-07-08T22:00:00.000Z",
        error: {
          code: "updater_unavailable",
          message: "No updater result.",
          operation: "check",
        },
      }),
    ).toBe(true);
    expect(canDownloadAppUpdate({ status: "idle", currentVersion: "0.4.2" })).toBe(false);
    expect(
      canInstallAppUpdate({
        status: "downloaded",
        currentVersion: "0.4.2",
        availableVersion: "0.4.3",
        progressPercent: 100,
      }),
    ).toBe(true);
  });

  test("distinguishes installable, requested, retryable, and terminal downloaded updates", () => {
    const downloadedState = {
      status: "downloaded",
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      progressPercent: 100,
    } as const;

    expect(canInstallAppUpdate(appUpdateStateSchema.parse(downloadedState))).toBe(true);
    expect(
      canInstallAppUpdate(
        appUpdateStateSchema.parse({
          ...downloadedState,
          installRequested: true,
        }),
      ),
    ).toBe(false);
    expect(
      canInstallAppUpdate(
        appUpdateStateSchema.parse({
          ...downloadedState,
          error: {
            code: "install_failed",
            message: "handoff failed",
            operation: "install",
          },
        }),
      ),
    ).toBe(true);
    expect(
      canInstallAppUpdate(
        appUpdateStateSchema.parse({
          ...downloadedState,
          installRetryDisabled: true,
          error: {
            code: "install_failed",
            message: "quit and reopen before trying again",
            operation: "install",
          },
        }),
      ),
    ).toBe(false);
  });

  test("parses accepted and rejected command results", () => {
    const state = {
      status: "disabled",
      currentVersion: "0.4.2",
      disabledCode: "not_packaged",
      disabledReason: "Updates are available only in packaged desktop builds.",
    };

    expect(appUpdateCommandResultSchema.parse({ accepted: true, state })).toEqual({
      accepted: true,
      state,
    });
    expect(
      appUpdateCommandResultSchema.parse({
        accepted: false,
        rejection: {
          code: "not_packaged",
          message: "Updates are available only in packaged desktop builds.",
          operation: "check",
        },
        state,
      }),
    ).toEqual({
      accepted: false,
      rejection: {
        code: "not_packaged",
        message: "Updates are available only in packaged desktop builds.",
        operation: "check",
      },
      state,
    });
  });

  test("parses manual update check input and rejects background IPC checks", () => {
    expect(appUpdateCheckInputSchema.parse({ initiator: "settings" })).toEqual({
      initiator: "settings",
    });
    expect(appUpdateCheckInputSchema.parse({ initiator: "menu" })).toEqual({
      initiator: "menu",
    });
    expect(() => appUpdateCheckInputSchema.parse({ initiator: "background" })).toThrow();
  });

  test("parses update errors and rejects empty messages", () => {
    expect(
      appUpdateErrorSchema.parse({
        code: "check_failed",
        message: "Network failed",
        operation: "check",
        causeName: "Error",
        details: { release: "v0.4.3" },
      }),
    ).toEqual({
      code: "check_failed",
      message: "Network failed",
      operation: "check",
      causeName: "Error",
      details: { release: "v0.4.3" },
    });
    expect(() =>
      appUpdateErrorSchema.parse({
        code: "check_failed",
        message: "",
        operation: "check",
      }),
    ).toThrow();
  });
});
