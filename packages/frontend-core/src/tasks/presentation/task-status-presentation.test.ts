import { SPEC_PLAN_BUILD_BOARD } from "@openducktor/workflows";
import { describe, expect, test } from "bun:test";
import { statusLabel, statusTone } from "./task-status-presentation";

describe("task status presentation", () => {
  test("gives each status the label that both clients show", () => {
    expect(SPEC_PLAN_BUILD_BOARD.states.map(statusLabel)).toEqual([
      "Backlog",
      "Spec ready",
      "Ready for dev",
      "In progress",
      "Blocked needs input",
      "AI review",
      "Human review",
      "Done",
    ]);
  });

  test("gives each status one tone, with separate tones for the two review statuses", () => {
    expect(SPEC_PLAN_BUILD_BOARD.states.map((state) => statusTone(state))).toEqual([
      "neutral",
      "pending",
      "info",
      "warning",
      "destructive",
      "review",
      "approval",
      "success",
    ]);
  });
});
