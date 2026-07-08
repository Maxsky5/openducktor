import { describe, expect, test } from "bun:test";
import {
  appUpdateCommandResultSchema,
  appUpdateStateChangedEventSchema,
  appUpdateStateSchema,
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

  test("parses state change events", () => {
    expect(
      appUpdateStateChangedEventSchema.parse({
        type: "state_changed",
        state: {
          status: "downloading",
          currentVersion: "0.4.2",
          availableVersion: "0.4.3",
          progressPercent: 45,
        },
      }),
    ).toEqual({
      type: "state_changed",
      state: {
        status: "downloading",
        currentVersion: "0.4.2",
        availableVersion: "0.4.3",
        progressPercent: 45,
      },
    });
  });
});
