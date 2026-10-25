import { describe, expect, test } from "bun:test";
import { getPriorityLabel, ISSUE_TYPE_LABELS, toPriorityLevel } from "./kanban-task-badge-model";

describe("task badge labels", () => {
  test("names each issue type", () => {
    expect(ISSUE_TYPE_LABELS).toEqual({
      bug: "Bug",
      feature: "Feature",
      task: "Task",
    });
  });

  test("shows an out-of-range priority as the nearest level and an invalid one as P4", () => {
    expect([-1, 0, 1, 2, 3, 4, 9].map(toPriorityLevel)).toEqual([0, 0, 1, 2, 3, 4, 4]);
    expect(toPriorityLevel(Number.NaN)).toBe(4);
    expect(toPriorityLevel(2.5)).toBe(4);
    expect(getPriorityLabel(0)).toEqual({ label: "P0", hint: "Critical" });
    expect(getPriorityLabel(4)).toEqual({ label: "P4", hint: "Very low" });
  });
});
