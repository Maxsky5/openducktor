import { describe, expect, test } from "bun:test";
import { taskStatusLabel, taskStatusTone } from "./task-status-paint";

describe("task status paint", () => {
  test("uses the review and approval tones for the review columns", () => {
    expect(taskStatusTone("ai_review")).toBe("review");
    expect(taskStatusTone("human_review")).toBe("approval");
  });

  test("uses semantic tones and the desktop labels for the other statuses", () => {
    expect(taskStatusTone("blocked")).toBe("destructive");
    expect(taskStatusLabel("human_review")).toBe("Human review");
  });
});
