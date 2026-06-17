import { describe, expect, test } from "bun:test";
import { createTaskCardFixture } from "../test-utils";
import { resolveStartTask } from "./start-session-policies";

describe("agent-orchestrator/handlers/start-session-policies", () => {
  test("resolveStartTask returns the matching task when the role is available", () => {
    const task = createTaskCardFixture({
      id: "task-1",
      status: "in_progress",
    });

    expect(
      resolveStartTask({
        ctx: {
          repoPath: "/tmp/repo",
          workspaceId: "workspace-1",
          taskId: "task-1",
          role: "build",
          holdForPostStartMessage: false,
          isStaleRepoOperation: () => false,
        },
        task: {
          taskRef: { current: [task] },
          loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
          refreshTaskData: async () => {},
          sendAgentMessage: async () => {},
        },
      }),
    ).toEqual(task);
  });
});
