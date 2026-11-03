import { createTaskCardFixture } from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import { describe, expect, test } from "bun:test";
import { CircleCheckBig } from "lucide-react";
import { taskActionIcon, taskMenuActionVariant, taskPrimaryActionVariant } from "./task-action-ui";

describe("task action controls", () => {
  test("keeps request changes as a non-destructive workflow action", () => {
    expect(taskPrimaryActionVariant("build_start", createTaskCardFixture())).toBe("default");
    expect(taskPrimaryActionVariant("human_request_changes", createTaskCardFixture())).toBe(
      "outline",
    );
    expect(taskPrimaryActionVariant("reset_implementation", createTaskCardFixture())).toBe(
      "destructive",
    );
    expect(taskPrimaryActionVariant("reset_task", createTaskCardFixture())).toBe("destructive");
    expect(taskPrimaryActionVariant("close_task", createTaskCardFixture())).toBe("warning");
    expect(taskMenuActionVariant("close_task", createTaskCardFixture())).toBe("warningGhost");
    expect(taskMenuActionVariant("reset_task", createTaskCardFixture())).toBe("destructiveGhost");
    expect(taskMenuActionVariant("human_request_changes", createTaskCardFixture())).toBe("ghost");
  });

  test("uses the approval-style icon for manual close", () => {
    expect(taskActionIcon("close_task", createTaskCardFixture()).type).toBe(CircleCheckBig);
  });
});
