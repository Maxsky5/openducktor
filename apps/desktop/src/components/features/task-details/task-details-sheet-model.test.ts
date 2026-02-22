import { describe, expect, mock, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import {
  runTaskWorkflowAction,
  shouldLoadDocumentSection,
  toSubtasks,
  toTaskLabels,
} from "./task-details-sheet-model";

const makeTask = (id: string, overrides: Partial<TaskCard> = {}): TaskCard => ({
  id,
  title: id,
  description: "",
  acceptanceCriteria: "",
  notes: "",
  status: "open",
  priority: 2,
  issueType: "task",
  labels: [],
  aiReviewEnabled: false,
  availableActions: [],
  parentId: undefined,
  subtaskIds: [],
  assignee: undefined,
  updatedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  documentSummary: {
    spec: { has: false, updatedAt: undefined },
    plan: { has: false, updatedAt: undefined },
    qaReport: { has: false, updatedAt: undefined },
  },
  ...overrides,
});

describe("task-details-sheet-model", () => {
  test("filters phase labels from display labels", () => {
    expect(toTaskLabels(["phase:open", "backend", "phase:ready_for_dev"])).toEqual(["backend"]);
  });

  test("derives subtasks only for existing ids", () => {
    const subtask = makeTask("T-2");
    const parent = makeTask("T-1", { subtaskIds: ["T-2", "T-999"] });
    const byId = new Map<string, TaskCard>([[subtask.id, subtask]]);

    expect(toSubtasks(parent, byId)).toEqual([subtask]);
    expect(toSubtasks(null, byId)).toEqual([]);
  });

  test("routes workflow actions to matching callbacks", () => {
    const onPlan = mock(() => {});
    const onBuild = mock(() => {});
    const onDelegate = mock(() => {});
    const onDefer = mock(() => {});
    const onResumeDeferred = mock(() => {});
    const onHumanApprove = mock(() => {});
    const onHumanRequestChanges = mock(() => {});

    runTaskWorkflowAction("set_spec", "T-1", {
      onPlan,
      onBuild,
      onDelegate,
      onDefer,
      onResumeDeferred,
      onHumanApprove,
      onHumanRequestChanges,
    });
    runTaskWorkflowAction("open_builder", "T-1", {
      onPlan,
      onBuild,
      onDelegate,
      onDefer,
      onResumeDeferred,
      onHumanApprove,
      onHumanRequestChanges,
    });

    expect(onPlan).toHaveBeenCalledWith("T-1", "set_spec");
    expect(onBuild).toHaveBeenCalledWith("T-1");

    runTaskWorkflowAction("set_plan", null, {
      onPlan,
      onBuild,
      onDelegate,
      onDefer,
      onResumeDeferred,
      onHumanApprove,
      onHumanRequestChanges,
    });
    expect(onPlan).toHaveBeenCalledTimes(1);
  });

  test("loads document sections only when summary reports content", () => {
    expect(shouldLoadDocumentSection(true)).toBe(true);
    expect(shouldLoadDocumentSection(false)).toBe(false);
    expect(shouldLoadDocumentSection(undefined)).toBe(false);
  });
});
