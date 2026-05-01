import { describe, expect, mock, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import {
  collectDeleteImpactTaskIds,
  collectResetImpactTaskIds,
  runTaskWorkflowAction,
  shouldLoadDocumentSection,
  toSubtasks,
} from "./task-details-sheet-model";

const makeTask = (id: string, overrides: Partial<TaskCard> = {}): TaskCard => ({
  id,
  title: id,
  description: "",
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

  test("collects reset impact ids only for the selected task", () => {
    expect(collectResetImpactTaskIds(makeTask("T-1", { subtaskIds: ["T-2"] }))).toEqual(["T-1"]);
    expect(collectResetImpactTaskIds(null)).toEqual([]);
  });

  test("routes workflow actions to matching callbacks", () => {
    const onPlan = mock(() => {});
    const onQaStart = mock(() => {});
    const onQaOpen = mock(() => {});
    const onBuild = mock(() => {});
    const onOpenSession = mock(() => {});
    const onDelegate = mock(() => {});
    const onDefer = mock(() => {});
    const onResumeDeferred = mock(() => {});
    const onHumanApprove = mock(() => {});
    const onHumanRequestChanges = mock(() => {});
    const onResetImplementation = mock(() => {});

    runTaskWorkflowAction("set_spec", "T-1", {
      onPlan,
      onQaStart,
      onQaOpen,
      onBuild,
      onOpenSession,
      onDelegate,
      onDefer,
      onResumeDeferred,
      onHumanApprove,
      onHumanRequestChanges,
      onResetImplementation,
    });
    runTaskWorkflowAction("open_builder", "T-1", {
      onPlan,
      onQaStart,
      onQaOpen,
      onBuild,
      onOpenSession,
      onDelegate,
      onDefer,
      onResumeDeferred,
      onHumanApprove,
      onHumanRequestChanges,
      onResetImplementation,
    });

    expect(onPlan).toHaveBeenCalledWith("T-1", "set_spec");
    expect(onOpenSession).toHaveBeenCalledWith("T-1", "build", undefined);
    expect(onBuild).not.toHaveBeenCalled();

    runTaskWorkflowAction("open_spec", "T-1", {
      onPlan,
      onQaStart,
      onQaOpen,
      onBuild,
      onOpenSession,
      onDelegate,
      onDefer,
      onResumeDeferred,
      onHumanApprove,
      onHumanRequestChanges,
      onResetImplementation,
    });
    runTaskWorkflowAction("open_planner", "T-1", {
      onPlan,
      onQaStart,
      onQaOpen,
      onBuild,
      onOpenSession,
      onDelegate,
      onDefer,
      onResumeDeferred,
      onHumanApprove,
      onHumanRequestChanges,
      onResetImplementation,
    });
    expect(onOpenSession).toHaveBeenCalledWith("T-1", "spec", undefined);
    expect(onOpenSession).toHaveBeenCalledWith("T-1", "planner", undefined);

    runTaskWorkflowAction("set_plan", null, {
      onPlan,
      onQaStart,
      onQaOpen,
      onBuild,
      onOpenSession,
      onDelegate,
      onDefer,
      onResumeDeferred,
      onHumanApprove,
      onHumanRequestChanges,
      onResetImplementation,
    });
    expect(onPlan).toHaveBeenCalledTimes(1);

    runTaskWorkflowAction("qa_start", "T-1", {
      onPlan,
      onQaStart,
      onQaOpen,
      onBuild,
      onOpenSession,
      onDelegate,
      onDefer,
      onResumeDeferred,
      onHumanApprove,
      onHumanRequestChanges,
      onResetImplementation,
    });
    expect(onQaStart).toHaveBeenCalledWith("T-1");

    runTaskWorkflowAction("open_qa", "T-1", {
      onPlan,
      onQaStart,
      onQaOpen,
      onBuild,
      onOpenSession,
      onDelegate,
      onDefer,
      onResumeDeferred,
      onHumanApprove,
      onHumanRequestChanges,
      onResetImplementation,
    });
    expect(onOpenSession).toHaveBeenCalledWith("T-1", "qa", undefined);
    expect(onQaOpen).not.toHaveBeenCalled();

    runTaskWorkflowAction("reset_implementation", "T-1", {
      onPlan,
      onQaStart,
      onQaOpen,
      onBuild,
      onOpenSession,
      onDelegate,
      onDefer,
      onResumeDeferred,
      onHumanApprove,
      onHumanRequestChanges,
      onResetImplementation,
    });
    expect(onResetImplementation).toHaveBeenCalledWith("T-1", {
      closeDetailsAfterReset: true,
    });
  });

  test("loads document sections only when summary reports content", () => {
    expect(shouldLoadDocumentSection(true)).toBe(true);
    expect(shouldLoadDocumentSection(false)).toBe(false);
    expect(shouldLoadDocumentSection(undefined)).toBe(false);
  });

  test("forwards role-specific session options to onOpenSession", () => {
    const onOpenSession = mock(() => {});

    runTaskWorkflowAction(
      "open_builder",
      "T-1",
      {
        onPlan: undefined,
        onQaStart: undefined,
        onQaOpen: undefined,
        onBuild: undefined,
        onOpenSession,
        onDelegate: undefined,
        onDefer: undefined,
        onResumeDeferred: undefined,
        onHumanApprove: undefined,
        onHumanRequestChanges: undefined,
        onResetImplementation: undefined,
      },
      {
        resolveSessionOptions: (role) =>
          role === "build" ? { externalSessionId: "session-build" } : undefined,
      },
    );

    expect(onOpenSession).toHaveBeenCalledWith("T-1", "build", {
      externalSessionId: "session-build",
    });
  });
});
