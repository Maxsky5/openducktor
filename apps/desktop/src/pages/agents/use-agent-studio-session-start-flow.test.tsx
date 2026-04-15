import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import { toast } from "sonner";
import { HUMAN_REVIEW_FEEDBACK_REQUEST_FAILURE_MESSAGE } from "@/features/human-review-feedback/human-review-feedback-flow";
import { QueryProvider } from "@/lib/query-provider";
import { ChecksOperationsContext, RuntimeDefinitionsContext } from "@/state/app-state-contexts";
import { host } from "@/state/operations/host";
import { createHookHarness as createCoreHookHarness } from "@/test-utils/react-hook-harness";
import {
  createAgentSessionFixture,
  createBeadsCheckFixture,
  createDeferred,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { kickoffPromptForScenario } from "./agents-page-constants";
import { useAgentStudioSessionStartFlow as useSessionStartFlow } from "./use-agent-studio-session-start-flow";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useSessionStartFlow>[0];

const createTask = (overrides = {}) => createTaskCardFixture(overrides);

const createSession = (overrides = {}) => createAgentSessionFixture(overrides);

const createModalCatalog = (): AgentModelCatalog => ({
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT-5",
      variants: ["default", "high"],
      contextWindow: 200_000,
      outputLimit: 8_192,
    },
    {
      id: "anthropic/claude-sonnet-4",
      providerId: "anthropic",
      providerName: "Anthropic",
      modelId: "claude-sonnet-4",
      modelName: "Claude Sonnet 4",
      variants: ["thinking"],
      contextWindow: 200_000,
      outputLimit: 8_192,
    },
  ],
  defaultModelsByProvider: {
    openai: "gpt-5",
    anthropic: "claude-sonnet-4",
  },
  profiles: [
    {
      name: "planner",
      mode: "primary",
      hidden: false,
    },
    {
      name: "spec",
      mode: "primary",
      hidden: false,
    },
    {
      name: "builder",
      mode: "primary",
      hidden: false,
    },
    {
      name: "qa",
      mode: "primary",
      hidden: false,
    },
  ],
});

const createInternalModalHookHarness = (initialProps: HookArgs) => {
  const wrapper = ({ children }: PropsWithChildren): ReactElement =>
    createElement(
      ChecksOperationsContext.Provider,
      {
        value: {
          refreshRuntimeCheck: async () => ({
            gitOk: true,
            gitVersion: null,
            ghOk: true,
            ghVersion: null,
            ghAuthOk: true,
            ghAuthLogin: null,
            ghAuthError: null,
            runtimes: [],
            errors: [],
          }),
          refreshBeadsCheckForRepo: async () => createBeadsCheckFixture(),
          refreshRepoRuntimeHealthForRepo: async () => ({}),
          clearActiveBeadsCheck: () => {},
          clearActiveRepoRuntimeHealth: () => {},
          setIsLoadingChecks: () => {},
          hasRuntimeCheck: () => false,
          hasCachedBeadsCheck: () => false,
          hasCachedRepoRuntimeHealth: () => false,
        },
      },
      createElement(
        QueryProvider,
        { useIsolatedClient: true },
        createElement(RuntimeDefinitionsContext.Provider, {
          value: {
            runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
            isLoadingRuntimeDefinitions: false,
            runtimeDefinitionsError: null,
            refreshRuntimeDefinitions: async () => [OPENCODE_RUNTIME_DESCRIPTOR],
            loadRepoRuntimeCatalog: async () => createModalCatalog(),
            loadRepoRuntimeSlashCommands: async () => ({ commands: [] }),
            loadRepoRuntimeFileSearch: async () => [],
          },
          children,
        }),
      ),
    );

  return createCoreHookHarness(useSessionStartFlow, initialProps, { wrapper });
};

const createHookHarness = createInternalModalHookHarness;

const MODEL_SELECTION = {
  runtimeKind: "opencode" as const,
  providerId: "openai",
  modelId: "gpt-5",
  variant: "default",
  profileId: "spec",
};

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
    ...MODEL_SELECTION,
  },
  repoSettings: null,
  startAgentSession: async () => "session-new",
  sendAgentMessage: async () => {},
  bootstrapTaskSessions: async () => {},
  hydrateRequestedTaskSessionHistory: async () => {},
  humanRequestChangesTask: async () => {},
  updateQuery: () => {},
});

const waitForSessionStartModal = async (
  harness: ReturnType<typeof createHookHarness>,
): Promise<NonNullable<ReturnType<typeof harness.getLatest>["sessionStartModal"]>> => {
  await harness.waitFor(
    (state) =>
      state.sessionStartModal !== null &&
      state.sessionStartModal.isSelectionCatalogLoading === false,
  );
  const modal = harness.getLatest().sessionStartModal;
  expect(modal).not.toBeNull();
  if (!modal) {
    throw new Error("Expected session start modal to be available.");
  }
  return modal;
};

