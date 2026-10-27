import { describe, expect, test } from "bun:test";
import {
  deriveTaskProjection,
  type BuiltinTaskCard as TaskCard,
  builtinTaskCardSchema,
} from "@openducktor/workflows";
import { buildRoleWorkflowState, workflowStepRailState } from "./agent-workflow-state";

const rejectedTask = (status: TaskCard["status"]): TaskCard => {
  const record = {
    id: "task-1",
    title: "Task 1",
    issueType: "feature" as const,
    status,
    artifactSummary: {
      spec: { present: true },
      plan: { present: true },
      qaReport: { present: true, verdict: "rejected" },
    },
    updatedAt: "2026-02-22T12:00:00.000Z",
    createdAt: "2026-02-22T12:00:00.000Z",
  };
  return builtinTaskCardSchema.parse({ ...record, ...deriveTaskProjection(record) });
};

describe("built-in workflow rail state", () => {
  test("marks Builder done and QA rejected while QA feedback waits for rework", () => {
    const task = rejectedTask("in_progress");
    expect(
      buildRoleWorkflowState({
        task,
        role: "build",
        workflow: task.agentWorkflows.build,
        liveSession: "none",
      }),
    ).toMatchObject({ tone: "done", completion: "done" });
    expect(
      buildRoleWorkflowState({
        task,
        role: "qa",
        workflow: task.agentWorkflows.qa,
        liveSession: "none",
      }),
    ).toMatchObject({ tone: "rejected", completion: "rejected" });
  });

  test("shows an active QA retry on a blocked task ahead of the saved rejection", () => {
    const task = rejectedTask("blocked");
    const qa = (liveSession: "running" | "idle") =>
      buildRoleWorkflowState({ task, role: "qa", workflow: task.agentWorkflows.qa, liveSession });
    expect(qa("running")).toMatchObject({ tone: "in_progress", completion: "in_progress" });
    expect(qa("idle")).toMatchObject({ tone: "rejected", completion: "rejected" });
  });

  test("asks for input on a blocked Builder that is not working", () => {
    const task = rejectedTask("blocked");
    const state = buildRoleWorkflowState({
      task,
      role: "build",
      workflow: task.agentWorkflows.build,
      liveSession: "stopped",
    });
    expect(state.tone).toBe("waiting_input");
    expect(workflowStepRailState({ role: "build", state, sessionValue: null })).toEqual({
      attentionVariant: "blocked_task",
      hint: "Task is blocked and waiting for user action",
    });
  });

  test("marks an available optional step without a task", () => {
    expect(
      buildRoleWorkflowState({
        task: null,
        role: "spec",
        workflow: { required: false, canSkip: true, available: true, completed: false },
        liveSession: "none",
      }),
    ).toEqual({
      tone: "optional",
      availability: "optional",
      completion: "not_started",
      liveSession: "none",
    });
  });
});
