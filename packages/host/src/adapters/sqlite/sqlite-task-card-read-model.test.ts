import { describe, expect, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { finalizeTaskCards } from "./sqlite-task-card-read-model";

const taskCard = ({ id, parentId }: { id: string; parentId?: string | undefined }): TaskCard => ({
  agentSessions: [],
  agentWorkflows: {
    builder: { available: false, canSkip: false, completed: false, required: true },
    planner: { available: false, canSkip: true, completed: false, required: false },
    qa: { available: false, canSkip: true, completed: false, required: false },
    spec: { available: false, canSkip: true, completed: false, required: false },
  },
  aiReviewEnabled: true,
  availableActions: [],
  createdAt: "2026-06-10T10:00:00.000Z",
  description: "",
  documentSummary: {
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
    spec: { has: false },
  },
  id,
  issueType: "task",
  labels: [],
  parentId,
  priority: 2,
  status: "open",
  subtaskIds: [],
  title: "Task",
  updatedAt: "2026-06-10T10:00:00.000Z",
});

describe("SQLite task-card read model", () => {
  test("derives sorted direct subtask ids from parent references", () => {
    const cards = finalizeTaskCards([
      taskCard({ id: "parent" }),
      taskCard({ id: "child-b", parentId: "parent" }),
      taskCard({ id: "child-a", parentId: "parent" }),
      taskCard({ id: "grandchild", parentId: "child-a" }),
    ]);

    expect(cards).toEqual([
      expect.objectContaining({ id: "parent", subtaskIds: ["child-a", "child-b"] }),
      expect.objectContaining({ id: "child-b", subtaskIds: [] }),
      expect.objectContaining({ id: "child-a", subtaskIds: ["grandchild"] }),
      expect.objectContaining({ id: "grandchild", subtaskIds: [] }),
    ]);
  });
});
