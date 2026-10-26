import { describe, expect, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import {
  collectDeleteImpactTaskIds,
  collectSingleTaskCleanupImpactTaskIds,
  showsTaskSubtasks,
  toSubtasks,
} from "./task-details-sheet-model";

const makeTask = (id: string, overrides: Partial<TaskCard> = {}): TaskCard => ({
  id,
  title: id,
  description: "",
  status: "open",
  priority: 2,
  issueType: "task",
  labels: [],
  aiReviewEnabled: false,
  availableActions: [],
  parentId: undefined,
  subtaskIds: [],
  updatedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  artifactSummary: {
    spec: { has: false, updatedAt: undefined },
    plan: { has: false, updatedAt: undefined },
    qaReport: { has: false, updatedAt: undefined, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    builder: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  ...overrides,
});
describe("task-details-sheet-model", () => {
  test("derives subtasks only for existing ids", () => {
    const subtask = makeTask("T-2");
    const parent = makeTask("T-1", { subtaskIds: ["T-2", "T-999"] });
    const byId = new Map<string, TaskCard>([[subtask.id, subtask]]);

    expect(toSubtasks(parent, byId)).toEqual([subtask]);
    expect(toSubtasks(null, byId)).toEqual([]);
  });

  test("shows the Subtasks card only for an epic", () => {
    expect(showsTaskSubtasks(makeTask("EPIC-1", { issueType: "epic" }))).toBe(true);
    expect(showsTaskSubtasks(makeTask("T-1", { subtaskIds: ["T-2"] }))).toBe(false);
    expect(showsTaskSubtasks(null)).toBe(false);
  });

  test("collects delete impact ids across descendant subtasks", () => {
    const leaf = makeTask("T-3");
    const child = makeTask("T-2", { subtaskIds: ["T-3"] });
    const parent = makeTask("T-1", { subtaskIds: ["T-2", "T-999"] });
    const byId = new Map<string, TaskCard>([
      [parent.id, parent],
      [child.id, child],
      [leaf.id, leaf],
    ]);

    expect(collectDeleteImpactTaskIds(parent, byId)).toEqual(["T-1", "T-2", "T-999", "T-3"]);
    expect(collectDeleteImpactTaskIds(null, byId)).toEqual([]);
  });

  test("collects single-task cleanup impact ids only for the selected task", () => {
    expect(collectSingleTaskCleanupImpactTaskIds(makeTask("T-1", { subtaskIds: ["T-2"] }))).toEqual(
      ["T-1"],
    );
    expect(collectSingleTaskCleanupImpactTaskIds(null)).toEqual([]);
  });
});
