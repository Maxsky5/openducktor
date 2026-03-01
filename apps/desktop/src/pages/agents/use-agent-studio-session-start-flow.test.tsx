import { describe, expect, mock, test } from "bun:test";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioSessionStartFlow as useSessionStartFlow } from "./use-agent-studio-session-start-flow";

enableReactActEnvironment();

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
    providerId: "openai",
    modelId: "gpt-5",
    variant: "default",
    opencodeAgent: "spec",
  },
  startAgentSession: async () => "session-new",
  sendAgentMessage: async () => {},
  updateAgentSessionModel: () => {},
  updateQuery: () => {},
});

describe("useAgentStudioSessionStartFlow", () => {
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
      scenario: undefined,
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
      scenario: undefined,
      autostart: undefined,
      start: undefined,
    });
    expect(updateCalls).toHaveLength(2);
    expect(sendAgentMessage).not.toHaveBeenCalled();

    await harness.unmount();
  });
});
