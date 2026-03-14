import { describe, expect, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { mapToKanbanColumns } from "./kanban-mapper";

const makeTask = (partial: Partial<TaskCard> & Pick<TaskCard, "id" | "title">): TaskCard => ({
  id: partial.id,
  title: partial.title,
  description: partial.description ?? "",
  notes: partial.notes ?? "",
  status: partial.status ?? "open",
  priority: partial.priority ?? 2,
  issueType: partial.issueType ?? "task",
  aiReviewEnabled: partial.aiReviewEnabled ?? true,
  availableActions: partial.availableActions ?? [],
  labels: partial.labels ?? [],
  assignee: partial.assignee,
  parentId: partial.parentId,
  subtaskIds: partial.subtaskIds ?? [],
  documentSummary: partial.documentSummary ?? {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: partial.agentWorkflows ?? {
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    builder: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
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

  test("keeps canonical column order and maps review states", () => {
    const tasks = [
      makeTask({ id: "a", title: "AI", status: "ai_review" }),
      makeTask({ id: "h", title: "Human", status: "human_review" }),
    ];

    const columns = mapToKanbanColumns(tasks);
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
