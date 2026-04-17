import { describe, expect, test } from "bun:test";
import { createTaskCardFixture } from "../test-utils";
import {
  assertScenarioStartPolicy,
  resolveReuseValidationError,
  resolveStartTask,
} from "./start-session-policies";

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

  test("assertScenarioStartPolicy rejects mismatched role ownership", () => {
    expect(() =>
      assertScenarioStartPolicy({
        role: "planner",
        scenario: "build_implementation_start",
        startMode: "fresh",
      }),
    ).toThrow('Scenario "build_implementation_start" belongs to role "build"');
  });

  test("resolveReuseValidationError distinguishes qa and build mismatches", () => {
    expect(
      resolveReuseValidationError({
        matchesQaTarget: false,
        matchesBuildTarget: true,
      }),
    ).toBe("it does not match the required builder worktree for this QA session");

    expect(
      resolveReuseValidationError({
        matchesQaTarget: true,
        matchesBuildTarget: false,
      }),
    ).toBe("it does not match the current builder continuation target");
  });
});
