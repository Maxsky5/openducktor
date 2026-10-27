import { describe, expect, test } from "bun:test";
import {
  getSessionLaunchAction,
  resolveAgentStudioDefaultRoleForTask,
  resolveSessionContinuationLaunchAction,
  SESSION_LAUNCH_ACTIONS,
} from "./launch";
import { createTaskCardFixture } from "../../test-support/task-card-fixture";
import { BUILTIN_LAUNCH_ACTION_IDS } from "./ids";

describe("session-launch-actions", () => {
  test("keeps launch action ids aligned with action definitions", () => {
    expect(SESSION_LAUNCH_ACTIONS.map(({ id }) => id)).toEqual([...BUILTIN_LAUNCH_ACTION_IDS]);

    for (const id of BUILTIN_LAUNCH_ACTION_IDS) {
      expect(getSessionLaunchAction(id).id).toBe(id);
    }
  });

  test("checks allowed start modes for each launch action", () => {
    expect(getSessionLaunchAction("build_implementation_start").startModes).toEqual(["fresh"]);
    expect(getSessionLaunchAction("build_pull_request_generation").startModes).toEqual([
      "reuse",
      "fork",
    ]);
  });
});

describe("built-in launch defaults", () => {
  test("resolves default role for open tasks from first required available workflow", () => {
    const task = createTaskCardFixture({
      id: "task-1",
      status: "open",
      agentWorkflows: {
        spec: { required: false, canSkip: true, available: true, completed: false },
        planner: { required: false, canSkip: true, available: true, completed: false },
        build: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: false, canSkip: true, available: false, completed: false },
      },
    });

    expect(resolveAgentStudioDefaultRoleForTask(task)).toBe("build");
  });

  test("continues Builder from human feedback, QA rejection, or the implementation start", () => {
    expect(
      resolveSessionContinuationLaunchAction(
        "build",
        createTaskCardFixture({ status: "in_progress" }),
      ),
    ).toBe("build_implementation_start");
    expect(
      resolveSessionContinuationLaunchAction(
        "build",
        createTaskCardFixture({ status: "human_review" }),
      ),
    ).toBe("build_after_human_request_changes");
    expect(
      resolveSessionContinuationLaunchAction(
        "build",
        createTaskCardFixture({
          status: "blocked",
          artifactSummary: {
            spec: { present: false },
            plan: { present: false },
            qaReport: { present: true, verdict: "rejected" },
          },
        }),
      ),
    ).toBe("build_after_qa_rejected");
  });
});
