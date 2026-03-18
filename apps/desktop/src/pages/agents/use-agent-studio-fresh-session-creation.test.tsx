import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
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

const createSetStartingActivityCount = (): Dispatch<SetStateAction<number>> => {
  let current = 0;
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
  updateQuery: () => {},
  setStartingActivityCount: createSetStartingActivityCount(),
  startingSessionByTaskRef: {
    current: new Map<string, Promise<string | undefined>>(),
  } satisfies MutableRefObject<Map<string, Promise<string | undefined>>>,
  resolveRequestedSelection: async () => null,
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
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toastErrorMock).toHaveBeenCalledWith("Failed to start Planner session", {
      description: "start failed",
    });

    await harness.unmount();
  });
});