const confirmSessionStartModal = async ({
  harness,
  agent,
  modelId,
  variant,
  startMode = "fresh",
  sourceSessionId = null,
}: {
  harness: ReturnType<typeof createHookHarness>;
  agent: string;
  modelId: string;
  variant: string;
  startMode?: "fresh" | "reuse" | "fork";
  sourceSessionId?: string | null;
}): Promise<void> => {
  await waitForSessionStartModal(harness);

  await harness.run((state) => {
    if (startMode !== "reuse") {
      state.sessionStartModal?.onSelectAgent(agent);
      state.sessionStartModal?.onSelectModel(modelId);
      state.sessionStartModal?.onSelectVariant(variant);
    }
    if (startMode !== "fresh" && sourceSessionId) {
      state.sessionStartModal?.onSelectSourceSession(sourceSessionId);
    }
  });

  await harness.waitFor((state) => {
    const modal = state.sessionStartModal;
    if (!modal) {
      return false;
    }
    if (startMode === "reuse") {
      return sourceSessionId ? modal.selectedSourceSessionId === sourceSessionId : true;
    }

    const selection = modal.selectedModelSelection;
    return (
      selection?.profileId === agent &&
      selection.modelId === modelId.split("/")[1] &&
      (selection.variant ?? "") === variant
    );
  });

  await harness.run(async (state) => {
    state.sessionStartModal?.onConfirm({
      runInBackground: false,
      startMode,
      sourceSessionId,
    });
  });
};

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
      kanban: {
        doneVisibleDays: 1,
      },
      autopilot: {
        rules: [],
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
    let startPromise: Promise<string | undefined> | undefined;
    await harness.run(async (state) => {
      startPromise = state.startSession("composer_send");
    });
    await confirmSessionStartModal({
      harness,
      agent: "spec",
      modelId: "openai/gpt-5",
      variant: "default",
    });
    await harness.run(async () => {
      const sessionId = await startPromise;
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

  test("startSession uses the internal modal flow when no external request hook is provided", async () => {
    const startAgentSession = mock(async () => "session-new");
    const updateCalls: Array<Record<string, string | undefined>> = [];
    const harness = createInternalModalHookHarness({
      ...createBaseArgs(),
      role: "planner",
      scenario: "planner_initial",
      selectionForNewSession: null,
      startAgentSession,
      updateQuery: (updates) => {
        updateCalls.push(updates);
      },
    });

    await harness.mount();

    let startPromise: Promise<string | undefined> | undefined;
    await harness.run((state) => {
      startPromise = state.startSession("composer_send");
    });
    expect(harness.getLatest().isStarting).toBe(false);
    await confirmSessionStartModal({
      harness,
      agent: "planner",
      modelId: "openai/gpt-5",
      variant: "default",
    });

    await harness.run(async () => {
      await startPromise;
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
        profileId: "planner",
      },
      startMode: "fresh",
    });
    expect(updateCalls).toContainEqual({
      task: "task-1",
      session: "session-new",
      agent: "planner",
      autostart: undefined,
      start: undefined,
    });
    expect(harness.getLatest().isStarting).toBe(false);

    await harness.unmount();
  });

  test("startScenarioKickoff uses the internal modal flow when no external request hook is provided", async () => {
    const startAgentSession = mock(async () => "session-new");
    const sendAgentMessage = mock(async () => {});
    const harness = createInternalModalHookHarness({
      ...createBaseArgs(),
      role: "planner",
      scenario: "planner_initial",
      selectionForNewSession: null,
      input: "",
      startAgentSession,
      sendAgentMessage,
    } as HookArgs & { input?: string });

    await harness.mount();

    await harness.run((state) => {
      void state.startScenarioKickoff();
    });
    await confirmSessionStartModal({
      harness,
      agent: "planner",
      modelId: "openai/gpt-5",
      variant: "default",
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
        profileId: "planner",
      },
      startMode: "fresh",
    });

    await harness.unmount();
  });

  test("handleCreateSession uses the internal modal flow when no external request hook is provided", async () => {
    const startAgentSession = mock(async () => "session-plan");
    const updateCalls: Array<Record<string, string | undefined>> = [];
    const harness = createInternalModalHookHarness({
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
      selectionForNewSession: null,
      startAgentSession,
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
    await confirmSessionStartModal({
      harness,
      agent: "planner",
      modelId: "openai/gpt-5",
      variant: "default",
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
        profileId: "planner",
      },
      startMode: "fresh",
    });
    expect(updateCalls).toContainEqual({
      task: "task-1",
      session: "session-plan",
      agent: "planner",
      scenario: undefined,
      autostart: undefined,
      start: undefined,
    });

    await harness.unmount();
  });

  test("handleCreateSession keeps the previous query when fresh start fails", async () => {
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
    await confirmSessionStartModal({
      harness,
      agent: "planner",
      modelId: "openai/gpt-5",
      variant: "default",
    });

    expect(startAgentSession).toHaveBeenCalledTimes(1);
    await harness.waitFor((state) => state.isStarting === false);

    expect(updateCalls).toEqual([]);
    expect(sendAgentMessage).not.toHaveBeenCalled();

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
    await confirmSessionStartModal({
      harness,
      agent: "planner",
      modelId: "openai/gpt-5",
      variant: "default",
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
    await confirmSessionStartModal({
      harness,
      agent: "builder",
      modelId: "openai/gpt-5",
      variant: "default",
    });
    await harness.waitFor(() => startAgentSession.mock.calls.length > 0);
    await harness.waitFor(() => sendAgentMessage.mock.calls.length > 0);

    expect(startAgentSession).toHaveBeenCalledWith({
      taskId: "task-1",
      role: "build",
      scenario: "build_after_qa_rejected",
      selectedModel: {
        ...MODEL_SELECTION,
        profileId: "builder",
      },
      startMode: "fresh" as const,
    });
    expect(sendAgentMessage).toHaveBeenCalledWith("session-build-rework", [
      {
        kind: "text",
        text: kickoffPromptForScenario("build", "build_after_qa_rejected", "task-1"),
      },
    ]);
    expect(updateCalls).toContainEqual({
      task: "task-1",
      session: "session-build-rework",
      agent: "build",
      scenario: undefined,
      autostart: undefined,
      start: undefined,
    });

    await harness.unmount();
  });

  test("handleCreateSession for human changes opens the feedback modal before model selection", async () => {
    const startAgentSession = mock(
      async (input: { startMode: string; sourceSessionId?: string }) =>
        input.startMode === "reuse"
          ? (input.sourceSessionId ?? "session-build-latest")
          : "session-build-human",
    );
    const bootstrapTaskSessions = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "spec",
      scenario: "spec_initial",
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
    expect(startAgentSession).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("startScenarioKickoff for human changes opens the feedback modal instead of starting immediately", async () => {
    const startAgentSession = mock(async () => "session-build-human");
    const sendAgentMessage = mock(async () => {});
    const bootstrapTaskSessions = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "build",
      scenario: "build_after_human_request_changes",
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
    expect(sendAgentMessage).toHaveBeenCalledWith("session-build-older", [
      { kind: "text", text: "Apply the requested human changes." },
    ]);
    expect(updateCalls).toContainEqual({
      task: "task-1",
      session: "session-build-older",
      agent: "build",
      autostart: undefined,
      start: undefined,
    });

    await harness.unmount();
  });

  test("human changes feedback shows the canonical request failure toast for existing builder sessions", async () => {
    const originalToastError = toast.error;
    const toastError = mock(() => "toast-id");
    toast.error = toastError;
    const humanRequestChangesTask = mock(async () => {
      throw new Error("request failed");
    });

    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "spec",
      scenario: "spec_initial",
      humanRequestChangesTask,
      bootstrapTaskSessions: mock(async () => {}),
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

    try {
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
        state.humanReviewFeedbackModal?.onTargetChange("session-build-latest");
        state.humanReviewFeedbackModal?.onMessageChange("Apply the requested human changes.");
      });
      await harness.run(async (state) => {
        await state.humanReviewFeedbackModal?.onConfirm();
      });

      expect(humanRequestChangesTask).toHaveBeenCalledWith(
        "task-1",
        "Apply the requested human changes.",
      );
      expect(toastError).toHaveBeenCalledWith(HUMAN_REVIEW_FEEDBACK_REQUEST_FAILURE_MESSAGE);
      expect(harness.getLatest().humanReviewFeedbackModal?.open).toBe(true);
    } finally {
      toast.error = originalToastError;
      await harness.unmount();
    }
  });

  test("canceling new-session model selection preserves the human changes feedback draft", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "spec",
      scenario: "spec_initial",
      bootstrapTaskSessions: mock(async () => {}),
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
      state.humanReviewFeedbackModal?.onMessageChange("Keep this draft when I cancel.");
    });
    await harness.run((state) => {
      void state.humanReviewFeedbackModal?.onConfirm();
    });
    await waitForSessionStartModal(harness);

    await harness.run((state) => {
      state.sessionStartModal?.onOpenChange(false);
    });

    await harness.waitFor(
      (state) =>
        state.sessionStartModal === null &&
        state.humanReviewFeedbackModal?.open === true &&
        state.humanReviewFeedbackModal.message === "Keep this draft when I cancel.",
    );

    expect(harness.getLatest().humanReviewFeedbackModal?.selectedTarget).toBe("new_session");

    await harness.unmount();
  });
});
