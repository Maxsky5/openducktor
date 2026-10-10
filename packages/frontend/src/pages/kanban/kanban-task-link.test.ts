import { describe, expect, test } from "bun:test";
import { buildKanbanTaskHref, parseTaskDetailsConfirm } from "./kanban-task-link";

describe("kanban task link", () => {
  test("opens the task details and an optional confirmation", () => {
    expect(buildKanbanTaskHref("odt-1")).toBe("/kanban?task=odt-1");
    expect(buildKanbanTaskHref("odt 1", "delete")).toBe("/kanban?task=odt+1&taskConfirm=delete");
  });

  test("accepts only the known confirmations", () => {
    expect(parseTaskDetailsConfirm("reset_task")).toBe("reset_task");
    expect(parseTaskDetailsConfirm("delete")).toBe("delete");
    expect(parseTaskDetailsConfirm("close_task")).toBeNull();
    expect(parseTaskDetailsConfirm(null)).toBeNull();
  });
});
