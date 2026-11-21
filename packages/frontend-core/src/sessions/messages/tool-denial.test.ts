import { describe, expect, test } from "bun:test";
import { readToolDenialPresentation } from "./tool-denial";

describe("readToolDenialPresentation", () => {
  test("shows the source label and the reason of the policy", () => {
    expect(
      readToolDenialPresentation({ source: "auto_mode", reason: "  Pushes to main.  " }),
    ).toEqual({ label: "Blocked by auto mode", reason: "Pushes to main.", risk: null });
  });

  test("shows the category of a Claude classifier reason without its brackets", () => {
    expect(
      readToolDenialPresentation({ source: "auto_mode", reason: "[Undermining Oversight]" }).reason,
    ).toBe("Undermining Oversight");
    expect(readToolDenialPresentation({ source: "auto_mode", reason: "[a] and [b]" }).reason).toBe(
      "[a] and [b]",
    );
  });

  test("shows the risk level of an auto-review denial with its tone", () => {
    const risk = (riskLevel: "low" | "medium" | "high" | "critical") =>
      readToolDenialPresentation({ source: "auto_review", reason: "Risky.", riskLevel }).risk;
    expect(risk("low")).toEqual({ label: "Low risk", tone: "neutral" });
    expect(risk("medium")).toEqual({ label: "Medium risk", tone: "warning" });
    expect(risk("high")).toEqual({ label: "High risk", tone: "danger" });
    expect(risk("critical")).toEqual({ label: "Critical risk", tone: "danger" });
  });

  test("says why an auto-review row has no reason", () => {
    expect(readToolDenialPresentation({ source: "auto_review" }).reason).toBe(
      "Auto-review gave no reason.",
    );
    expect(readToolDenialPresentation({ source: "auto_review_timeout" })).toEqual({
      label: "Auto-review timed out",
      reason: "The review timed out.",
      risk: null,
    });
  });

  test("shows no reason text for other sources without a reason", () => {
    expect(readToolDenialPresentation({ source: "read_only_role" })).toEqual({
      label: "Blocked by read-only role",
      reason: null,
      risk: null,
    });
  });
});
