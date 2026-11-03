import { createTaskCardFixture } from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import { describe, expect, test } from "bun:test";
import {
  taskActionIsDestructive,
  taskActionTone,
  taskSessionStatusLabel,
} from "./task-action-presentation";

describe("taskActionTone", () => {
  test("keeps request changes as a non-destructive workflow action", () => {
    expect(taskActionTone("build_start", createTaskCardFixture())).toBe("prominent");
    expect(taskActionTone("qa_start", createTaskCardFixture())).toBe("prominent");
    expect(taskActionTone("human_approve", createTaskCardFixture())).toBe("prominent");
    expect(taskActionTone("human_request_changes", createTaskCardFixture())).toBe("neutral");
    expect(taskActionTone("reset_implementation", createTaskCardFixture())).toBe("destructive");
    expect(taskActionTone("reset_task", createTaskCardFixture())).toBe("destructive");
    expect(taskActionTone("close_task", createTaskCardFixture())).toBe("warning");

    expect(taskActionIsDestructive("human_request_changes", createTaskCardFixture())).toBe(false);
    expect(taskActionIsDestructive("reset_implementation", createTaskCardFixture())).toBe(true);
    expect(taskActionIsDestructive("reset_task", createTaskCardFixture())).toBe(true);
    expect(taskActionIsDestructive("close_task", createTaskCardFixture())).toBe(false);
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
