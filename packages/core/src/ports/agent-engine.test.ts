import { describe, expect, test } from "bun:test";
import { workflowAgentSessionScope } from "./agent-engine";

describe("agent session scope helpers", () => {
  test("constructs a workflow scope", () => {
    const scope = workflowAgentSessionScope("repo", "task-1", "build");

    expect(scope).toEqual({
      kind: "workflow",
      workspaceId: "repo",
      taskId: "task-1",
      role: "build",
    });
  });
});
