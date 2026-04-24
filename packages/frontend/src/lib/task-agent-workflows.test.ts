import { describe, expect, test } from "bun:test";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import {
  buildRoleWorkflowMapForTask,
  isRoleAvailableForTask,
  roleWorkflowForTask,
  unavailableRoleErrorMessage,
} from "./task-agent-workflows";

describe("task-agent-workflows", () => {
  test("maps build role to task.agentWorkflows.builder", () => {
    const task = createTaskCardFixture({
      agentWorkflows: {
        spec: { required: false, canSkip: true, available: true, completed: false },
        planner: { required: false, canSkip: true, available: true, completed: false },
        builder: { required: true, canSkip: false, available: false, completed: true },
        qa: { required: false, canSkip: true, available: false, completed: false },
      },
    });

    expect(roleWorkflowForTask(task, "build")).toEqual(task.agentWorkflows.builder);
  });

  test("returns role-specific defaults when task is missing", () => {
    const workflowMap = buildRoleWorkflowMapForTask(null);

    expect(workflowMap.spec).toEqual({
      required: false,
      canSkip: true,
      available: false,
      completed: false,
    });
    expect(workflowMap.planner).toEqual({
      required: false,
      canSkip: true,
      available: false,
      completed: false,
    });
    expect(workflowMap.build).toEqual({
      required: true,
      canSkip: false,
      available: false,
      completed: false,
    });
    expect(workflowMap.qa).toEqual({
      required: false,
      canSkip: true,
      available: false,
      completed: false,
    });
  });

  test("reports role availability and unavailable error message", () => {
    const task = createTaskCardFixture({
      id: "task-77",
      status: "open",
      agentWorkflows: {
        spec: { required: false, canSkip: true, available: true, completed: false },
        planner: { required: false, canSkip: true, available: false, completed: false },
        builder: { required: true, canSkip: false, available: false, completed: false },
        qa: { required: false, canSkip: true, available: false, completed: false },
      },
    });

    expect(isRoleAvailableForTask(task, "spec")).toBe(true);
    expect(isRoleAvailableForTask(task, "build")).toBe(false);
    expect(unavailableRoleErrorMessage(task, "build")).toBe(
      "Role 'build' is unavailable for task 'task-77' in status 'open'.",
    );
  });
});
