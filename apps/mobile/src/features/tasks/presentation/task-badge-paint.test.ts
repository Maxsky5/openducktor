import { describe, expect, test } from "bun:test";
import {
  issueTypePaint,
  priorityPaint,
  pullRequestPaint,
  sourceIssueLabel,
} from "./task-badge-paint";

describe("task badge paint", () => {
  test("uses the desktop colors and icons for the issue types", () => {
    expect(issueTypePaint("feature")).toEqual({ label: "Feature", tone: "info", icon: "sparkles" });
    expect(issueTypePaint("bug")).toEqual({ label: "Bug", tone: "destructive", icon: "bug" });
    expect(issueTypePaint("task").tone).toBe("neutral");
  });

  test("colors the priorities from rose to neutral and keeps out-of-range values readable", () => {
    expect(
      [0, 1, 2, 3, 4].map((priority) => [
        priorityPaint(priority).label,
        priorityPaint(priority).tone,
      ]),
    ).toEqual([
      ["P0", "destructive"],
      ["P1", "cancelled"],
      ["P2", "warning"],
      ["P3", "info"],
      ["P4", "neutral"],
    ]);
    expect(priorityPaint(9)).toEqual({ label: "P4", hint: "Very low", tone: "neutral" });
  });

  test("colors a pull request by its state", () => {
    expect(pullRequestPaint({ number: 42, state: "merged" })).toEqual({
      label: "PR #42",
      stateLabel: "Merged",
      tone: "pending",
      icon: "git-merge",
    });
    expect(pullRequestPaint({ number: 7, state: "closed_unmerged" }).tone).toBe("destructive");
  });

  test("names the provider of a source issue", () => {
    expect(sourceIssueLabel({ providerId: "github", number: "12" })).toBe("GitHub #12");
    expect(sourceIssueLabel({ providerId: "azure-devops", number: "3" })).toBe("Azure DevOps #3");
  });
});
