import { describe, expect, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import {
  DEFERRED_BY_USER_REASON,
  requireActiveRepo,
  toNormalizedTitle,
  toUpdateSuccessDescription,
  toVisibleTasks,
  WORKSPACE_REQUIRED_ERROR,
} from "./task-operations-model";

const makeTask = (id: string, status: TaskCard["status"]): TaskCard => ({
  id,
  title: id,
  description: "",
  acceptanceCriteria: "",
  notes: "",
  status,
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  subtaskIds: [],
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false },
  },
  updatedAt: "2026-02-22T08:00:00.000Z",
  createdAt: "2026-02-22T08:00:00.000Z",
});

describe("task-operations-model", () => {
  test("returns active repo or throws when missing", () => {
    expect(requireActiveRepo("/repo")).toBe("/repo");
    expect(() => requireActiveRepo(null)).toThrow(WORKSPACE_REQUIRED_ERROR);
  });

  test("filters deferred tasks from visible list", () => {
    expect(
      toVisibleTasks([makeTask("A", "open"), makeTask("B", "deferred")]).map((task) => task.id),
    ).toEqual(["A"]);
  });

  test("normalizes titles and update descriptions", () => {
    expect(toNormalizedTitle("  Task title  ")).toBe("Task title");
    expect(toUpdateSuccessDescription("T-1", { title: "  New title  " })).toBe("New title");
    expect(toUpdateSuccessDescription("T-1", { title: "   " })).toBe("T-1");
  });

  test("keeps stable mutation constants", () => {
    expect(DEFERRED_BY_USER_REASON).toBe("Deferred by user");
  });
});
