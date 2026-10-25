import { describe, expect, test } from "bun:test";
import { createTaskCardFixture } from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import type { TaskSessionGroup, TaskSessionRow } from "./task-sessions-model";
import { taskWorkflowSteps } from "./task-workflow-model";

const row = (id: string, activityState: TaskSessionRow["activityState"]): TaskSessionRow => ({
  key: id,
  identity: { externalSessionId: id, runtimeKind: "opencode", workingDirectory: "/wt/task-1" },
  label: "Builder #1",
  runtimeLabel: "OpenCode",
  startedAt: "2026-10-01T08:00:00.000Z",
  statusLabel: "Running",
  statusTone: "running",
  live: activityState === "running",
  activityState,
});

describe("taskWorkflowSteps", () => {
  test("shows the four Workflow Roles in workflow order", () => {
    const steps = taskWorkflowSteps(createTaskCardFixture(), []);
    expect(steps.map((step) => step.label)).toEqual(["Spec", "Planner", "Builder", "QA"]);
    expect(steps.map((step) => step.stateLabel)).toEqual([
      "Optional",
      "Optional",
      "Ready",
      "Not yet",
    ]);
    expect(steps.every((step) => step.session === null)).toBe(true);
  });

  test("marks a done step and a step whose newest session waits for input", () => {
    const base = createTaskCardFixture();
    const task = createTaskCardFixture({
      status: "in_progress",
      agentWorkflows: {
        ...base.agentWorkflows,
        spec: { required: false, canSkip: true, available: true, completed: true },
      },
    });
    const groups: TaskSessionGroup[] = [
      {
        role: "build",
        roleLabel: "Builder",
        rows: [row("b-2", "waiting_input"), row("b-1", null)],
      },
    ];
    const [spec, , build] = taskWorkflowSteps(task, groups);
    expect(spec).toMatchObject({ stateLabel: "Done", session: null });
    expect(build).toMatchObject({ stateLabel: "Needs input", working: false });
    expect(build?.session?.externalSessionId).toBe("b-2");
  });

  test("marks the steps that a Done task never finished as skipped", () => {
    const closed = { required: false, canSkip: true, available: false, completed: false };
    const task = createTaskCardFixture({
      status: "closed",
      agentWorkflows: {
        spec: closed,
        planner: closed,
        builder: { required: true, canSkip: false, available: false, completed: true },
        qa: closed,
      },
    });
    expect(taskWorkflowSteps(task, []).map((step) => step.stateLabel)).toEqual([
      "Skipped",
      "Skipped",
      "Done",
      "Skipped",
    ]);
  });

  test("marks a step whose newest session runs as working", () => {
    const groups: TaskSessionGroup[] = [
      { role: "spec", roleLabel: "Spec", rows: [row("s-1", "running")] },
    ];
    const [spec] = taskWorkflowSteps(createTaskCardFixture(), groups);
    expect(spec).toMatchObject({ stateLabel: "In progress", working: true });
  });
});
