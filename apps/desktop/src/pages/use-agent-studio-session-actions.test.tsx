import { describe, expect, mock, test } from "bun:test";
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
    autostart: false,
    sessionStartPreference: null,
    activeSession: null,
    sessionsForTask: [],
    selectedTask: createTask(),
    agentStudioReady: true,
    isActiveTaskHydrated: true,
    selectionForNewSession: {
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      opencodeAgent: "spec",
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
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        opencodeAgent: "spec",
      },
      sendKickoff: false,
      startMode: "reuse_latest",
      requireModelReady: true,
    });
    expect(updateAgentSessionModel).toHaveBeenCalledWith("session-new", {
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      opencodeAgent: "spec",
    });
    expect(setInput).toHaveBeenCalledWith("");
    expect(sendAgentMessage).toHaveBeenCalledWith("session-new", "hello world");
    expect(updateCalls.some((entry) => entry.session === "session-new")).toBe(true);

    await harness.unmount();
  });

  test("onSend uses fresh start mode when fresh preference is selected", async () => {
    const startAgentSession = mock(async () => "session-fresh");
    const sendAgentMessage = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      sessionStartPreference: "fresh",
      startAgentSession,
      sendAgentMessage,
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
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        opencodeAgent: "spec",
      },
      sendKickoff: false,
      startMode: "fresh",
      requireModelReady: true,
    });
    expect(sendAgentMessage).toHaveBeenCalledWith("session-fresh", "hello world");

    await harness.unmount();
  });

  test("onSend ignores active session when fresh preference is selected", async () => {
    const startAgentSession = mock(async () => "session-fresh");
    const sendAgentMessage = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      sessionStartPreference: "fresh",
      activeSession: createSession({ sessionId: "session-existing" }),
      startAgentSession,
      sendAgentMessage,
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
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        opencodeAgent: "spec",
      },
      sendKickoff: false,
      startMode: "fresh",
      requireModelReady: true,
    });
    expect(sendAgentMessage).toHaveBeenCalledWith("session-fresh", "hello world");

    await harness.unmount();
  });

  test("onSend with continue preference reuses latest role session from session list", async () => {
    const startAgentSession = mock(async () => "session-new");
    const sendAgentMessage = mock(async () => {});
    const updateCalls: Array<Record<string, string | undefined>> = [];
    const existingSpecSession = createSession({
      sessionId: "session-existing",
      role: "spec",
      scenario: "spec_initial",
    });

    const harness = createHookHarness({
      ...createBaseArgs(),
      sessionStartPreference: "continue",
      sessionsForTask: [existingSpecSession],
      startAgentSession,
      sendAgentMessage,
      updateQuery: (updates) => {
        updateCalls.push(updates);
      },
    });

    await harness.mount();
    await harness.run(async (state) => {
      await state.onSend();
    });

    expect(startAgentSession).not.toHaveBeenCalled();
    expect(updateCalls).toContainEqual({
      task: "task-1",
      session: "session-existing",
      agent: "spec",
      scenario: "spec_initial",
      autostart: undefined,
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
      scenario: "spec_initial",
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
      scenario: "planner_initial",
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
        scenario: "planner_initial",
        autostart: undefined,
      });
      expect(startAgentSession).toHaveBeenCalledWith({
        taskId: "task-1",
        role: "planner",
        scenario: "planner_initial",
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
        scenario: "planner_initial",
        autostart: undefined,
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
        scenario: "planner_initial",
        autostart: undefined,
      });
      expect(updateCalls).toContainEqual({
        task: "task-1",
        session: "session-spec",
        agent: "spec",
        scenario: "spec_initial",
        autostart: undefined,
      });
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

  test("marks autostart flow as initializing before task hydration completes", async () => {
    const startAgentSession = mock(async () => "session-plan");

    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "planner",
      scenario: "planner_initial",
      autostart: true,
      isActiveTaskHydrated: false,
      activeSession: null,
      startAgentSession,
    });

    await harness.mount();

    expect(harness.getLatest().isStarting).toBe(true);
    expect(startAgentSession).not.toHaveBeenCalled();

    await harness.unmount();
  });
});
