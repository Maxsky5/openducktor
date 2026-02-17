import { describe, expect, test } from "bun:test";
import type { TaskCard } from "@openblueprint/contracts";
import { mapToKanbanColumns } from "./kanban-mapper";

const makeTask = (partial: Partial<TaskCard> & Pick<TaskCard, "id" | "title">): TaskCard => ({
  id: partial.id,
  title: partial.title,
  description: partial.description ?? "",
  design: partial.design ?? "",
  acceptanceCriteria: partial.acceptanceCriteria ?? "",
  notes: partial.notes ?? "",
  status: partial.status ?? "open",
  priority: partial.priority ?? 2,
  issueType: partial.issueType ?? "task",
  aiReviewEnabled: partial.aiReviewEnabled ?? true,
  labels: partial.labels ?? [],
  assignee: partial.assignee,
  parentId: partial.parentId,
  subtaskIds: partial.subtaskIds ?? [],
  updatedAt: partial.updatedAt ?? new Date().toISOString(),
  createdAt: partial.createdAt ?? new Date().toISOString(),
});

describe("mapToKanbanColumns", () => {
  test("maps persisted statuses to board columns", () => {
    const tasks = [
      makeTask({ id: "1", title: "A", status: "spec_ready" }),
      makeTask({ id: "2", title: "B", status: "blocked" }),
      makeTask({ id: "3", title: "C", status: "closed" }),
    ];

    const columns = mapToKanbanColumns(tasks);
    expect(columns.find((entry) => entry.id === "spec_ready")?.tasks).toHaveLength(1);
    expect(columns.find((entry) => entry.id === "blocked")?.tasks).toHaveLength(1);
    expect(columns.find((entry) => entry.id === "closed")?.tasks).toHaveLength(1);
  });

  test("does not render deferred tasks in board columns", () => {
    const tasks = [makeTask({ id: "defer-1", title: "Deferred", status: "deferred" })];

    const columns = mapToKanbanColumns(tasks);
    const totalRendered = columns.reduce((count, column) => count + column.tasks.length, 0);

    expect(totalRendered).toBe(0);
  });
});
