import { describe, expect, test } from "bun:test";
import {
  buildRoleWorkflowMapForTask,
  isRoleAvailableForTask,
  roleWorkflowForTask,
} from "./presentation-role-state";
import { createTaskCardFixture } from "../../test-support/task-card-fixture";

describe("built-in role workflow presentation", () => {
  test("maps build role to task.agentWorkflows.build", () => {
    const task = createTaskCardFixture({
      agentWorkflows: {
        spec: { required: false, canSkip: true, available: true, completed: false },
        planner: { required: false, canSkip: true, available: true, completed: false },
        build: { required: true, canSkip: false, available: false, completed: true },
        qa: { required: false, canSkip: true, available: false, completed: false },
      },
    });

    expect(roleWorkflowForTask(task, "build")).toEqual(task.agentWorkflows.build);
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
      required: true,
      canSkip: false,
      available: false,
      completed: false,
    });
  });

  test("reports role availability", () => {
    const task = createTaskCardFixture({
      id: "task-77",
      status: "open",
      agentWorkflows: {
        spec: { required: false, canSkip: true, available: true, completed: false },
        planner: { required: false, canSkip: true, available: false, completed: false },
        build: { required: true, canSkip: false, available: false, completed: false },
        qa: { required: false, canSkip: true, available: false, completed: false },
      },
    });

    expect(isRoleAvailableForTask(task, "spec")).toBe(true);
    expect(isRoleAvailableForTask(task, "build")).toBe(false);
  });
});
