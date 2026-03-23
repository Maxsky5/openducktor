import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
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

type UseAgentStudioSessionStartFlowHook =
  typeof import("./use-agent-studio-session-start-flow")["useAgentStudioSessionStartFlow"];

let useAgentStudioSessionStartFlow: UseAgentStudioSessionStartFlowHook;

type HookArgs = Parameters<UseAgentStudioSessionStartFlowHook>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioSessionStartFlow, initialProps);

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeRepo: null,
  taskId: "task-1",
  role: "spec",
  scenario: "spec_initial",
  activeSession: null,
  sessionsForTask: [],
  selectedTask: createTaskCardFixture(),
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
  ...overrides,
});

beforeAll(async () => {
  ({ useAgentStudioSessionStartFlow } = await import("./use-agent-studio-session-start-flow"));
});

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  toastErrorMock.mockClear();
});

describe("useAgentStudioSessionStartFlow kickoff failures", () => {
  test("keeps the started session and shows a toast when kickoff send fails", async () => {
    const startAgentSession = mock(async () => "session-new");
    const sendAgentMessage = mock(async () => {
      throw new Error("kickoff failed");
    });
    const harness = createHookHarness(
      createBaseArgs({
        startAgentSession,
        sendAgentMessage,
      }),
    );

    await harness.mount();
    await harness.run(async (state) => {
      await state.startScenarioKickoff();
    });

    expect(startAgentSession).toHaveBeenCalledTimes(1);
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Session started, but the kickoff prompt failed to send.",
      {
        description: "kickoff failed",
      },
    );

    await harness.unmount();
  });
});
