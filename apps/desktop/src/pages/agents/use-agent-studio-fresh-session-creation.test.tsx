import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";

enableReactActEnvironment();

const toastErrorMock = mock(() => {});

mock.module("sonner", () => ({
  toast: {
    error: toastErrorMock,
  },
}));

type UseAgentStudioFreshSessionCreationHook =
  typeof import("./use-agent-studio-fresh-session-creation")["useAgentStudioFreshSessionCreation"];

let useAgentStudioFreshSessionCreation: UseAgentStudioFreshSessionCreationHook;

type HookArgs = Parameters<UseAgentStudioFreshSessionCreationHook>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioFreshSessionCreation, initialProps);

const createSetStartingActivityCountByContext = (): Dispatch<
  SetStateAction<Record<string, number>>
> => {
  let current: Record<string, number> = {};
  return (update) => {
    current = typeof update === "function" ? update(current) : update;
  };
};

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeRepo: "/repo",
  taskId: "task-1",
  role: "spec",
  activeSession: null,
  selectedTask: createTaskCardFixture(),
  agentStudioReady: true,
  isActiveTaskHydrated: true,
  isSessionWorking: false,
  startAgentSession: async () => "session-new",
  sendAgentMessage: async () => {},
  updateAgentSessionModel: () => {},
  updateQuery: () => {},
  setStartingActivityCountByContext: createSetStartingActivityCountByContext(),
  startingSessionByTaskRef: {
    current: new Map<string, Promise<string | undefined>>(),
  } satisfies MutableRefObject<Map<string, Promise<string | undefined>>>,
  resolveRequestedDecision: async () => ({
    selectedModel: null,
    startMode: "fresh",
    reuseSessionId: null,
  }),
  ...overrides,
});

beforeAll(async () => {
  ({ useAgentStudioFreshSessionCreation } = await import(
    "./use-agent-studio-fresh-session-creation"
  ));
});

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  toastErrorMock.mockClear();
});

describe("useAgentStudioFreshSessionCreation", () => {
  test("uses the requested role label in the failure toast", async () => {
    const startAgentSession = mock(async () => {
      throw new Error("start failed");
    });
    const harness = createHookHarness(
      createBaseArgs({
        startAgentSession,
      }),
    );

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
    await harness.waitFor(() => toastErrorMock.mock.calls.length > 0);

    expect(toastErrorMock).toHaveBeenCalledWith("Failed to start Planner session", {
      description: "start failed",
    });

    await harness.unmount();
  });

  test("passes builder context when creating a fresh qa session", async () => {
    const startAgentSession = mock(async () => "session-qa");
    const harness = createHookHarness(
      createBaseArgs({
        selectedTask: createTaskCardFixture({
          status: "human_review",
          agentWorkflows: {
            spec: { required: false, canSkip: true, available: true, completed: true },
            planner: { required: false, canSkip: true, available: true, completed: true },
            builder: { required: true, canSkip: false, available: true, completed: true },
            qa: { required: true, canSkip: false, available: true, completed: false },
          },
        }),
        sessionsForTask: [
          createAgentSessionFixture({
            sessionId: "builder-1",
            role: "build",
            scenario: "build_implementation_start",
            workingDirectory: "/repo/worktrees/task-1",
            startedAt: "2026-02-22T09:00:00.000Z",
          }),
        ],
        startAgentSession,
      }),
    );

    await harness.mount();
    await harness.run((state) => {
      state.handleCreateSession({
        id: "qa:qa_review:fresh",
        role: "qa",
        scenario: "qa_review",
        label: "QA · Start QA",
        description: "Create a new QA session",
        disabled: false,
      });
    });
    await harness.waitFor(() => startAgentSession.mock.calls.length > 0);

    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "qa",
        scenario: "qa_review",
        builderContext: {
          sessionId: "builder-1",
          workingDirectory: "/repo/worktrees/task-1",
        },
      }),
    );

    await harness.unmount();
  });
});
