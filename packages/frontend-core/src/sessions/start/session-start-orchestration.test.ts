import { describe, expect, test } from "bun:test";
import { createTaskWorkflow, resolveWorkflowBoard } from "@openducktor/workflows";
import {
  createWorkflowTaskCardFixture,
  reviewTaskDefinition,
  reviewTaskPromptTemplates,
  reviewTaskRoles,
} from "@openducktor/workflows/test-support";
import {
  createAgentSessionSummaryFixture,
  createTaskCardFixture,
} from "../../test-support/shared-test-fixtures";
import { buildSessionStartModalRequest } from "./session-start-orchestration";
import type { SessionStartFlowRequest } from "./session-start-types";

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
      sessionAssociation: {
        kind: "workflow",
        workspaceId: "workspace-1",
        taskId: "TASK-1",
        role: "build",
      },

      startedAt: "2026-03-20T12:00:00.000Z",
    });
    const preferredSourceSession = createAgentSessionSummaryFixture({
      externalSessionId: "builder-session-1",
      sessionAssociation: {
        kind: "workflow",
        workspaceId: "workspace-1",
        taskId: "TASK-1",
        role: "build",
      },

      startedAt: "2026-03-19T12:00:00.000Z",
    });

    const request = buildSessionStartModalRequest({
      source: "agent_studio",
      request: {
        taskId: "TASK-1",
        role: "build",
        launchActionId: "pull_request",
        postStartAction: "kickoff",
      },
      selectedModel: BUILD_SELECTION,
      taskSessions: [latestSession, preferredSourceSession],
      preferredSourceSession,
      selectedTask: createTaskCardFixture({
        id: "TASK-1",
        status: "human_review",
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
      sessionAssociation: {
        kind: "workflow",
        workspaceId: "workspace-1",
        taskId: "TASK-1",
        role: "build",
      },

      startedAt: "2026-03-20T12:00:00.000Z",
    });
    const olderSession = createAgentSessionSummaryFixture({
      externalSessionId: "builder-session-1",
      sessionAssociation: {
        kind: "workflow",
        workspaceId: "workspace-1",
        taskId: "TASK-1",
        role: "build",
      },

      startedAt: "2026-03-19T12:00:00.000Z",
    });

    const request = buildSessionStartModalRequest({
      source: "task_action",
      request: {
        taskId: "TASK-1",
        role: "build",
        launchActionId: "pull_request",
        postStartAction: "kickoff",
      },
      selectedTask: createTaskCardFixture({ id: "TASK-1", status: "human_review" }),
      selectedModel: null,
      taskSessions: [latestSession, olderSession],
    });

    expect(request.initialSourceSession).toEqual(sessionIdentity("builder-session-2"));
  });

  test("does not auto-build reusable options for fresh-only launch actions and preserves overrides", () => {
    const request = buildSessionStartModalRequest({
      source: "agent_studio",
      selectedTask: createTaskCardFixture({ id: "TASK-1" }),
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
          sessionAssociation: {
            kind: "workflow",
            workspaceId: "workspace-1",
            taskId: "TASK-1",
            role: "spec",
          },
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
      sessionAssociation: {
        kind: "workflow",
        workspaceId: "workspace-1",
        taskId: "TASK-1",
        role: "build",
      },

      startedAt: "2026-03-20T12:00:00.000Z",
    });
    const preferredSourceSession = createAgentSessionSummaryFixture({
      externalSessionId: "builder-session-1",
      sessionAssociation: {
        kind: "workflow",
        workspaceId: "workspace-1",
        taskId: "TASK-1",
        role: "build",
      },

      startedAt: "2026-03-19T12:00:00.000Z",
    });

    const request = buildSessionStartModalRequest({
      source: "task_action",
      request: {
        taskId: "TASK-1",
        role: "build",
        launchActionId: "build_implementation_start",
        initialSourceSession: sessionIdentity("builder-session-2"),
        postStartAction: "kickoff",
      },
      selectedTask: createTaskCardFixture({ id: "TASK-1" }),
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

  test("assesses a feedback launch in the state that its event gives", () => {
    const definition = reviewTaskDefinition();
    const write = definition.steps.find(({ id }) => id === "write")!;
    write.availableWhen = { stateIn: ["open", "writing", "paused"] };
    const workflow = createTaskWorkflow(definition, reviewTaskPromptTemplates, reviewTaskRoles);
    const board = resolveWorkflowBoard(
      { states: workflow.definition.states.map(({ id }) => ({ id, taskOrder: "updated" })) },
      [workflow],
    );
    const selectedTask = createWorkflowTaskCardFixture(workflow, board, { status: "approval" });
    const build = (eventId?: string) => {
      const request: SessionStartFlowRequest = {
        taskId: selectedTask.id,
        role: "writer",
        launchActionId: "write_feedback",
        postStartAction: "kickoff",
      };
      if (eventId) request.beforeStartAction = { eventId };
      return buildSessionStartModalRequest({
        source: "task_action",
        request,
        selectedModel: BUILD_SELECTION,
        taskSessions: [],
        selectedTask,
      });
    };

    expect(build("request-rewrite")).toMatchObject({
      taskId: selectedTask.id,
      role: "writer",
      launchActionId: "write_feedback",
    });
    expect(() => build()).toThrow(
      `Workflow step for role "writer" is unavailable for task "${selectedTask.id}".`,
    );
  });
});
