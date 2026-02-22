import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { TaskCard } from "@openducktor/contracts";
import { type ReactElement, createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { kickoffPromptForScenario } from "./agents-page-constants";
import { useAgentStudioSessionActions } from "./use-agent-studio-session-actions";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

type HookArgs = Parameters<typeof useAgentStudioSessionActions>[0];
type HookState = ReturnType<typeof useAgentStudioSessionActions>;

const createTask = (overrides: Partial<TaskCard> = {}): TaskCard => ({
  id: "task-1",
  title: "Task 1",
  description: "",
  acceptanceCriteria: "",
  notes: "",
  status: "open",
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  parentId: undefined,
  subtaskIds: [],
  assignee: undefined,
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false },
  },
  updatedAt: "2026-02-22T12:00:00.000Z",
  createdAt: "2026-02-22T12:00:00.000Z",
  ...overrides,
});

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "spec",
  scenario: "spec_initial",
  status: "idle",
  startedAt: "2026-02-22T10:00:00.000Z",
  runtimeId: null,
  runId: null,
  baseUrl: "http://localhost:4000",
  workingDirectory: "/repo",
  messages: [],
  draftAssistantText: "",
  pendingPermissions: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
  ...overrides,
});

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const createDeferred = <T,>() => {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  let reject: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve: (value: T) => resolve?.(value),
    reject: (reason?: unknown) => reject?.(reason),
  };
};

const createHookHarness = (initialProps: HookArgs) => {
  let latest: HookState | null = null;
  const currentProps = initialProps;

  const Harness = (props: HookArgs): ReactElement | null => {
    latest = useAgentStudioSessionActions(props);
    return null;
  };

  let renderer: TestRenderer.ReactTestRenderer | null = null;

  const mount = async (): Promise<void> => {
    await act(async () => {
      renderer = TestRenderer.create(createElement(Harness, currentProps));
      await flush();
    });
  };

  const run = async (fn: (state: HookState) => void | Promise<void>): Promise<void> => {
    await act(async () => {
      if (!latest) {
        throw new Error("Hook state unavailable");
      }
      await fn(latest);
      await flush();
    });
  };

  const getLatest = (): HookState => {
    if (!latest) {
      throw new Error("Hook state unavailable");
    }
    return latest;
  };

  const unmount = async (): Promise<void> => {
    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  };

  return { mount, run, getLatest, unmount };
};

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
      sendKickoff: false,
      startMode: "reuse_latest",
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
      sendKickoff: false,
      startMode: "fresh",
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
      sendKickoff: false,
      startMode: "fresh",
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
      selectedTask: createTask({ availableActions: ["set_plan"] }),
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
      selectedTask: createTask({ availableActions: ["set_plan"] }),
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
      selectedTask: createTask({ availableActions: ["set_plan"] }),
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
