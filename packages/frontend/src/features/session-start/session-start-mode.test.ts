import { describe, expect, test } from "bun:test";
import { resolveLaunchStartMode } from "./session-start-mode";

describe("resolveLaunchStartMode", () => {
  test("keeps the default fresh mode when it does not require an existing session", () => {
    expect(
      resolveLaunchStartMode({
        launchActionId: "build_implementation_start",
        existingSessionOptions: [],
      }),
    ).toBe("fresh");
  });

  test("prefers reuse when reusable sessions exist", () => {
    expect(
      resolveLaunchStartMode({
        launchActionId: "build_after_human_request_changes",
        existingSessionOptions: [
          {
            value: "session-1",
            label: "Builder #1",
            description: "Existing builder session",
          },
        ],
      }),
    ).toBe("reuse");
  });

  test("falls back to the first allowed non-reuse mode when no reusable sessions exist", () => {
    expect(
      resolveLaunchStartMode({
        launchActionId: "build_implementation_start",
        existingSessionOptions: [],
      }),
    ).toBe("fresh");
  });

  test("keeps reuse as the default when the launch action allows reuse and fork", () => {
    expect(
      resolveLaunchStartMode({
        launchActionId: "build_pull_request_generation",
        existingSessionOptions: [],
      }),
    ).toBe("reuse");
  });
});
