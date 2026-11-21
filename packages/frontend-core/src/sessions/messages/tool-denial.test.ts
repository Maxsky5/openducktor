import { describe, expect, test } from "bun:test";
import { readToolDenialPresentation } from "./tool-denial";

describe("readToolDenialPresentation", () => {
  test("shows the source label and the reason of the policy", () => {
    expect(
      readToolDenialPresentation({ source: "auto_mode", reason: "  Pushes to main.  " }),
    ).toEqual({ label: "Blocked by auto mode", reason: "Pushes to main.", riskLabel: null });
  });

  test("shows the risk level of an auto-review denial", () => {
    expect(
      readToolDenialPresentation({ source: "auto_review", reason: "Risky.", riskLevel: "high" }),
    ).toEqual({ label: "Blocked by auto-review", reason: "Risky.", riskLabel: "Risk: High" });
  });

  test("says why an auto-review row has no reason", () => {
    expect(readToolDenialPresentation({ source: "auto_review" }).reason).toBe(
      "Auto-review gave no reason.",
    );
    expect(readToolDenialPresentation({ source: "auto_review_timeout" })).toEqual({
      label: "Auto-review timed out",
      reason: "The review timed out.",
      riskLabel: null,
    });
  });

  test("shows no reason text for other sources without a reason", () => {
    expect(readToolDenialPresentation({ source: "read_only_role" })).toEqual({
      label: "Blocked by read-only role",
      reason: null,
      riskLabel: null,
    });
  });
});
