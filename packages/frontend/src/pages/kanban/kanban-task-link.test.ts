import { describe, expect, test } from "bun:test";
import { buildKanbanTaskHref } from "./kanban-task-link";

describe("kanban task link", () => {
  test("opens the task details", () => {
    expect(buildKanbanTaskHref("odt-1")).toBe("/kanban?task=odt-1");
    expect(buildKanbanTaskHref("odt 1")).toBe("/kanban?task=odt+1");
  });
});
