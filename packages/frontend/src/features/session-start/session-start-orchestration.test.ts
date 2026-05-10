import { describe, expect, mock, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  createAgentSessionFixture,
  createTaskCardFixture,
} from "@/test-utils/shared-test-fixtures";
import {
  buildSessionStartModalRequest,
  executeSessionStartFromDecision,
} from "./session-start-orchestration";

const BUILD_SELECTION = {
  runtimeKind: "opencode" as const,
  providerId: "openai",
  modelId: "gpt-5",
  variant: "default",
  profileId: "build-agent",
};

const settleStartedAgentSession = () => undefined;

const CODEX_BUILD_SELECTION = {
  ...BUILD_SELECTION,
  runtimeKind: "codex" as const,
  providerId: "codex",
  variant: "medium",
};

describe("session-start-orchestration", () => {
  test("prefers the active reusable session and task defaults when building a modal request", () => {
    const latestSession = createAgentSessionFixture({
      externalSessionId: "builder-session-2",
      taskId: "TASK-1",
      role: "build",
      startedAt: "2026-03-20T12:00:00.000Z",
    });
    const activeSession = createAgentSessionFixture({
      externalSessionId: "builder-session-1",
      taskId: "TASK-1",
      role: "build",
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
      taskSessions: [latestSession, activeSession],
      activeSession,
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
    expect(request.initialSourceExternalSessionId).toBe("builder-session-1");
    expect(request.initialTargetBranch).toEqual({
      remote: "origin",
      branch: "release/2026.04",
    });
    expect(request.initialTargetBranchError).toBe("saved target branch is invalid");
    expect(request.existingSessionOptions).toEqual([
      expect.objectContaining({ value: "builder-session-2" }),
      expect.objectContaining({ value: "builder-session-1" }),
    ]);
  });

  test("falls back to the latest reusable session when no active session matches", () => {
    const latestSession = createAgentSessionFixture({
      externalSessionId: "builder-session-2",
      taskId: "TASK-1",
      role: "build",
      startedAt: "2026-03-20T12:00:00.000Z",
    });
    const olderSession = createAgentSessionFixture({
      externalSessionId: "builder-session-1",
      taskId: "TASK-1",
      role: "build",
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

    expect(request.initialSourceExternalSessionId).toBe("builder-session-2");
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
        createAgentSessionFixture({
          externalSessionId: "spec-session-1",
          taskId: "TASK-1",
          role: "spec",
        }),
      ],
    });

    expect(request.existingSessionOptions).toBeUndefined();
    expect(request.initialSourceExternalSessionId).toBeNull();
    expect(request.initialStartMode).toBe("fresh");
    expect(request.targetWorkingDirectory).toBe("/repo/worktrees/TASK-1");
  });

  test("keeps an explicit initial source session override even when another active session matches", () => {
    const latestSession = createAgentSessionFixture({
      externalSessionId: "builder-session-2",
      taskId: "TASK-1",
      role: "build",
      startedAt: "2026-03-20T12:00:00.000Z",
    });
    const activeSession = createAgentSessionFixture({
      externalSessionId: "builder-session-1",
      taskId: "TASK-1",
      role: "build",
      startedAt: "2026-03-19T12:00:00.000Z",
    });

    const request = buildSessionStartModalRequest({
      source: "kanban",
      request: {
        taskId: "TASK-1",
        role: "build",
        launchActionId: "build_implementation_start",
        initialSourceExternalSessionId: "builder-session-2",
        postStartAction: "kickoff",
      },
      selectedModel: null,
      taskSessions: [latestSession, activeSession],
      activeSession,
    });

    expect(request.initialSourceExternalSessionId).toBe("builder-session-2");
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

  test("maps reuse decisions to workflow execution without a selected model", async () => {
    const startAgentSession = mock(async () => "builder-session-2");

    const result = await executeSessionStartFromDecision({
      activeWorkspace: null,
      queryClient: new QueryClient(),
      request: {
        taskId: "TASK-1",
        role: "build",
        launchActionId: "build_implementation_start",
        postStartAction: "none",
      },
      decision: {
        startMode: "reuse",
        sourceExternalSessionId: "builder-session-1",
      },
      task: createTaskCardFixture({ id: "TASK-1" }),
      startAgentSession,
      settleStartedAgentSession,
    });

    expect(result).toEqual({
      externalSessionId: "builder-session-2",
      postStartActionError: null,
    });
    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        startMode: "reuse",
        sourceExternalSessionId: "builder-session-1",
      }),
    );
    expect(startAgentSession).not.toHaveBeenCalledWith(
      expect.objectContaining({ selectedModel: expect.anything() }),
    );
  });

  test("maps Codex reuse decisions to workflow execution with standard kickoff messaging", async () => {
    const startAgentSession = mock(async () => "codex-session-1");
    const sendAgentMessage = mock(async () => undefined);

    const result = await executeSessionStartFromDecision({
      activeWorkspace: null,
      queryClient: new QueryClient(),
      request: {
        taskId: "TASK-1",
        role: "build",
        launchActionId: "build_implementation_start",
        postStartAction: "kickoff",
        existingSessionOptions: [
          {
            value: "codex-session-1",
            label: "Codex session",
            description: "Existing Codex builder session",
            runtimeKind: "codex",
            selectedModel: CODEX_BUILD_SELECTION,
          },
        ],
      },
      decision: {
        startMode: "reuse",
        sourceExternalSessionId: "codex-session-1",
      },
      task: createTaskCardFixture({ id: "TASK-1" }),
      startAgentSession,
      settleStartedAgentSession,
      sendAgentMessage,
      postStartExecution: "await",
    });

    expect(result).toEqual({
      externalSessionId: "codex-session-1",
      postStartActionError: null,
    });
    expect(sendAgentMessage).toHaveBeenCalledWith("codex-session-1", [
      expect.objectContaining({
        kind: "text",
        text: expect.stringContaining("taskId TASK-1"),
      }),
    ]);
    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        startMode: "reuse",
        sourceExternalSessionId: "codex-session-1",
      }),
    );
  });

  test("maps fork decisions to workflow execution with the selected model and source session", async () => {
    const startAgentSession = mock(async () => "builder-session-fork");

    await executeSessionStartFromDecision({
      activeWorkspace: null,
      queryClient: new QueryClient(),
      request: {
        taskId: "TASK-1",
        role: "build",
        launchActionId: "build_implementation_start",
        postStartAction: "none",
      },
      decision: {
        startMode: "fork",
        selectedModel: BUILD_SELECTION,
        sourceExternalSessionId: "builder-session-1",
      },
      task: createTaskCardFixture({ id: "TASK-1" }),
      startAgentSession,
      settleStartedAgentSession,
    });

    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        startMode: "fork",
        selectedModel: BUILD_SELECTION,
        sourceExternalSessionId: "builder-session-1",
      }),
    );
  });

  test("reports detached post-start failures without losing the started session", async () => {
    const startAgentSession = mock(async () => "session-new");
    const sendAgentMessage = mock(async () => {
      throw new Error("kickoff failed");
    });
    const onPostStartActionError = mock(() => {});

    const result = await executeSessionStartFromDecision({
      activeWorkspace: null,
      queryClient: new QueryClient(),
      request: {
        taskId: "TASK-1",
        role: "build",
        launchActionId: "build_implementation_start",
        postStartAction: "kickoff",
      },
      decision: {
        startMode: "fresh",
        selectedModel: BUILD_SELECTION,
      },
      task: createTaskCardFixture({ id: "TASK-1" }),
      startAgentSession,
      settleStartedAgentSession,
      sendAgentMessage,
      onPostStartActionError,
    });

    expect(result).toEqual({
      externalSessionId: "session-new",
      postStartActionError: null,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onPostStartActionError).toHaveBeenCalledWith(
      "kickoff",
      expect.objectContaining({ message: "kickoff failed" }),
    );
  });
});
