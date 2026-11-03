import { describe, expect, test } from "bun:test";
import { mapToKanbanColumns } from "./kanban-board";

import { createTaskCardFixture as makeTask } from "../test-support/task-card-fixture";
import { BUILTIN_BOARD } from "./builtin/task-workflow";

describe("mapToKanbanColumns", () => {
  test("maps persisted statuses to board columns", () => {
    const tasks = [
      makeTask({ id: "1", title: "A", status: "spec_ready" }),
      makeTask({ id: "2", title: "B", status: "blocked" }),
      makeTask({ id: "3", title: "C", status: "closed" }),
    ];

    const columns = mapToKanbanColumns(tasks, BUILTIN_BOARD);
    expect(columns.find((entry) => entry.id === "spec_ready")?.tasks).toHaveLength(1);
    expect(columns.find((entry) => entry.id === "blocked")?.tasks).toHaveLength(1);
    expect(columns.find((entry) => entry.id === "closed")?.tasks).toHaveLength(1);
  });

  test("keeps canonical column order and maps review states", () => {
    const tasks = [
      makeTask({ id: "a", title: "AI", status: "ai_review" }),
      makeTask({ id: "h", title: "Human", status: "human_review" }),
    ];

    const columns = mapToKanbanColumns(tasks, BUILTIN_BOARD);
    expect(columns.map((column) => column.id)).toEqual([
      "open",
      "spec_ready",
      "ready_for_dev",
      "in_progress",
      "blocked",
      "ai_review",
      "human_review",
      "closed",
    ]);
    expect(columns.find((column) => column.id === "ai_review")?.tasks).toHaveLength(1);
    expect(columns.find((column) => column.id === "human_review")?.tasks).toHaveLength(1);
  });
});
