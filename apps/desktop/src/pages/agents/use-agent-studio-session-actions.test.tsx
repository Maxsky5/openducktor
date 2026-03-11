import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { host } from "@/state/operations/host";
import {
  createAgentSessionFixture,
  createDeferred,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { kickoffPromptForScenario } from "./agents-page-constants";
import { useAgentStudioSessionActions } from "./use-agent-studio-session-actions";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioSessionActions>[0];

const createTask = (overrides = {}) => createTaskCardFixture(overrides);

const createSession = (overrides = {}) => createAgentSessionFixture(overrides);

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioSessionActions, initialProps);

const createBaseArgs = (): HookArgs => {
  return {
    activeRepo: "/repo",
    taskId: "task-1",
    role: "spec",
    scenario: "spec_initial",
    activeSession: null,
    sessionsForTask: [],
    selectedTask: createTask(),
    agentStudioReady: true,
    isActiveTaskHydrated: true,
    selectionForNewSession: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "spec",
    },
    input: "  hello world  ",
    setInput: () => {},
    startAgentSession: async () => "session-new",
    sendAgentMessage: async () => {},
    updateAgentSessionModel: () => {},
    answerAgentQuestion: async () => {},
    updateQuery: () => {},
  };
};

describe("useAgentStudioSessionActions", () => {
  const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;
  const originalWorkspaceGetSettingsSnapshot = host.workspaceGetSettingsSnapshot;

  beforeEach(() => {
    host.workspaceGetRepoConfig = async () =>
      ({
        promptOverrides: {},
      }) as Awaited<ReturnType<typeof host.workspaceGetRepoConfig>>;
    host.workspaceGetSettingsSnapshot = async () => ({
      git: {
        defaultMergeMethod: "merge_commit",
      },
      repos: {},
      globalPromptOverrides: {},
    });
  });

  afterEach(() => {
    host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
    host.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
  });

  test("onSend starts session and sends trimmed message", async () => {
    const startAgentSession = mock(async () => "session-new");
    const sendAgentMessage = mock(async () => {});
    const updateAgentSessionModel = mock(() => {});
    const setInput = mock(() => {});
    const updateCalls: Array<Record<string, string | undefined>> = [];

    const harness = createHookHarness({
      ...createBaseArgs(),
      startAgentSession,
      sendAgentMessage,
      updateAgentSessionModel,
      setInput,
      updateQuery: (updates) => {
        updateCalls.push(updates);
      },
    });

    await harness.mount();
    await harness.run(async (state) => {
      await state.onSend();
    });

    expect(startAgentSession).toHaveBeenCalledWith({
      taskId: "task-1",
      role: "spec",
      scenario: "spec_initial",
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        profileId: "spec",
      },
      sendKickoff: false,
      startMode: "reuse_latest",
      requireModelReady: true,
    });
    expect(updateAgentSessionModel).toHaveBeenCalledWith("session-new", {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "spec",
    });
    expect(setInput).toHaveBeenCalledWith("");
    expect(sendAgentMessage).toHaveBeenCalledWith("session-new", "hello world");
    expect(updateCalls.some((entry) => entry.session === "session-new")).toBe(true);

    await harness.unmount();
  });

  test("onSend reuses active session when one exists", async () => {
    const sendAgentMessage = mock(async () => {});
    const startAgentSession = mock(async () => "session-new");

    const harness = createHookHarness({
      ...createBaseArgs(),
      activeSession: createSession({ sessionId: "session-existing" }),
      sendAgentMessage,
      startAgentSession,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await state.onSend();
    });

    expect(startAgentSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).toHaveBeenCalledWith("session-existing", "hello world");

    await harness.unmount();
  });

  test("onSend clears composer input immediately before send settles", async () => {
    const sendDeferred = createDeferred<void>();
    const sendAgentMessage = mock(() => sendDeferred.promise);
    const setInput = mock(() => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      activeSession: createSession({ sessionId: "session-existing" }),
      sendAgentMessage,
      setInput,
    });

    await harness.mount();
    let sendPromise: Promise<void> | undefined;
    await harness.run(async (state) => {
      sendPromise = state.onSend();
      expect(setInput).toHaveBeenCalledWith("");
      expect(sendAgentMessage).toHaveBeenCalledWith("session-existing", "hello world");
    });

    sendDeferred.resolve();
    await sendPromise;
    await harness.unmount();
  });

  test("onSend requests model selection before creating a new session", async () => {
    const requestedSelection = {
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "claude-sonnet-4",
      variant: "thinking",
      profileId: "spec",
    } as const;
    const requestNewSessionStart = mock(async () => ({ selectedModel: requestedSelection }));
    const startAgentSession = mock(async () => "session-new");
    const sendAgentMessage = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      requestNewSessionStart,
      startAgentSession,
      sendAgentMessage,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await state.onSend();
    });

    expect(requestNewSessionStart).toHaveBeenCalledWith({
      taskId: "task-1",
      role: "spec",
      scenario: "spec_initial",
      startMode: "reuse_latest",
      reason: "composer_send",
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
      role: "spec",
      scenario: "spec_initial",
      selectedModel: requestedSelection,
      sendKickoff: false,
      startMode: "reuse_latest",
      requireModelReady: true,
    });
    expect(sendAgentMessage).toHaveBeenCalledWith("session-new", "hello world");

    await harness.unmount();
  });

  test("onSend aborts when session creation request is cancelled", async () => {
    const requestNewSessionStart = mock(async () => null);
    const startAgentSession = mock(async () => "session-new");
    const sendAgentMessage = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      requestNewSessionStart,
      startAgentSession,
      sendAgentMessage,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await state.onSend();
    });

    expect(requestNewSessionStart).toHaveBeenCalledTimes(1);
    expect(startAgentSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("onSend reuses active session when available", async () => {
    const sendAgentMessage = mock(async () => {});
    const updateCalls: Array<Record<string, string | undefined>> = [];
    const existingSpecSession = createSession({
      runtimeKind: "opencode",
      sessionId: "session-existing",
      role: "spec",
      scenario: "spec_initial",
    });

    const harness = createHookHarness({
      ...createBaseArgs(),
      activeSession: existingSpecSession,
      sessionsForTask: [existingSpecSession],
      sendAgentMessage,
      updateQuery: (updates) => {
        updateCalls.push(updates);
      },
    });

    await harness.mount();
    await harness.run(async (state) => {
      await state.onSend();
    });

    expect(sendAgentMessage).toHaveBeenCalledWith("session-existing", "hello world");

    await harness.unmount();
  });

  test("session selection and workflow selection update URL query", async () => {
    const updateCalls: Array<Record<string, string | undefined>> = [];
    const sessionTwo = createSession({ sessionId: "session-2", taskId: "task-2" });

    const harness = createHookHarness({
      ...createBaseArgs(),
      sessionsForTask: [sessionTwo],
      taskId: "task-2",
      updateQuery: (updates) => {
        updateCalls.push(updates);
      },
    });

    await harness.mount();
    await harness.run((state) => {
      state.handleSessionSelectionChange("session-2");
      state.handleWorkflowStepSelect("spec", "session-2");
    });

    expect(updateCalls).toContainEqual({
      task: "task-2",
      session: "session-2",
      agent: "spec",
      autostart: undefined,
    });

    await harness.unmount();
  });

  test("workflow selection without existing session switches role context", async () => {
    const updateCalls: Array<Record<string, string | undefined>> = [];

    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "spec",
      scenario: "spec_initial",
      sessionsForTask: [],
      updateQuery: (updates) => {
        updateCalls.push(updates);
      },
    });

    await harness.mount();
    await harness.run((state) => {
      state.handleWorkflowStepSelect("planner", null);
    });

    expect(updateCalls).toContainEqual({
      task: "task-1",
      session: undefined,
      agent: "planner",
      autostart: undefined,
    });

    await harness.unmount();
  });

  test("submits question answers when session is active", async () => {
    const answerAgentQuestion = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      activeSession: createSession({ sessionId: "session-9" }),
      answerAgentQuestion,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await state.onSubmitQuestionAnswers("req-1", [["yes"]]);
    });

    expect(answerAgentQuestion).toHaveBeenCalledWith("session-9", "req-1", [["yes"]]);

    await harness.unmount();
  });

  test("handleCreateSession updates query immediately, then targets created session", async () => {
    const deferredStart = createDeferred<string>();
    const startAgentSession = mock(async () => deferredStart.promise);
    const sendAgentMessage = mock(async () => {});
    const updateCalls: Array<Record<string, string | undefined>> = [];

    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "spec",
      scenario: "spec_initial",
      activeSession: createSession({ sessionId: "session-spec", role: "spec" }),
      selectedTask: createTask({
        agentWorkflows: {
          spec: { required: true, canSkip: false, available: true, completed: true },
          planner: { required: true, canSkip: false, available: true, completed: false },
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

    try {
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

      expect(updateCalls[0]).toEqual({
        task: "task-1",
        session: undefined,
        agent: "planner",
        autostart: undefined,
        start: undefined,
      });
      expect(startAgentSession).toHaveBeenCalledWith({
        taskId: "task-1",
        role: "planner",
        scenario: "planner_initial",
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
      });

      await harness.run(async () => {
        deferredStart.resolve("session-plan");
        await deferredStart.promise;
      });

      expect(updateCalls).toContainEqual({
        task: "task-1",
        session: "session-plan",
        agent: "planner",
        autostart: undefined,
        start: undefined,
      });
      expect(sendAgentMessage).toHaveBeenCalledWith(
        "session-plan",
        kickoffPromptForScenario("planner", "planner_initial", "task-1"),
      );
    } finally {
      deferredStart.resolve("session-plan");
      await harness.unmount();
    }
  });

  test("handleCreateSession sets fresh-start query when creating another session for same role", async () => {
    const deferredStart = createDeferred<string>();
    const startAgentSession = mock(async () => deferredStart.promise);
    const sendAgentMessage = mock(async () => {});
    const updateCalls: Array<Record<string, string | undefined>> = [];

    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "spec",
      scenario: "spec_initial",
      activeSession: createSession({ sessionId: "session-spec", role: "spec" }),
      selectedTask: createTask(),
      startAgentSession,
      sendAgentMessage,
      updateQuery: (updates) => {
        updateCalls.push(updates);
      },
    });

    try {
      await harness.mount();
      await harness.run((state) => {
        state.handleCreateSession({
          id: "spec:spec_initial:fresh",
          role: "spec",
          scenario: "spec_initial",
          label: "Spec · Start Spec",
          description: "Create a new spec session from scratch",
          disabled: false,
        });
      });

      expect(updateCalls[0]).toEqual({
        task: "task-1",
        session: undefined,
        agent: "spec",
        autostart: undefined,
        start: undefined,
      });
    } finally {
      deferredStart.resolve("session-spec-fresh");
      await harness.unmount();
    }
  });

  test("handleCreateSession requests model selection with create_session reason", async () => {
    const requestNewSessionStart = mock(async () => ({
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude-sonnet-4",
        variant: "thinking",
        profileId: "planner",
      },
    }));
    const startAgentSession = mock(async () => "session-plan");
    const sendAgentMessage = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "spec",
      scenario: "spec_initial",
      activeSession: createSession({ sessionId: "session-spec", role: "spec" }),
      selectedTask: createTask({
        agentWorkflows: {
          spec: { required: true, canSkip: false, available: true, completed: true },
          planner: { required: true, canSkip: false, available: true, completed: false },
          builder: { required: true, canSkip: false, available: true, completed: false },
          qa: { required: true, canSkip: false, available: false, completed: false },
        },
      }),
      requestNewSessionStart,
      startAgentSession,
      sendAgentMessage,
      updateQuery: () => {},
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
      await Promise.resolve();
    });

    expect(requestNewSessionStart).toHaveBeenCalledWith({
      taskId: "task-1",
      role: "planner",
      scenario: "planner_initial",
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
    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "planner",
        scenario: "planner_initial",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "anthropic",
          modelId: "claude-sonnet-4",
          variant: "thinking",
          profileId: "planner",
        },
      }),
    );

    await harness.unmount();
  });

  test("handleCreateSession aborts when create-session request is cancelled", async () => {
    const requestNewSessionStart = mock(async () => null);
    const startAgentSession = mock(async () => "session-plan");
    const sendAgentMessage = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "spec",
      scenario: "spec_initial",
      activeSession: createSession({ sessionId: "session-spec", role: "spec" }),
      selectedTask: createTask({
        agentWorkflows: {
          spec: { required: true, canSkip: false, available: true, completed: true },
          planner: { required: true, canSkip: false, available: true, completed: false },
          builder: { required: true, canSkip: false, available: true, completed: false },
          qa: { required: true, canSkip: false, available: false, completed: false },
        },
      }),
      requestNewSessionStart,
      startAgentSession,
      sendAgentMessage,
      updateQuery: () => {},
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
      await Promise.resolve();
    });

    expect(requestNewSessionStart).toHaveBeenCalledTimes(1);
    expect(startAgentSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("handleCreateSession restores previous query selection on start failure", async () => {
    const deferredStart = createDeferred<string>();
    const startAgentSession = mock(async () => deferredStart.promise);
    const sendAgentMessage = mock(async () => {});
    const updateCalls: Array<Record<string, string | undefined>> = [];

    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "spec",
      scenario: "spec_initial",
      activeSession: createSession({ sessionId: "session-spec", role: "spec" }),
      selectedTask: createTask({
        agentWorkflows: {
          spec: { required: true, canSkip: false, available: true, completed: true },
          planner: { required: true, canSkip: false, available: true, completed: false },
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

    try {
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

      await harness.run(async () => {
        deferredStart.reject(new Error("start failed"));
        await Promise.resolve();
      });

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
    } finally {
      deferredStart.resolve("session-plan");
      await harness.unmount();
    }
  });

  test("handleCreateSession stops loading once session is created even if kickoff is still running", async () => {
    const deferredStart = createDeferred<string>();
    const deferredKickoff = createDeferred<void>();
    const startAgentSession = mock(async () => deferredStart.promise);
    const sendAgentMessage = mock(async () => deferredKickoff.promise);

    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "spec",
      scenario: "spec_initial",
      activeSession: createSession({ sessionId: "session-spec", role: "spec" }),
      selectedTask: createTask({
        agentWorkflows: {
          spec: { required: true, canSkip: false, available: true, completed: true },
          planner: { required: true, canSkip: false, available: true, completed: false },
          builder: { required: true, canSkip: false, available: true, completed: false },
          qa: { required: true, canSkip: false, available: false, completed: false },
        },
      }),
      startAgentSession,
      sendAgentMessage,
      updateQuery: () => {},
    });

    try {
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

      expect(harness.getLatest().isStarting).toBe(true);

      await harness.run(async () => {
        deferredStart.resolve("session-plan");
        await deferredStart.promise;
      });

      expect(sendAgentMessage).toHaveBeenCalledWith(
        "session-plan",
        kickoffPromptForScenario("planner", "planner_initial", "task-1"),
      );
      expect(harness.getLatest().isStarting).toBe(false);

      deferredKickoff.resolve();
      await Promise.resolve();
    } finally {
      deferredStart.resolve("session-plan");
      deferredKickoff.resolve();
      await harness.unmount();
    }
  });

  test("startScenarioKickoff requests session selection with kickoff reason", async () => {
    const requestNewSessionStart = mock(async () => ({
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        profileId: "spec",
      },
    }));
    const startAgentSession = mock(async () => "session-spec");
    const sendAgentMessage = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      requestNewSessionStart,
      startAgentSession,
      sendAgentMessage,
      input: "",
    });

    await harness.mount();
    await harness.run(async (state) => {
      await state.startScenarioKickoff();
    });

    expect(requestNewSessionStart).toHaveBeenCalledWith({
      taskId: "task-1",
      role: "spec",
      scenario: "spec_initial",
      startMode: "reuse_latest",
      reason: "scenario_kickoff",
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        profileId: "spec",
      },
    });
    expect(sendAgentMessage).toHaveBeenCalledWith(
      "session-spec",
      kickoffPromptForScenario("spec", "spec_initial", "task-1"),
    );

    await harness.unmount();
  });

  test("does not expose kickoff for internal rebase conflict scenario", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "build",
      scenario: "build_rebase_conflict_resolution",
      selectedTask: createTask(),
      activeSession: null,
      sessionsForTask: [],
    });

    await harness.mount();

    expect(harness.getLatest().canKickoffNewSession).toBe(false);

    await harness.unmount();
  });
});
