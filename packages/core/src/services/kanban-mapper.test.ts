import { describe, expect, test } from "bun:test";
import type { TaskCard } from "@openblueprint/contracts";
import { mapToKanbanColumns } from "./kanban-mapper";

const makeTask = (partial: Partial<TaskCard> & Pick<TaskCard, "id" | "title">): TaskCard => ({
  id: partial.id,
  title: partial.title,
  description: partial.description ?? "",
  design: partial.design ?? "",
  acceptanceCriteria: partial.acceptanceCriteria ?? "",
  status: partial.status ?? "open",
  phase: partial.phase,
  priority: partial.priority ?? 2,
  issueType: partial.issueType ?? "task",
  labels: partial.labels ?? [],
  assignee: partial.assignee,
  parentId: partial.parentId,
  subtaskIds: partial.subtaskIds ?? [],
  updatedAt: partial.updatedAt ?? new Date().toISOString(),
  createdAt: partial.createdAt ?? new Date().toISOString(),
});

describe("mapToKanbanColumns", () => {
  test("maps phase and fallback from status", () => {
    const tasks = [
      makeTask({ id: "1", title: "A", phase: "specifying" }),
      makeTask({ id: "2", title: "B", status: "blocked" }),
      makeTask({ id: "3", title: "C", status: "closed" }),
    ];

    const columns = mapToKanbanColumns(tasks);
    expect(columns.find((entry) => entry.id === "specifying")?.tasks).toHaveLength(1);
    expect(columns.find((entry) => entry.id === "blocked_needs_input")?.tasks).toHaveLength(1);
    expect(columns.find((entry) => entry.id === "done")?.tasks).toHaveLength(1);
  });
});
