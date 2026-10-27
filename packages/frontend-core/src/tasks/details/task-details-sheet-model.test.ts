import { describe, expect, test } from "bun:test";
import { collectSingleTaskCleanupImpactTaskIds } from "./task-details-sheet-model";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

const makeTask = (id: string, overrides: Partial<TaskCard> = {}): TaskCard => ({
  id,
  title: id,
  description: "",
  status: "open",
  priority: 2,
  issueType: "task",
  labels: [],
  removeWorktreeOnClose: null,
  availableActions: [],
  updatedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  artifactSummary: {
    spec: { present: false, updatedAt: undefined },
    plan: { present: false, updatedAt: undefined },
    qaReport: { present: false, updatedAt: undefined },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    build: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  ...overrides,
});
describe("task-details-sheet-model", () => {
  test("collects single-task cleanup impact ids only for the selected task", () => {
    expect(collectSingleTaskCleanupImpactTaskIds(makeTask("T-1"))).toEqual(["T-1"]);
    expect(collectSingleTaskCleanupImpactTaskIds(null)).toEqual([]);
  });
});
