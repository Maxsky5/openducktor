import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { host } from "@/state/operations/host";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";

enableReactActEnvironment();

const toastErrorMock = mock(() => {});

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

const MODEL_SELECTION = {
  runtimeKind: "opencode" as const,
  providerId: "openai",
  modelId: "gpt-5",
  variant: "default",
  profileId: "spec",
};

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeWorkspace: {
    repoPath: "/repo",
    workspaceId: "workspace-1",
    workspaceName: "Active Workspace",
  },
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
  setStartingActivityCountByContext: createSetStartingActivityCountByContext(),
  startingSessionByTaskRef: {
    current: new Map<string, Promise<string | undefined>>(),
  } satisfies MutableRefObject<Map<string, Promise<string | undefined>>>,
  executeRequestedSessionStart: async (_request, executeWithDecision) =>
    executeWithDecision({
      selectedModel: MODEL_SELECTION,
      startMode: "fresh",
    }),
  ...overrides,
});

beforeEach(async () => {
  mock.module("sonner", () => ({
    toast: {
      error: toastErrorMock,
      success: () => {},
      loading: () => "",
      dismiss: () => {},
    },
  }));
  ({ useAgentStudioFreshSessionCreation } = await import(
    "./use-agent-studio-fresh-session-creation"
  ));
});

afterEach(async () => {
  await restoreMockedModules([["sonner", () => import("sonner")]]);
});

const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;
const originalWorkspaceGetSettingsSnapshot = host.workspaceGetSettingsSnapshot;
const originalBuildContinuationTargetGet = host.taskWorktreeGet;

beforeEach(() => {
  toastErrorMock.mockClear();
  host.workspaceGetRepoConfig = async () =>
    ({
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
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
    kanban: {
      doneVisibleDays: 1,
      emptyColumnDisplay: "show",
    },
    autopilot: {
      rules: [],
    },
    workspaces: {},
    globalPromptOverrides: {},
  });
  host.taskWorktreeGet = async () => ({
    workingDirectory: "/repo/worktrees/task-1",
    source: "builder_session",
  });
});

afterEach(() => {
  host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
  host.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
  host.taskWorktreeGet = originalBuildContinuationTargetGet;
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

  test("shows a single role-specific toast when fresh session start fails", async () => {
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

    await harness.waitFor(() => startAgentSession.mock.calls.length > 0);
    await harness.waitFor(() => toastErrorMock.mock.calls.length > 0);
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith("Failed to start Planner session", {
      description: "start failed",
    });

    await harness.unmount();
  });

  test("uses host continuation target for fresh QA builder context", async () => {
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
        startMode: "fresh",
      }),
    );

    await harness.unmount();
  });

  test("reuses an existing session without starting a fresh one", async () => {
    const startAgentSession = mock(
      async (input: { startMode: string; sourceSessionId?: string }) =>
        input.startMode === "reuse" ? (input.sourceSessionId ?? "session-existing") : "session-new",
    );
    const sendAgentMessage = mock(async () => {});
    const onContextSwitchIntent = mock(() => {});
    const harness = createHookHarness(
      createBaseArgs({
        role: "build",
        activeSession: createAgentSessionFixture({
          sessionId: "active-build",
          role: "build",
          scenario: "build_implementation_start",
          taskId: "task-1",
        }),
        startAgentSession,
        sendAgentMessage,
        onContextSwitchIntent,
        executeRequestedSessionStart: async (_request, executeWithDecision) =>
          executeWithDecision({
            startMode: "reuse",
            sourceSessionId: "session-existing",
          }),
      }),
    );

    await harness.mount();
    await harness.run((state) => {
      state.handleCreateSession({
        id: "build:build_implementation_start:reuse",
        role: "build",
        scenario: "build_implementation_start",
        label: "Builder · Continue",
        description: "Reuse latest builder session",
        disabled: false,
      });
    });
    await harness.waitFor(() => sendAgentMessage.mock.calls.length > 0);

    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        startMode: "reuse",
        sourceSessionId: "session-existing",
      }),
    );
    expect(sendAgentMessage).toHaveBeenCalledWith("session-existing", [
      expect.objectContaining({ kind: "text", text: expect.stringContaining("task-1") }),
    ]);
    expect(onContextSwitchIntent).toHaveBeenCalledTimes(1);

    await harness.unmount();
  });

  test("does not switch context when reuse start fails", async () => {
    const startAgentSession = mock(async () => {
      throw new Error("start failed");
    });
    const onContextSwitchIntent = mock(() => {});
    const harness = createHookHarness(
      createBaseArgs({
        role: "build",
        activeSession: createAgentSessionFixture({
          sessionId: "active-spec",
          role: "spec",
          scenario: "spec_initial",
          taskId: "task-1",
        }),
        startAgentSession,
        onContextSwitchIntent,
        executeRequestedSessionStart: async (_request, executeWithDecision) =>
          executeWithDecision({
            startMode: "reuse",
            sourceSessionId: "session-existing",
          }),
      }),
    );

    await harness.mount();
    await harness.run((state) => {
      state.handleCreateSession({
        id: "build:build_implementation_start:reuse",
        role: "build",
        scenario: "build_implementation_start",
        label: "Builder · Continue",
        description: "Reuse latest builder session",
        disabled: false,
      });
    });
    await harness.waitFor(() => toastErrorMock.mock.calls.length > 0);

    expect(onContextSwitchIntent).not.toHaveBeenCalled();

    await harness.unmount();
  });
});
