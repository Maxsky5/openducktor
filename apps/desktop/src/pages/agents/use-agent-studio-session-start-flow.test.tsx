import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { clearAppQueryClient } from "@/lib/query-client";
import { host } from "@/state/operations/host";
import type { AgentSessionLoadOptions } from "@/types/agent-orchestrator";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { kickoffPromptForScenario } from "./agents-page-constants";
import { useAgentStudioSessionStartFlow as useSessionStartFlow } from "./use-agent-studio-session-start-flow";

enableReactActEnvironment();

beforeEach(async () => {
  await clearAppQueryClient();
});

type HookArgs = Parameters<typeof useSessionStartFlow>[0];

const createTask = (overrides = {}) => createTaskCardFixture(overrides);

const createSession = (overrides = {}) => createAgentSessionFixture(overrides);

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useSessionStartFlow, initialProps);

const createBaseArgs = (): HookArgs => ({
  activeRepo: "/repo",
  taskId: "task-1",
  role: "spec",
  scenario: "spec_initial",
  activeSession: null,
  sessionsForTask: [],
  selectedTask: createTask(),
  agentStudioReady: true,
  isActiveTaskHydrated: true,
  isSessionWorking: false,
  selectionForNewSession: {
    runtimeKind: "opencode",
    providerId: "openai",
    modelId: "gpt-5",
    variant: "default",
    profileId: "spec",
  },
  startAgentSession: async () => "session-new",
  sendAgentMessage: async () => {},
  updateAgentSessionModel: () => {},
  loadAgentSessions: async () => {},
  humanRequestChangesTask: async () => {},
  updateQuery: () => {},
});

