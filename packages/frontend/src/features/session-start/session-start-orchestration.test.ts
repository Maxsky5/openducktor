import { describe, expect, test } from "bun:test";
import {
  createAgentSessionSummaryFixture,
  createTaskCardFixture,
} from "@/test-utils/shared-test-fixtures";
import { buildSessionStartModalRequest } from "./session-start-orchestration";

const BUILD_SELECTION = {
  runtimeKind: "opencode" as const,
  providerId: "openai",
  modelId: "gpt-5",
  variant: "default",
  profileId: "build-agent",
};

const sessionIdentity = (
  externalSessionId: string,
  runtimeKind: "opencode" | "codex" = "opencode",
) => ({
  externalSessionId,
  runtimeKind,
  workingDirectory: "/tmp/repo/worktree",
});

describe("session-start-orchestration", () => {
  // This test is fast, but a stalled Windows CI worker took 1.6 s to run it. The budget covers the stall.
  test("prefers the preferred reusable session and task defaults when building a modal request", () => {
    const latestSession = createAgentSessionSummaryFixture({
      externalSessionId: "builder-session-2",
      sessionAssociation: { kind: "workflow", taskId: "TASK-1", role: "build" },

      startedAt: "2026-03-20T12:00:00.000Z",
    });
    const preferredSourceSession = createAgentSessionSummaryFixture({
      externalSessionId: "builder-session-1",
      sessionAssociation: { kind: "workflow", taskId: "TASK-1", role: "build" },

      startedAt: "2026-03-19T12:00:00.000Z",
    });

    const request = buildSessionStartModalRequest({
      source: "agent_studio",
      request: {
        taskId: "TASK-1",
        role: "build",
        launchActionId: "build_pull_request_generation",
        postStartAction: "kickoff",
      },
      selectedModel: BUILD_SELECTION,
      taskSessions: [latestSession, preferredSourceSession],
      preferredSourceSession,
      selectedTask: createTaskCardFixture({
        id: "TASK-1",
        targetBranch: {
          remote: "origin",
          branch: "release/2026.04",
        },
        targetBranchError: "saved target branch is invalid",
      }),
    });

    expect(request.selectedModel).toEqual(BUILD_SELECTION);
    expect(request.initialSourceSession).toEqual(sessionIdentity("builder-session-1"));
    expect(request.initialTargetBranch).toEqual({
      remote: "origin",
      branch: "release/2026.04",
    });
    expect(request.initialTargetBranchError).toBe("saved target branch is invalid");
    expect(request.existingSessionOptions).toEqual([
      expect.objectContaining({ sourceSession: sessionIdentity("builder-session-2") }),
      expect.objectContaining({ sourceSession: sessionIdentity("builder-session-1") }),
    ]);
  }, 5_000);

  test("falls back to the latest reusable session when no preferred source session matches", () => {
    const latestSession = createAgentSessionSummaryFixture({
      externalSessionId: "builder-session-2",
      sessionAssociation: { kind: "workflow", taskId: "TASK-1", role: "build" },

      startedAt: "2026-03-20T12:00:00.000Z",
    });
    const olderSession = createAgentSessionSummaryFixture({
      externalSessionId: "builder-session-1",
      sessionAssociation: { kind: "workflow", taskId: "TASK-1", role: "build" },

      startedAt: "2026-03-19T12:00:00.000Z",
    });

    const request = buildSessionStartModalRequest({
      source: "kanban",
      request: {
        taskId: "TASK-1",
        role: "build",
        launchActionId: "build_pull_request_generation",
        postStartAction: "kickoff",
      },
      selectedModel: null,
      taskSessions: [latestSession, olderSession],
    });

    expect(request.initialSourceSession).toEqual(sessionIdentity("builder-session-2"));
  });

  test("does not auto-build reusable options for fresh-only launch actions and preserves overrides", () => {
    const request = buildSessionStartModalRequest({
      source: "agent_studio",
      request: {
        taskId: "TASK-1",
        role: "spec",
        launchActionId: "spec_initial",
        postStartAction: "none",
        initialStartMode: "fresh",
        targetWorkingDirectory: "/repo/worktrees/TASK-1",
      },
      selectedModel: BUILD_SELECTION,
      taskSessions: [
        createAgentSessionSummaryFixture({
          externalSessionId: "spec-session-1",
          sessionAssociation: { kind: "workflow", taskId: "TASK-1", role: "spec" },
        }),
      ],
    });

    expect(request.existingSessionOptions).toBeUndefined();
    expect(request.initialSourceSession).toBeNull();
    expect(request.initialStartMode).toBe("fresh");
    expect(request.targetWorkingDirectory).toBe("/repo/worktrees/TASK-1");
  });

  test("keeps an explicit initial source session override even when another preferred source session matches", () => {
    const latestSession = createAgentSessionSummaryFixture({
      externalSessionId: "builder-session-2",
      sessionAssociation: { kind: "workflow", taskId: "TASK-1", role: "build" },

      startedAt: "2026-03-20T12:00:00.000Z",
    });
    const preferredSourceSession = createAgentSessionSummaryFixture({
      externalSessionId: "builder-session-1",
      sessionAssociation: { kind: "workflow", taskId: "TASK-1", role: "build" },

      startedAt: "2026-03-19T12:00:00.000Z",
    });

    const request = buildSessionStartModalRequest({
      source: "kanban",
      request: {
        taskId: "TASK-1",
        role: "build",
        launchActionId: "build_implementation_start",
        initialSourceSession: sessionIdentity("builder-session-2"),
        postStartAction: "kickoff",
      },
      selectedModel: null,
      taskSessions: [latestSession, preferredSourceSession],
      preferredSourceSession,
    });

    expect(request.initialSourceSession).toEqual(sessionIdentity("builder-session-2"));
  });

  test("keeps an explicit target branch override instead of selected task defaults", () => {
    const request = buildSessionStartModalRequest({
      source: "agent_studio",
      request: {
        taskId: "TASK-1",
        role: "build",
        launchActionId: "build_implementation_start",
        initialTargetBranch: {
          remote: "origin",
          branch: "release/2026.05",
        },
        initialTargetBranchError: "use the override instead",
        postStartAction: "kickoff",
      },
      selectedModel: BUILD_SELECTION,
      taskSessions: [],
      selectedTask: createTaskCardFixture({
        id: "TASK-1",
        targetBranch: {
          remote: "origin",
          branch: "main",
        },
        targetBranchError: "saved task target branch is invalid",
      }),
    });

    expect(request.initialTargetBranch).toEqual({
      remote: "origin",
      branch: "release/2026.05",
    });
    expect(request.initialTargetBranchError).toBe("use the override instead");
  });
});
