import { describe, expect, test } from "bun:test";
import { workspaceActivityBadges } from "./workspace-rail-activity-badges";

describe("workspaceActivityBadges", () => {
  test("shows no badge while the activity is unknown", () => {
    expect(workspaceActivityBadges({ kind: "unknown" })).toEqual([]);
  });

  test("shows no badge when no session state applies", () => {
    expect(
      workspaceActivityBadges({
        kind: "ready",
        inputRequired: false,
        error: false,
        active: false,
      }),
    ).toEqual([]);
  });

  test("orders input required, then error, then active", () => {
    expect(
      workspaceActivityBadges({ kind: "ready", inputRequired: true, error: true, active: true }),
    ).toEqual([
      { key: "inputRequired", label: "Sessions waiting for input" },
      { key: "error", label: "Sessions failed" },
      { key: "active", label: "Sessions running" },
    ]);
  });

  test("shows only the error badge with the reported reason when activity is unavailable", () => {
    expect(workspaceActivityBadges({ kind: "unavailable", reason: "stream closed" })).toEqual([
      { key: "error", label: "Session activity unavailable: stream closed" },
    ]);
  });
});
