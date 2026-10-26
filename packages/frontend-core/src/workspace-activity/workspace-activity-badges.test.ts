import { describe, expect, test } from "bun:test";
import { workspaceActivityBadges } from "./workspace-activity-badges";

describe("workspaceActivityBadges", () => {
  test("shows nothing before live status answers", () => {
    expect(workspaceActivityBadges({ kind: "unknown" })).toEqual([]);
  });

  test("orders input required, error, then active", () => {
    expect(
      workspaceActivityBadges({
        kind: "ready",
        statusUnavailableReason: null,
        inputRequired: true,
        error: true,
        active: true,
      }),
    ).toEqual([
      { key: "inputRequired", label: "Sessions waiting for input" },
      { key: "error", label: "Sessions failed" },
      { key: "active", label: "Sessions running" },
    ]);
    expect(
      workspaceActivityBadges({
        kind: "ready",
        statusUnavailableReason: null,
        inputRequired: false,
        error: false,
        active: false,
      }),
    ).toEqual([]);
  });

  test("names the reason when the status of a ready workspace is unavailable", () => {
    expect(
      workspaceActivityBadges({
        kind: "ready",
        statusUnavailableReason: "Runtime not ready.",
        inputRequired: false,
        error: false,
        active: true,
      }),
    ).toEqual([
      { key: "active", label: "Sessions running" },
      { key: "unavailable", label: "Session activity unavailable: Runtime not ready." },
    ]);
  });

  test("names the reason when live status is unavailable", () => {
    expect(workspaceActivityBadges({ kind: "unavailable", reason: "Stream closed." })).toEqual([
      { key: "unavailable", label: "Session activity unavailable: Stream closed." },
    ]);
  });
});
