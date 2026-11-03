import { BUILTIN_BOARD } from "@openducktor/workflows";
import { describe, expect, test } from "bun:test";
import { laneTheme, statusBadgeClassName } from "./task-status-presentation";
import { statusLabel } from "@openducktor/frontend-core/tasks/presentation/task-status-presentation";

describe("task-status-presentation", () => {
  test("keeps badge and lane families aligned for workflow statuses", () => {
    expect(statusLabel(BUILTIN_BOARD.states.find(({ id }) => id === "spec_ready")!)).toBe(
      "Spec ready",
    );
    expect(
      statusBadgeClassName(BUILTIN_BOARD.states.find(({ id }) => id === "spec_ready")!),
    ).toContain("pending");
    expect(
      laneTheme(BUILTIN_BOARD.states.find(({ id }) => id === "spec_ready")!.tone).headerAccentClass,
    ).toContain("violet");

    expect(statusLabel(BUILTIN_BOARD.states.find(({ id }) => id === "ready_for_dev")!)).toBe(
      "Ready for dev",
    );
    expect(
      statusBadgeClassName(BUILTIN_BOARD.states.find(({ id }) => id === "ready_for_dev")!),
    ).toContain("info");
    expect(
      laneTheme(BUILTIN_BOARD.states.find(({ id }) => id === "ready_for_dev")!.tone)
        .headerAccentClass,
    ).toContain("sky");

    expect(statusLabel(BUILTIN_BOARD.states.find(({ id }) => id === "ai_review")!)).toBe(
      "AI review",
    );
    expect(
      statusBadgeClassName(BUILTIN_BOARD.states.find(({ id }) => id === "ai_review")!),
    ).toContain("indigo");
    expect(
      laneTheme(BUILTIN_BOARD.states.find(({ id }) => id === "ai_review")!.tone).headerAccentClass,
    ).toContain("indigo");

    expect(statusLabel(BUILTIN_BOARD.states.find(({ id }) => id === "human_review")!)).toBe(
      "Human review",
    );
    expect(
      statusBadgeClassName(BUILTIN_BOARD.states.find(({ id }) => id === "human_review")!),
    ).toContain("cyan");
    expect(
      laneTheme(BUILTIN_BOARD.states.find(({ id }) => id === "human_review")!.tone)
        .headerAccentClass,
    ).toContain("cyan");
  });
});
