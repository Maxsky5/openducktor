import { describe, expect, test } from "bun:test";
import { reviewTaskWorkflows } from "../../test-support/task-workflows";
import { workflowRolePolicies } from "./task-workflow-composition";

describe("workflowRolePolicies", () => {
  test("reads the tools and workspace access of a role from the workflow of the task", () => {
    const policies = workflowRolePolicies(reviewTaskWorkflows);

    expect(policies({ taskId: "task-1", role: "editor" })).toEqual({
      tools: ["odt_read_task", "odt_read_task_artifacts", "odt_set_task_artifact"],
      readOnly: true,
    });
    expect(policies({ taskId: "task-1", role: "writer" })).toMatchObject({ readOnly: false });
  });

  test("rejects a role that the workflow of the task does not declare", () => {
    const policies = workflowRolePolicies(reviewTaskWorkflows);

    expect(() => policies({ taskId: "task-1", role: "build" })).toThrow("build");
  });
});
