import { describe, expect, test } from "bun:test";
import { laneTheme, statusBadgeClassName, statusLabel } from "./task-status-presentation";

describe("task-status-presentation", () => {
  test("keeps badge and lane families aligned for workflow statuses", () => {
    expect(statusLabel("spec_ready")).toBe("Spec ready");
    expect(statusBadgeClassName("spec_ready")).toContain("pending");
    expect(laneTheme("spec_ready").headerAccentClass).toContain("violet");

    expect(statusLabel("ready_for_dev")).toBe("Ready for dev");
    expect(statusBadgeClassName("ready_for_dev")).toContain("info");
    expect(laneTheme("ready_for_dev").headerAccentClass).toContain("sky");

    expect(statusLabel("ai_review")).toBe("AI review");
    expect(statusBadgeClassName("ai_review")).toContain("indigo");
    expect(laneTheme("ai_review").headerAccentClass).toContain("indigo");

    expect(statusLabel("human_review")).toBe("Human review");
    expect(statusBadgeClassName("human_review")).toContain("cyan");
    expect(laneTheme("human_review").headerAccentClass).toContain("cyan");
  });
});
