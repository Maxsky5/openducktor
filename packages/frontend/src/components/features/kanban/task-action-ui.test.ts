import { describe, expect, test } from "bun:test";
import { CircleCheckBig } from "lucide-react";
import {
  TASK_ACTION_ICON,
  taskMenuActionVariant,
  taskPrimaryActionVariant,
} from "./task-action-ui";

describe("task action controls", () => {
  test("keeps request changes as a non-destructive workflow action", () => {
    expect(taskPrimaryActionVariant("build_start")).toBe("default");
    expect(taskPrimaryActionVariant("human_request_changes")).toBe("outline");
    expect(taskPrimaryActionVariant("reset_implementation")).toBe("destructive");
    expect(taskPrimaryActionVariant("reset_task")).toBe("destructive");
    expect(taskPrimaryActionVariant("close_task")).toBe("warning");
    expect(taskMenuActionVariant("close_task")).toBe("warningGhost");
    expect(taskMenuActionVariant("reset_task")).toBe("destructiveGhost");
    expect(taskMenuActionVariant("human_request_changes")).toBe("ghost");
  });

  test("uses the approval-style icon for manual close", () => {
    expect(TASK_ACTION_ICON.close_task.type).toBe(CircleCheckBig);
  });
});
