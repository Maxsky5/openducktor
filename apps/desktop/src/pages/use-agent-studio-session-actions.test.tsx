import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { TaskCard } from "@openducktor/contracts";
import { type ReactElement, createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
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

  const unmount = async (): Promise<void> => {
    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  };

  return { mount, run, unmount };
};

const createBaseArgs = (): HookArgs => {
  return {
    activeRepo: "/repo",
    taskId: "task-1",
    role: "spec",
    scenario: "spec_initial",
    autostart: false,
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
});
