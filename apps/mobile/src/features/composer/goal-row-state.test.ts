import { describe, expect, mock, test } from "bun:test";
import { goalActionsOpen, pressGoalAction } from "./goal-row-state";

describe("goal row actions", () => {
  test("open only while the command gate is open and no action runs", () => {
    expect(goalActionsOpen({ pendingAction: null }, true)).toBe(true);
    expect(goalActionsOpen({ pendingAction: null }, false)).toBe(false);
    expect(goalActionsOpen({ pendingAction: "pause" }, true)).toBe(false);
  });

  test("send nothing on a press while the gate is closed or an action runs", () => {
    const onAction = mock((_action: string) => {});
    pressGoalAction({ pendingAction: null, onAction }, false, "clear");
    pressGoalAction({ pendingAction: "pause", onAction }, true, "clear");
    expect(onAction).not.toHaveBeenCalled();

    pressGoalAction({ pendingAction: null, onAction }, true, "clear");
    expect(onAction.mock.calls).toEqual([["clear"]]);
  });
});
