import { describe, expect, test } from "bun:test";
import {
  taskActionIsDestructive,
  taskActionIsWarning,
  taskActionTone,
  taskSessionStatusLabel,
} from "./task-action-presentation";

describe("taskActionTone", () => {
  test("keeps request changes as a non-destructive workflow action", () => {
    expect(taskActionTone("build_start")).toBe("prominent");
    expect(taskActionTone("qa_start")).toBe("prominent");
    expect(taskActionTone("human_approve")).toBe("prominent");
    expect(taskActionTone("human_request_changes")).toBe("neutral");
    expect(taskActionTone("reset_implementation")).toBe("destructive");
    expect(taskActionTone("reset_task")).toBe("destructive");
    expect(taskActionTone("close_task")).toBe("warning");

    expect(taskActionIsDestructive("human_request_changes")).toBe(false);
    expect(taskActionIsDestructive("reset_implementation")).toBe(true);
    expect(taskActionIsDestructive("reset_task")).toBe(true);
    expect(taskActionIsDestructive("close_task")).toBe(false);
    expect(taskActionIsWarning("close_task")).toBe(true);
  });
});

describe("taskSessionStatusLabel", () => {
  test("names waiting input before the session state", () => {
    expect(
      taskSessionStatusLabel({ session: { activityState: "running" }, isWaitingInput: true }),
    ).toBe("Waiting input");
    expect(
      taskSessionStatusLabel({ session: { activityState: "starting" }, isWaitingInput: false }),
    ).toBe("Starting");
    expect(
      taskSessionStatusLabel({ session: { activityState: "running" }, isWaitingInput: false }),
    ).toBe("Running");
  });
});
