import { describe, expect, test } from "bun:test";
import { workspaceBadgePresentations } from "./workspace-activity-badges";
import { workspaceTileFace } from "./workspace-tile-face";

describe("workspaceBadgePresentations", () => {
  test("maps every activity state to a labeled badge in the desktop order", () => {
    expect(
      workspaceBadgePresentations({
        kind: "ready",
        statusUnavailableReason: null,
        inputRequired: true,
        error: true,
        active: true,
      }),
    ).toEqual([
      {
        key: "inputRequired",
        label: "Input required",
        tone: "warning",
        accessibilityLabel: "Sessions waiting for input",
      },
      { key: "error", label: "Error", tone: "destructive", accessibilityLabel: "Sessions failed" },
      { key: "active", label: "Active", tone: "running", accessibilityLabel: "Sessions running" },
    ]);
  });

  test("shows the reason when activity is unavailable, and nothing while it is unknown", () => {
    expect(workspaceBadgePresentations({ kind: "unavailable", reason: "Stream closed." })).toEqual([
      {
        key: "unavailable",
        label: "Unavailable",
        tone: "cancelled",
        accessibilityLabel: "Session activity unavailable: Stream closed.",
      },
    ]);
    expect(workspaceBadgePresentations({ kind: "unknown" })).toEqual([]);
    expect(
      workspaceBadgePresentations({
        kind: "ready",
        statusUnavailableReason: null,
        inputRequired: false,
        error: false,
        active: false,
      }),
    ).toEqual([]);
  });
});

describe("workspaceTileFace", () => {
  test("uses the abbreviation and a readable label color on the picked color", () => {
    expect(
      workspaceTileFace({
        workspaceName: "OpenDucktor",
        abbreviation: "ODT",
        tileColor: "#3b82f6",
        iconDataUrl: null,
      }),
    ).toEqual({
      label: "ODT",
      colors: { background: "#3b82f6", foreground: "#000000" },
      iconDataUrl: null,
    });
  });

  test("derives initials and keeps theme colors when the workspace has no choice", () => {
    expect(
      workspaceTileFace({ workspaceName: "mobile app", abbreviation: null, tileColor: null }),
    ).toEqual({ label: "MA", colors: null, iconDataUrl: null });
  });
});
