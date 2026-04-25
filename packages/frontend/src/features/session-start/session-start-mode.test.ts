import { describe, expect, test } from "bun:test";
import { resolveScenarioStartMode } from "./session-start-mode";

describe("resolveScenarioStartMode", () => {
  test("keeps the scenario default when it does not require an existing session", () => {
    expect(
      resolveScenarioStartMode({
        scenario: "build_implementation_start",
        existingSessionOptions: [],
      }),
    ).toBe("fresh");
  });

  test("keeps the scenario default when reusable sessions exist", () => {
    expect(
      resolveScenarioStartMode({
        scenario: "build_after_human_request_changes",
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
      resolveScenarioStartMode({
        scenario: "build_after_human_request_changes",
        existingSessionOptions: [],
      }),
    ).toBe("fresh");
  });

  test("keeps reuse as the default when the scenario allows reuse and fork", () => {
    expect(
      resolveScenarioStartMode({
        scenario: "build_pull_request_generation",
        existingSessionOptions: [],
      }),
    ).toBe("reuse");
  });
});