describe("useAgentStudioSessionStartFlow", () => {
  const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;
  const originalWorkspaceGetSettingsSnapshot = host.workspaceGetSettingsSnapshot;
  const originalBuildContinuationTargetGet = host.buildContinuationTargetGet;

  beforeEach(() => {
    host.workspaceGetRepoConfig = async () =>
      ({
        promptOverrides: {},
      }) as Awaited<ReturnType<typeof host.workspaceGetRepoConfig>>;
    host.workspaceGetSettingsSnapshot = async () => ({
      theme: "light" as const,
      git: {
        defaultMergeMethod: "merge_commit",
      },
      chat: {
        showThinkingMessages: false,
      },
      repos: {},
      globalPromptOverrides: {},
    });
    host.buildContinuationTargetGet = async () => ({
      workingDirectory: "/repo/worktrees/task-1",
      source: "builder_session",
    });
  });

  afterEach(() => {
    host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
    host.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
    host.buildContinuationTargetGet = originalBuildContinuationTargetGet;
  });

  test("startSession reuses active session and clears fresh-start query flag", async () => {
    const updateCalls: Array<Record<string, string | undefined>> = [];
    const activeSession = createSession({
      taskId: "task-1",
      sessionId: "session-active",
      role: "spec",
      scenario: "spec_initial",
    });

    const harness = createHookHarness({
      ...createBaseArgs(),
      activeSession,
      updateQuery: (updates) => {
        updateCalls.push(updates);
      },
    });

    await harness.mount();
    await harness.run(async (state) => {
      const sessionId = await state.startSession("composer_send");
      expect(sessionId).toBe("session-active");
    });

    expect(updateCalls).toContainEqual({
      task: "task-1",
      session: "session-active",
      agent: "spec",
      autostart: undefined,
      start: undefined,
    });

    await harness.unmount();
  });

  test("handleCreateSession restores previous query when fresh start fails", async () => {
    const startAgentSession = mock(async () => {
      throw new Error("start failed");
    });
    const sendAgentMessage = mock(async () => {});
    const updateCalls: Array<Record<string, string | undefined>> = [];

    const harness = createHookHarness({
      ...createBaseArgs(),
      activeSession: createSession({
        taskId: "task-1",
        sessionId: "session-spec",
        role: "spec",
        scenario: "spec_initial",
      }),
      startAgentSession,
      sendAgentMessage,
      updateQuery: (updates) => {
        updateCalls.push(updates);
      },
    });

    await harness.mount();
    await harness.run((state) => {
      state.handleCreateSession({
        id: "planner:planner_initial:fresh",
        role: "planner",
        scenario: "planner_initial",
        label: "Planner · Start Planner",
        description: "Create a new planner session from scratch",
        disabled: false,
      });
    });

    await harness.waitFor(() => updateCalls.length >= 2);

    expect(updateCalls[0]).toEqual({
      task: "task-1",
      session: undefined,
      agent: "planner",
      autostart: undefined,
      start: undefined,
    });
    expect(updateCalls).toContainEqual({
      task: "task-1",
      session: "session-spec",
      agent: "spec",
      autostart: undefined,
      start: undefined,
    });
    expect(updateCalls).toHaveLength(2);
    expect(sendAgentMessage).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("handleCreateSession for qa rejection starts a fresh builder session in the existing worktree", async () => {
    const startAgentSession = mock(async () => "session-build-rework");
    const sendAgentMessage = mock(async () => {});
    const updateCalls: Array<Record<string, string | undefined>> = [];

    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "qa",
      scenario: "qa_review",
      activeSession: createSession({
        taskId: "task-1",
        sessionId: "session-qa",
        role: "qa",
        scenario: "qa_review",
      }),
      selectedTask: createTask({
        status: "in_progress",
        documentSummary: {
          spec: { has: false, updatedAt: undefined },
          plan: { has: false, updatedAt: undefined },
          qaReport: { has: true, updatedAt: "2026-02-22T10:00:00.000Z", verdict: "rejected" },
        },
        agentWorkflows: {
          spec: { required: true, canSkip: false, available: true, completed: true },
          planner: { required: true, canSkip: false, available: true, completed: true },
          builder: { required: true, canSkip: false, available: true, completed: false },
          qa: { required: true, canSkip: false, available: false, completed: false },
        },
      }),
      startAgentSession,
      sendAgentMessage,
      updateQuery: (updates) => {
        updateCalls.push(updates);
      },
    });

    await harness.mount();
    await harness.run((state) => {
      state.handleCreateSession({
        id: "build:build_after_qa_rejected:fresh",
        role: "build",
        scenario: "build_after_qa_rejected",
        label: "Builder · Fix QA Rejection",
        description: "Create a new builder session in the existing worktree",
        disabled: false,
      });
    });

    expect(startAgentSession).toHaveBeenCalledWith({
      taskId: "task-1",
      role: "build",
      scenario: "build_after_qa_rejected",
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        profileId: "spec",
      },
      sendKickoff: false,
      startMode: "fresh",
      requireModelReady: true,
      workingDirectoryOverride: "/repo/worktrees/task-1",
    });
    expect(sendAgentMessage).toHaveBeenCalledWith(
      "session-build-rework",
      kickoffPromptForScenario("build", "build_after_qa_rejected", "task-1"),
    );
    expect(updateCalls).toContainEqual({
      task: "task-1",
      session: "session-build-rework",
      agent: "build",
      autostart: undefined,
      start: undefined,
    });

    await harness.unmount();
  });

  test("handleCreateSession for human changes opens the feedback modal before model selection", async () => {
    const requestNewSessionStart = mock(async () => ({ selectedModel: null }));
    const startAgentSession = mock(async () => "session-build-human");
    const loadAgentSessions = mock(
      async (_taskId: string, _options?: AgentSessionLoadOptions) => {},
    );

    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "spec",
      scenario: "spec_initial",
      requestNewSessionStart,
      startAgentSession,
      loadAgentSessions,
      selectedTask: createTask({ status: "human_review" }),
      sessionsForTask: [
        createSession({
          sessionId: "session-build-latest",
          role: "build",
          scenario: "build_implementation_start",
          startedAt: "2026-02-22T12:00:00.000Z",
        }),
      ],
    });

    await harness.mount();
    await harness.run((state) => {
      state.handleCreateSession({
        id: "build:build_after_human_request_changes:fresh",
        role: "build",
        scenario: "build_after_human_request_changes",
        label: "Builder · Apply Human Changes",
        description: "Create a new builder session after human review",
        disabled: false,
      });
    });

    await harness.waitFor((state) => state.humanReviewFeedbackModal !== null);

    expect(loadAgentSessions).toHaveBeenCalledWith("task-1");
    expect(harness.getLatest().humanReviewFeedbackModal?.open).toBe(true);
    expect(requestNewSessionStart).not.toHaveBeenCalled();
    expect(startAgentSession).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("startScenarioKickoff for human changes opens the feedback modal instead of starting immediately", async () => {
    const requestNewSessionStart = mock(async () => ({
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        profileId: "build",
      },
    }));
    const startAgentSession = mock(async () => "session-build-human");
    const sendAgentMessage = mock(async () => {});
    const loadAgentSessions = mock(
      async (_taskId: string, _options?: AgentSessionLoadOptions) => {},
    );

    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "build",
      scenario: "build_after_human_request_changes",
      requestNewSessionStart,
      startAgentSession,
      sendAgentMessage,
      loadAgentSessions,
      selectedTask: createTask({ status: "human_review" }),
      sessionsForTask: [
        createSession({
          sessionId: "session-build-existing",
          role: "build",
          scenario: "build_implementation_start",
          startedAt: "2026-02-22T12:00:00.000Z",
        }),
      ],
    });

    await harness.mount();
    await harness.run(async (state) => {
      await state.startScenarioKickoff();
    });

    await harness.waitFor((state) => state.humanReviewFeedbackModal !== null);

    expect(loadAgentSessions).toHaveBeenCalledWith("task-1");
    expect(harness.getLatest().humanReviewFeedbackModal?.open).toBe(true);
    expect(startAgentSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("human changes feedback can target an existing builder session", async () => {
    const startAgentSession = mock(async () => "session-build-human");
    const sendAgentMessage = mock(async () => {});
    const humanRequestChangesTask = mock(async () => {});
    const loadAgentSessions = mock(
      async (_taskId: string, _options?: AgentSessionLoadOptions) => {},
    );
    const updateCalls: Array<Record<string, string | undefined>> = [];

    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "spec",
      scenario: "spec_initial",
      startAgentSession,
      sendAgentMessage,
      humanRequestChangesTask,
      loadAgentSessions,
      selectedTask: createTask({ status: "human_review" }),
      activeSession: createSession({ sessionId: "session-spec", role: "spec" }),
      sessionsForTask: [
        createSession({
          sessionId: "session-build-latest",
          role: "build",
          scenario: "build_implementation_start",
          startedAt: "2026-02-22T12:00:00.000Z",
        }),
        createSession({
          sessionId: "session-build-older",
          role: "build",
          scenario: "build_implementation_start",
          startedAt: "2026-02-22T11:00:00.000Z",
        }),
      ],
      updateQuery: (updates) => {
        updateCalls.push(updates);
      },
    });

    await harness.mount();
    await harness.run((state) => {
      state.handleCreateSession({
        id: "build:build_after_human_request_changes:fresh",
        role: "build",
        scenario: "build_after_human_request_changes",
        label: "Builder · Apply Human Changes",
        description: "Create a new builder session after human review",
        disabled: false,
      });
    });
    await harness.waitFor((state) => state.humanReviewFeedbackModal !== null);

    await harness.run((state) => {
      state.humanReviewFeedbackModal?.onTargetChange("session-build-older");
      state.humanReviewFeedbackModal?.onMessageChange("Apply the requested human changes.");
    });
    await harness.run(async (state) => {
      await state.humanReviewFeedbackModal?.onConfirm();
    });

    expect(humanRequestChangesTask).toHaveBeenCalledWith(
      "task-1",
      "Apply the requested human changes.",
    );
    expect(loadAgentSessions.mock.calls).toEqual([
      ["task-1"],
      ["task-1", { hydrateHistoryForSessionId: "session-build-older" }],
    ]);
    expect(startAgentSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).toHaveBeenCalledWith(
      "session-build-older",
      "Apply the requested human changes.",
    );
    expect(updateCalls).toContainEqual({
      task: "task-1",
      session: "session-build-older",
      agent: "build",
      autostart: undefined,
      start: undefined,
    });

    await harness.unmount();
  });

  test("human changes feedback can continue into fresh session setup", async () => {
    const requestNewSessionStart = mock(async () => ({
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude-sonnet-4",
        variant: "thinking",
        profileId: "builder",
      },
    }));
    const startAgentSession = mock(async () => "session-build-human");
    const sendAgentMessage = mock(async () => {});
    const humanRequestChangesTask = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "spec",
      scenario: "spec_initial",
      requestNewSessionStart,
      startAgentSession,
      sendAgentMessage,
      humanRequestChangesTask,
      selectedTask: createTask({ status: "human_review" }),
      sessionsForTask: [
        createSession({
          sessionId: "session-build-latest",
          role: "build",
          scenario: "build_implementation_start",
          startedAt: "2026-02-22T12:00:00.000Z",
        }),
      ],
    });

    await harness.mount();
    await harness.run((state) => {
      state.handleCreateSession({
        id: "build:build_after_human_request_changes:fresh",
        role: "build",
        scenario: "build_after_human_request_changes",
        label: "Builder · Apply Human Changes",
        description: "Create a new builder session after human review",
        disabled: false,
      });
    });
    await harness.waitFor((state) => state.humanReviewFeedbackModal !== null);

    await harness.run((state) => {
      state.humanReviewFeedbackModal?.onTargetChange("new_session");
      state.humanReviewFeedbackModal?.onMessageChange("Use a fresh builder session.");
    });
    await harness.run(async (state) => {
      await state.humanReviewFeedbackModal?.onConfirm();
    });

    expect(requestNewSessionStart).toHaveBeenCalledWith({
      taskId: "task-1",
      role: "build",
      scenario: "build_after_human_request_changes",
      startMode: "fresh",
      reason: "create_session",
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        profileId: "spec",
      },
    });
    expect(startAgentSession).toHaveBeenCalledWith({
      taskId: "task-1",
      role: "build",
      scenario: "build_after_human_request_changes",
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude-sonnet-4",
        variant: "thinking",
        profileId: "builder",
      },
      sendKickoff: false,
      startMode: "fresh",
      requireModelReady: true,
      workingDirectoryOverride: "/repo/worktrees/task-1",
    });
    expect(humanRequestChangesTask).toHaveBeenCalledWith("task-1", "Use a fresh builder session.");
    expect(sendAgentMessage).toHaveBeenCalledWith(
      "session-build-human",
      "Use a fresh builder session.",
    );

    await harness.unmount();
  });
});
