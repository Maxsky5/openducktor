import { describe, expect, test } from "bun:test";
import {
  BUILTIN_ROLES,
  createTaskWorkflow,
  resolveWorkspaceBoard,
  workflowRoleIcon,
  workflowRoleLabel,
} from "@openducktor/workflows";
import {
  createWorkflowTaskCardFixture,
  reviewTaskDefinition,
  reviewTaskPromptTemplates,
  reviewTaskRoles,
} from "@openducktor/workflows/test-support";
import { createTestClientConnection } from "../test-support/test-client-connection";
import { loadTaskWorkflowRole } from "./task-workflow-context";
import { taskQueryKeys } from "./tasks";

const scope = { workspaceId: "repo", repoPath: "/repo" };

/** A task of the review workflow, compiled with a catalog that also holds the built-in roles. */
const movedTask = () => {
  const workflow = createTaskWorkflow(reviewTaskDefinition(), reviewTaskPromptTemplates, [
    ...reviewTaskRoles,
    ...BUILTIN_ROLES,
  ]);
  return createWorkflowTaskCardFixture(
    workflow,
    resolveWorkspaceBoard([{ workflow, latest: true }]),
  );
};

describe("session roles of a moved task", () => {
  test("take their label, icon, and policy role from the catalog role", async () => {
    const task = movedTask();
    const builder = BUILTIN_ROLES.find(({ id }) => id === "build")!;
    expect(task.taskWorkflow.hasRole("build")).toBe(false);
    expect(workflowRoleLabel(task.taskWorkflow, "build")).toBe(builder.label);
    expect(workflowRoleIcon(task.taskWorkflow, "build")).toBe(builder.icon);
    const connection = createTestClientConnection();
    try {
      connection.queryClient.setQueryData(taskQueryKeys.unfilteredRepoData(scope), {
        tasks: [task],
      });
      const role = await loadTaskWorkflowRole(connection.queryClient, scope, task.id, "build");
      expect(role).toMatchObject({ id: "build", workspaceAccess: builder.workspaceAccess });
      await expect(
        loadTaskWorkflowRole(connection.queryClient, scope, task.id, "auditor"),
      ).rejects.toThrow('Role "auditor"');
    } finally {
      await connection.dispose();
    }
  });
});
