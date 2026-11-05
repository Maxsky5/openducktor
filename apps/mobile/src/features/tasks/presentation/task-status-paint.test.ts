import { SPEC_PLAN_BUILD_BOARD } from "@openducktor/workflows";
import { describe, expect, test } from "bun:test";
import { taskStatusLabel, taskStatusTone } from "./task-status-paint";

describe("task status paint", () => {
  test("uses the review and approval tones for the review columns", () => {
    expect(taskStatusTone(SPEC_PLAN_BUILD_BOARD.states.find(({ id }) => id === "ai_review")!)).toBe(
      "review",
    );
    expect(
      taskStatusTone(SPEC_PLAN_BUILD_BOARD.states.find(({ id }) => id === "human_review")!),
    ).toBe("approval");
  });

  test("uses semantic tones and the desktop labels for the other statuses", () => {
    expect(taskStatusTone(SPEC_PLAN_BUILD_BOARD.states.find(({ id }) => id === "blocked")!)).toBe(
      "destructive",
    );
    expect(
      taskStatusLabel(SPEC_PLAN_BUILD_BOARD.states.find(({ id }) => id === "human_review")!),
    ).toBe("Human review");
  });
});
