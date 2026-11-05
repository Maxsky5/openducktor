import { createTaskCardFixture } from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import {
  CLOSE_TASK_ACTION,
  RESET_TASK_ACTION,
} from "@openducktor/frontend-core/tasks/workflow/core-task-actions";
import { describe, expect, test } from "bun:test";
import { CircleCheckBig, RotateCcw } from "lucide-react";
import {
  coreTaskActionIcon,
  coreTaskActionMenuItem,
  coreTaskActionPrimaryVariant,
  taskMenuActionVariant,
  taskPrimaryActionVariant,
} from "./task-action-ui";

describe("task action controls", () => {
  test("keeps request changes as a non-destructive workflow action", () => {
    expect(taskPrimaryActionVariant("build_start", createTaskCardFixture())).toBe("default");
    expect(taskPrimaryActionVariant("human_request_changes", createTaskCardFixture())).toBe(
      "outline",
    );
    expect(taskPrimaryActionVariant("reset_implementation", createTaskCardFixture())).toBe(
      "destructive",
    );
    expect(taskMenuActionVariant("human_request_changes", createTaskCardFixture())).toBe("ghost");
  });

  test("paints the core Close Task as a warning and the core Reset Task as destructive", () => {
    expect(coreTaskActionPrimaryVariant(CLOSE_TASK_ACTION)).toBe("warning");
    expect(coreTaskActionPrimaryVariant(RESET_TASK_ACTION)).toBe("destructive");
    expect(coreTaskActionMenuItem(CLOSE_TASK_ACTION, () => {}).variant).toBe("warningGhost");
    expect(coreTaskActionMenuItem(RESET_TASK_ACTION, () => {}).variant).toBe("destructiveGhost");
    expect(coreTaskActionIcon(CLOSE_TASK_ACTION).type).toBe(CircleCheckBig);
    expect(coreTaskActionIcon(RESET_TASK_ACTION).type).toBe(RotateCcw);
  });
});
