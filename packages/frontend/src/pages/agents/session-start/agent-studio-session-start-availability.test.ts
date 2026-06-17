import { describe, expect, test } from "bun:test";
import { createTaskCardFixture } from "../agent-studio-test-utils";
import {
  canExposeAgentStudioKickoff,
  canStartAgentStudioSessionRole,
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

const selectedSessionIdentity = {
  externalSessionId: "session-1",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo/worktree",
};

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

  test("exposes kickoff only for startable sessionless selections with kickoff prompts", () => {
    expect(
      canExposeAgentStudioKickoff({
        canStartSession: true,
        launchActionId: "build_after_human_request_changes",
        selectedSessionIdentity: null,
      }),
    ).toBe(true);

    expect(
      canExposeAgentStudioKickoff({
        canStartSession: true,
        launchActionId: "build_rebase_conflict_resolution",
        selectedSessionIdentity: null,
      }),
    ).toBe(false);
    expect(
      canExposeAgentStudioKickoff({
        canStartSession: true,
        launchActionId: "build_after_human_request_changes",
        selectedSessionIdentity,
      }),
    ).toBe(false);
    expect(
      canExposeAgentStudioKickoff({
        canStartSession: false,
        launchActionId: "build_after_human_request_changes",
        selectedSessionIdentity: null,
      }),
    ).toBe(false);
  });
});
