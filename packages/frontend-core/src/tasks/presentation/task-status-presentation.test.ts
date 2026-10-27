import { type BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import { describe, expect, test } from "bun:test";
import { statusLabel, statusTone } from "./task-status-presentation";

const STATUSES: TaskCard["status"][] = [
  "open",
  "spec_ready",
  "ready_for_dev",
  "in_progress",
  "blocked",
  "ai_review",
  "human_review",
  "closed",
];

describe("task status presentation", () => {
  test("gives each status the label that both clients show", () => {
    expect(STATUSES.map(statusLabel)).toEqual([
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
    expect(STATUSES.map(statusTone)).toEqual([
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
