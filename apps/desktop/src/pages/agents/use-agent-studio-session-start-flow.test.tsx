import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { clearAppQueryClient } from "@/lib/query-client";
import { host } from "@/state/operations/host";
import {
  createAgentSessionFixture,
  createDeferred,
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
  bootstrapTaskSessions: async () => {},
  hydrateRequestedTaskSessionHistory: async () => {},
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

  test("startSession starts a fresh session even when another session is active", async () => {
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
      expect(sessionId).toBe("session-new");
    });

    expect(updateCalls).toContainEqual({
      task: "task-1",
      session: "session-new",
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
      scenario: undefined,
      autostart: undefined,
      start: undefined,
    });
    expect(updateCalls).toContainEqual({
      task: "task-1",
      session: "session-spec",
      agent: "spec",
      scenario: "spec_initial",
      autostart: undefined,
      start: undefined,
    });
    expect(updateCalls).toHaveLength(2);
    expect(sendAgentMessage).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("resets transient starting state when switching task context", async () => {
    const selectionDeferred = createDeferred<{
      startMode: "fresh";
      sourceSessionId: null;
      selectedModel: HookArgs["selectionForNewSession"];
    } | null>();
    const requestNewSessionStart = mock(() => selectionDeferred.promise);

    const harness = createHookHarness({
      ...createBaseArgs(),
      requestNewSessionStart,
    });

    await harness.mount();

    let startPromise: Promise<string | undefined> | undefined;
    await harness.run((state) => {
      startPromise = state.startSession("composer_send");
    });

    await harness.waitFor((state) => state.isStarting);

    await harness.update({
      ...createBaseArgs(),
      taskId: "task-2",
      requestNewSessionStart,
    });

    expect(harness.getLatest().isStarting).toBe(false);

    await harness.run(async () => {
      selectionDeferred.resolve(null);
      await startPromise;
    });
    await harness.unmount();
  });

  test("restores starting state when returning to the original task context", async () => {
    const selectionDeferred = createDeferred<{
      startMode: "fresh";
      sourceSessionId: null;
      selectedModel: HookArgs["selectionForNewSession"];
    } | null>();
    const requestNewSessionStart = mock(() => selectionDeferred.promise);
    const startAgentSession = mock(async () => "session-new");

    const harness = createHookHarness({
      ...createBaseArgs(),
      requestNewSessionStart,
      startAgentSession,
    });

    await harness.mount();

    let firstStartPromise: Promise<string | undefined> | undefined;
    await harness.run((state) => {
      firstStartPromise = state.startSession("composer_send");
    });

    await harness.waitFor((state) => state.isStarting);

    await harness.update({
      ...createBaseArgs(),
      taskId: "task-2",
      requestNewSessionStart,
      startAgentSession,
    });
    expect(harness.getLatest().isStarting).toBe(false);

    await harness.update({
      ...createBaseArgs(),
      requestNewSessionStart,
      startAgentSession,
    });
    expect(harness.getLatest().isStarting).toBe(true);

    let resumedStartPromise: Promise<string | undefined> | undefined;
    await harness.run((state) => {
      resumedStartPromise = state.startSession("composer_send");
    });

    expect(requestNewSessionStart).toHaveBeenCalledTimes(1);
    expect(harness.getLatest().isStarting).toBe(true);

    await harness.run(async () => {
      selectionDeferred.resolve(null);
      await firstStartPromise;
      await resumedStartPromise;
    });
    expect(startAgentSession).toHaveBeenCalledTimes(0);
    await harness.waitFor((state) => !state.isStarting);
    await harness.unmount();
  });

  test("keeps starting state while fresh session creation switches to the draft role", async () => {
    const startDeferred = createDeferred<string>();
    const startAgentSession = mock(() => startDeferred.promise);
    const sendAgentMessage = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      startAgentSession,
      sendAgentMessage,
    });

    await harness.mount();

    await harness.run((state) => {
      state.handleCreateSession({
        id: "planner:planner_initial:fresh",
        role: "planner",
        scenario: "planner_initial",
        label: "Planner · New Session",
        description: "Create a fresh planner session",
        disabled: false,
      });
    });

    await harness.update({
      ...createBaseArgs(),
      role: "planner",
      scenario: "planner_initial",
      startAgentSession,
      sendAgentMessage,
      activeSession: null,
    });

    await harness.waitFor((state) => state.isStarting);
    expect(harness.getLatest().isStarting).toBe(true);

    await harness.run(async () => {
      startDeferred.resolve("session-planner");
      await Promise.resolve();
      await Promise.resolve();
    });
    await harness.waitFor((state) => !state.isStarting);
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
    await harness.run(async (state) => {
      state.handleCreateSession({
        id: "build:build_after_qa_rejected:fresh",
        role: "build",
        scenario: "build_after_qa_rejected",
        label: "Builder · Fix QA Rejection",
        description: "Create a new builder session in the existing worktree",
        disabled: false,
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    await harness.waitFor(() => startAgentSession.mock.calls.length > 0);
    await harness.waitFor(() => sendAgentMessage.mock.calls.length > 0);

    expect(startAgentSession).toHaveBeenCalledWith({
      taskId: "task-1",
      role: "build",
      scenario: "build_after_qa_rejected",
      selectedModel: null,
      sendKickoff: false,
      startMode: "fresh" as const,
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
      scenario: "build_after_qa_rejected",
      autostart: undefined,
      start: undefined,
    });

    await harness.unmount();
  });

  test("tracks parallel fresh-session starts per visible draft role", async () => {
    const plannerStart = createDeferred<string>();
    const buildStart = createDeferred<string>();
    const startAgentSession = mock(async (params: { role: string }) =>
      params.role === "planner" ? plannerStart.promise : buildStart.promise,
    );
    const sendAgentMessage = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      startAgentSession,
      sendAgentMessage,
    });

    await harness.mount();
    await harness.run(async (state) => {
      state.handleCreateSession({
        id: "planner:planner_initial:fresh",
        role: "planner",
        scenario: "planner_initial",
        label: "Planner · Start Planner",
        description: "Create a new planner session from scratch",
        disabled: false,
      });
      state.handleCreateSession({
        id: "build:build_implementation_start:fresh",
        role: "build",
        scenario: "build_implementation_start",
        label: "Builder · Start Builder",
        description: "Create a new builder session from scratch",
        disabled: false,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(startAgentSession).toHaveBeenCalledTimes(2);
    expect(harness.getLatest().isStarting).toBe(false);

    await harness.update({
      ...createBaseArgs(),
      role: "planner",
      scenario: "planner_initial",
      activeSession: null,
      startAgentSession,
      sendAgentMessage,
    });
    expect(harness.getLatest().isStarting).toBe(true);

    await harness.run(async () => {
      plannerStart.resolve("session-planner");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.getLatest().isStarting).toBe(false);

    await harness.update({
      ...createBaseArgs(),
      role: "build",
      scenario: "build_implementation_start",
      activeSession: null,
      startAgentSession,
      sendAgentMessage,
    });
    expect(harness.getLatest().isStarting).toBe(true);

    await harness.run(async () => {
      buildStart.resolve("session-build");
      await Promise.resolve();
      await Promise.resolve();
    });
    await harness.waitFor((state) => state.isStarting === false);

    expect(harness.getLatest().isStarting).toBe(false);

    await harness.unmount();
  });

  test("handleCreateSession for human changes opens the feedback modal before model selection", async () => {
    const requestNewSessionStart = mock(async () => ({
      startMode: "fresh" as const,
      sourceSessionId: null,
      selectedModel: null,
    }));
    const startAgentSession = mock(async () => "session-build-human");
    const bootstrapTaskSessions = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "spec",
      scenario: "spec_initial",
      requestNewSessionStart,
      startAgentSession,
      bootstrapTaskSessions,
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
    await harness.run(async (state) => {
      state.handleCreateSession({
        id: "build:build_after_human_request_changes:fresh",
        role: "build",
        scenario: "build_after_human_request_changes",
        label: "Builder · Apply Human Changes",
        description: "Create a new builder session after human review",
        disabled: false,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await harness.waitFor((state) => state.humanReviewFeedbackModal !== null);

    expect(bootstrapTaskSessions).toHaveBeenCalledWith("task-1");
    expect(harness.getLatest().humanReviewFeedbackModal?.open).toBe(true);
    expect(requestNewSessionStart).not.toHaveBeenCalled();
    expect(startAgentSession).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("startScenarioKickoff for human changes opens the feedback modal instead of starting immediately", async () => {
    const requestNewSessionStart = mock(async () => ({
      startMode: "fresh" as const,
      sourceSessionId: null,
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
    const bootstrapTaskSessions = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "build",
      scenario: "build_after_human_request_changes",
      requestNewSessionStart,
      startAgentSession,
      sendAgentMessage,
      bootstrapTaskSessions,
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

    expect(bootstrapTaskSessions).toHaveBeenCalledWith("task-1");
    expect(harness.getLatest().humanReviewFeedbackModal?.open).toBe(true);
    expect(startAgentSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("human changes feedback can target an existing builder session", async () => {
    const startAgentSession = mock(async () => "session-build-human");
    const sendAgentMessage = mock(async () => {});
    const humanRequestChangesTask = mock(async () => {});
    const bootstrapTaskSessions = mock(async () => {});
    const hydrateRequestedTaskSessionHistory = mock(async () => {});
    const updateCalls: Array<Record<string, string | undefined>> = [];

    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "spec",
      scenario: "spec_initial",
      startAgentSession,
      sendAgentMessage,
      humanRequestChangesTask,
      bootstrapTaskSessions,
      hydrateRequestedTaskSessionHistory,
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
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(humanRequestChangesTask).toHaveBeenCalledWith(
      "task-1",
      "Apply the requested human changes.",
    );
    expect(bootstrapTaskSessions).toHaveBeenCalledWith("task-1");
    expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledWith({
      taskId: "task-1",
      sessionId: "session-build-older",
    });
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
      startMode: "fresh" as const,
      sourceSessionId: null,
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
    await harness.waitFor(() => startAgentSession.mock.calls.length > 0);
    await harness.waitFor(() => sendAgentMessage.mock.calls.length > 0);

    expect(requestNewSessionStart).toHaveBeenCalledWith({
      taskId: "task-1",
      role: "build",
      scenario: "build_after_human_request_changes",
      reason: "create_session",
      existingSessionOptions: [
        {
          value: "session-build-latest",
          label: "Start Implementation · Builder #1",
          description: "2/22/2026, 12:00:00 PM · idle · session-",
          secondaryLabel: "Latest",
        },
      ],
      initialSourceSessionId: "session-build-latest",
      selectedModel: null,
    });
    const requestArg = (
      requestNewSessionStart.mock.calls as unknown as Array<[Record<string, unknown>]>
    ).at(0)?.[0];
    expect(requestArg).not.toHaveProperty("startMode");
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
      startMode: "fresh" as const,
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
