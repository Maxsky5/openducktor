import { describe, expect, test } from "bun:test";
import { createTaskCardFixture } from "../agent-studio-test-utils";
import {
  canStartAgentStudioSessionRole,
  canUseAgentStudioKickoffPrompt,
} from "./agent-studio-session-start-availability";

const availableTask = () =>
  createTaskCardFixture({
    agentWorkflows: {
      spec: { required: false, canSkip: true, available: true, completed: false },
      planner: { required: false, canSkip: true, available: true, completed: false },
      builder: { required: true, canSkip: false, available: true, completed: false },
      qa: { required: false, canSkip: true, available: false, completed: false },
    },
  });

describe("agent studio session start availability", () => {
  test("requires task, runtime, active task readiness, and role availability", () => {
    expect(
      canStartAgentStudioSessionRole({
        taskId: "task-1",
        role: "spec",
        selectedTask: availableTask(),
        agentStudioReady: true,
        isActiveTaskReady: true,
      }),
    ).toBe(true);

    expect(
      canStartAgentStudioSessionRole({
        taskId: "task-1",
        role: "spec",
        selectedTask: availableTask(),
        agentStudioReady: false,
        isActiveTaskReady: true,
      }),
    ).toBe(false);
    expect(
      canStartAgentStudioSessionRole({
        taskId: "task-1",
        role: "spec",
        selectedTask: null,
        agentStudioReady: true,
        isActiveTaskReady: true,
      }),
    ).toBe(false);
    expect(
      canStartAgentStudioSessionRole({
        taskId: "task-1",
        role: "qa",
        selectedTask: availableTask(),
        agentStudioReady: true,
        isActiveTaskReady: true,
      }),
    ).toBe(false);
  });

  test("uses kickoff only for startable launch actions with kickoff prompts", () => {
    expect(
      canUseAgentStudioKickoffPrompt({
        canStartSession: true,
        launchActionId: "build_after_human_request_changes",
      }),
    ).toBe(true);

    expect(
      canUseAgentStudioKickoffPrompt({
        canStartSession: true,
        launchActionId: "build_rebase_conflict_resolution",
      }),
    ).toBe(false);
    expect(
      canUseAgentStudioKickoffPrompt({
        canStartSession: false,
        launchActionId: "build_after_human_request_changes",
      }),
    ).toBe(false);
  });
});
