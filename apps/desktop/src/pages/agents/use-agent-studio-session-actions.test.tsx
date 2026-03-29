import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import {
  type AgentChatComposerDraft,
  createTextSegment,
} from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { clearAppQueryClient } from "@/lib/query-client";
import { QueryProvider } from "@/lib/query-provider";
import { ChecksOperationsContext, RuntimeDefinitionsContext } from "@/state/app-state-contexts";
import { host } from "@/state/operations/host";
import { createHookHarness as createCoreHookHarness } from "@/test-utils/react-hook-harness";
import {
  createAgentSessionFixture,
  createDeferred,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioSessionActions } from "./use-agent-studio-session-actions";

enableReactActEnvironment();

beforeEach(async () => {
  await clearAppQueryClient();
});

type HookArgs = Parameters<typeof useAgentStudioSessionActions>[0];

const createTask = (overrides = {}) => createTaskCardFixture(overrides);

const createComposerDraft = (text: string): AgentChatComposerDraft => ({
  segments: [createTextSegment(text)],
});

const createSession = (overrides = {}) => createAgentSessionFixture(overrides);

const QUEUED_RUNTIME_DESCRIPTOR = {
  ...OPENCODE_RUNTIME_DESCRIPTOR,
  kind: "queued-runtime",
  label: "Queued Runtime",
  capabilities: {
    ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
    supportsQueuedUserMessages: true,
  },
} as const;

const createHookHarness = (initialProps: HookArgs) => {
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
          refreshBeadsCheckForRepo: async () => ({
            beadsOk: true,
            beadsPath: "/repo/.beads",
            beadsError: null,
          }),
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
            runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, QUEUED_RUNTIME_DESCRIPTOR],
            isLoadingRuntimeDefinitions: false,
            runtimeDefinitionsError: null,
            refreshRuntimeDefinitions: async () => [
              OPENCODE_RUNTIME_DESCRIPTOR,
              QUEUED_RUNTIME_DESCRIPTOR,
            ],
            loadRepoRuntimeCatalog: async () => ({
              runtime: OPENCODE_RUNTIME_DESCRIPTOR,
              models: [
                {
                  id: "openai/gpt-5",
                  providerId: "openai",
                  providerName: "OpenAI",
                  modelId: "gpt-5",
                  modelName: "GPT-5",
                  variants: ["default"],
                  contextWindow: 200_000,
                  outputLimit: 8_192,
                },
              ],
              defaultModelsByProvider: {
                openai: "gpt-5",
              },
              profiles: [
                {
                  name: "spec",
                  mode: "primary" as const,
                  hidden: false,
                },
                {
                  name: "planner",
                  mode: "primary" as const,
                  hidden: false,
                },
                {
                  name: "build",
                  mode: "primary" as const,
                  hidden: false,
                },
                {
                  name: "qa",
                  mode: "primary" as const,
                  hidden: false,
                },
              ],
            }),
            loadRepoRuntimeSlashCommands: async () => ({ commands: [] }),
          },
          children,
        }),
      ),
    );

  return createCoreHookHarness(useAgentStudioSessionActions, initialProps, { wrapper });
};

const confirmSessionStartModal = async (
  harness: ReturnType<typeof createHookHarness>,
): Promise<void> => {
  await harness.waitFor(
    (state) =>
      state.sessionStartModal !== null &&
      state.sessionStartModal.isSelectionCatalogLoading === false,
  );
  await harness.run((state) => {
    state.sessionStartModal?.onSelectModel("openai/gpt-5");
    state.sessionStartModal?.onSelectAgent("spec");
    state.sessionStartModal?.onSelectVariant("default");
  });
  await harness.waitFor((state) => {
    const selection = state.sessionStartModal?.selectedModelSelection;
    return (
      selection?.profileId === "spec" &&
      selection.modelId === "gpt-5" &&
      (selection.variant ?? "") === "default"
    );
  });
  await harness.run(async (state) => {
    state.sessionStartModal?.onConfirm({
      runInBackground: false,
      startMode: "fresh",
      sourceSessionId: null,
    });
  });
};

const createBaseArgs = (): HookArgs => {
  return {
    activeRepo: "/repo",
    taskId: "task-1",
    role: "spec",
    scenario: "spec_initial",
    activeSession: null,
    selectedModelSelection: null,
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
    repoSettings: null,
    startAgentSession: async () => "session-new",
    sendAgentMessage: async () => {},
    bootstrapTaskSessions: async () => {},
    hydrateRequestedTaskSessionHistory: async () => {},
    humanRequestChangesTask: async () => {},
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
  });

  afterEach(() => {
    host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
    host.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
  });

  test("onSend starts session and sends trimmed message", async () => {
    const startAgentSession = mock(async () => "session-new");
    const sendAgentMessage = mock(async () => {});
    const updateCalls: Array<Record<string, string | undefined>> = [];
    const draft = createComposerDraft("  hello world  ");

    const harness = createHookHarness({
      ...createBaseArgs(),
      startAgentSession,
      sendAgentMessage,
      updateQuery: (updates) => {
        updateCalls.push(updates);
      },
    });

    await harness.mount();
    let sendPromise: Promise<boolean | undefined> | undefined;
    await harness.run((state) => {
      sendPromise = state.onSend(draft);
    });
    await confirmSessionStartModal(harness);
    await harness.run(async () => {
      await sendPromise;
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
      startMode: "fresh" as const,
    });
    expect(sendAgentMessage).toHaveBeenCalledWith("session-new", [
      { kind: "text", text: "  hello world  " },
    ]);
    expect(updateCalls.some((entry) => entry.session === "session-new")).toBe(true);

    await harness.unmount();
  });

  test("onSend reuses active session when one exists", async () => {
    const sendAgentMessage = mock(async () => {});
    const startAgentSession = mock(async () => "session-new");
    const draft = createComposerDraft("  hello world  ");

    const harness = createHookHarness({
      ...createBaseArgs(),
      activeSession: createSession({ sessionId: "session-existing" }),
      sendAgentMessage,
      startAgentSession,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await state.onSend(draft);
    });

    expect(startAgentSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).toHaveBeenCalledWith("session-existing", [
      { kind: "text", text: "  hello world  " },
    ]);

    await harness.unmount();
  });

  test("onSend allows busy follow-ups when the runtime supports queued user messages", async () => {
    const sendAgentMessage = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      activeSession: createSession({
        sessionId: "session-existing",
        status: "running",
        modelCatalog: {
          runtime: {
            ...OPENCODE_RUNTIME_DESCRIPTOR,
            capabilities: {
              ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
              supportsQueuedUserMessages: true,
            },
          },
          models: [],
          defaultModelsByProvider: {},
        },
      }),
      sendAgentMessage,
    });

    await harness.mount();
    await harness.waitFor((state) => state.busySendBlockedReason === null);
    expect(harness.getLatest().busySendBlockedReason).toBeNull();
    await harness.run(async (state) => {
      await expect(state.onSend(createComposerDraft("hello world"))).resolves.toBe(true);
    });

    expect(sendAgentMessage).toHaveBeenCalledWith("session-existing", [
      { kind: "text", text: "hello world" },
    ]);

    await harness.unmount();
  });

  test("onSend blocks busy follow-ups when the runtime does not support queued user messages", async () => {
    const sendAgentMessage = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      activeSession: createSession({
        sessionId: "session-existing",
        status: "running",
        modelCatalog: {
          runtime: {
            ...OPENCODE_RUNTIME_DESCRIPTOR,
            capabilities: {
              ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
              supportsQueuedUserMessages: false,
            },
          },
          models: [],
          defaultModelsByProvider: {},
        },
      }),
      sendAgentMessage,
    });

    await harness.mount();
    expect(harness.getLatest().busySendBlockedReason).toContain(
      "does not support queued messages while the session is working",
    );
    await harness.run(async (state) => {
      await expect(state.onSend(createComposerDraft("hello world"))).resolves.toBe(false);
    });

    expect(sendAgentMessage).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("onSend does not block busy follow-ups when runtime support must be resolved from definitions", async () => {
    const sendAgentMessage = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      activeSession: createSession({
        sessionId: "session-existing",
        status: "running",
        runtimeKind: "opencode",
        modelCatalog: null,
      }),
      sendAgentMessage,
    });

    await harness.mount();
    expect(harness.getLatest().busySendBlockedReason).toBeNull();
    await harness.run(async (state) => {
      await expect(state.onSend(createComposerDraft("hello world"))).resolves.toBe(true);
    });

    expect(sendAgentMessage).toHaveBeenCalledWith("session-existing", [
      { kind: "text", text: "hello world" },
    ]);

    await harness.unmount();
  });

  test("onSend re-enables busy follow-ups when queued-message support becomes available", async () => {
    const sendAgentMessage = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      activeSession: createSession({
        sessionId: "session-existing",
        status: "running",
        modelCatalog: {
          runtime: {
            ...OPENCODE_RUNTIME_DESCRIPTOR,
            capabilities: {
              ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
              supportsQueuedUserMessages: false,
            },
          },
          models: [],
          defaultModelsByProvider: {},
        },
      }),
      sendAgentMessage,
    });

    await harness.mount();
    expect(harness.getLatest().busySendBlockedReason).toContain(
      "does not support queued messages while the session is working",
    );

    await harness.update({
      ...createBaseArgs(),
      activeSession: createSession({
        sessionId: "session-existing",
        status: "running",
        runtimeKind: "opencode",
        modelCatalog: null,
      }),
      sendAgentMessage,
    });

    expect(harness.getLatest().busySendBlockedReason).toBeNull();
    await harness.run(async (state) => {
      await expect(state.onSend(createComposerDraft("hello world"))).resolves.toBe(true);
    });

    expect(sendAgentMessage).toHaveBeenCalledWith("session-existing", [
      { kind: "text", text: "hello world" },
    ]);

    await harness.unmount();
  });

  test("onSend allows busy follow-ups when the selected runtime supports queued messages", async () => {
    const sendAgentMessage = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      activeSession: createSession({
        sessionId: "session-existing",
        status: "running",
        runtimeKind: "opencode",
        modelCatalog: {
          runtime: {
            ...OPENCODE_RUNTIME_DESCRIPTOR,
            capabilities: {
              ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
              supportsQueuedUserMessages: false,
            },
          },
          models: [],
          defaultModelsByProvider: {},
        },
      }),
      selectedModelSelection: {
        runtimeKind: "queued-runtime",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        profileId: "spec",
      },
      sendAgentMessage,
    });

    await harness.mount();
    expect(harness.getLatest().busySendBlockedReason).toBeNull();
    await harness.run(async (state) => {
      await expect(state.onSend(createComposerDraft("hello world"))).resolves.toBe(true);
    });

    expect(sendAgentMessage).toHaveBeenCalledWith("session-existing", [
      { kind: "text", text: "hello world" },
    ]);

    await harness.unmount();
  });

  test("onSend does not send while the active session is waiting for answers", async () => {
    const sendAgentMessage = mock(async () => {});
    const startAgentSession = mock(async () => "session-new");
    const draft = createComposerDraft("  hello world  ");

    const harness = createHookHarness({
      ...createBaseArgs(),
      activeSession: createSession({
        sessionId: "session-existing",
        pendingQuestions: [
          {
            requestId: "question-1",
            questions: [
              {
                header: "Confirm",
                question: "Need answer",
                options: [],
                multiple: false,
                custom: true,
              },
            ],
          },
        ],
      }),
      sendAgentMessage,
      startAgentSession,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(draft)).resolves.toBe(false);
    });

    expect(startAgentSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(harness.getLatest().isWaitingInput).toBe(true);

    await harness.unmount();
  });

  test("onSend marks the context as sending until the send settles", async () => {
    const sendDeferred = createDeferred<void>();
    const sendAgentMessage = mock(() => sendDeferred.promise);
    const draft = createComposerDraft("  hello world  ");

    const harness = createHookHarness({
      ...createBaseArgs(),
      activeSession: createSession({ sessionId: "session-existing" }),
      sendAgentMessage,
    });

    await harness.mount();
    let sendPromise: Promise<boolean | undefined> | undefined;
    await harness.run(async (state) => {
      sendPromise = state.onSend(draft);
      expect(sendAgentMessage).toHaveBeenCalledWith("session-existing", [
        { kind: "text", text: "  hello world  " },
      ]);
    });
    expect(harness.getLatest().isSending).toBe(true);

    await harness.run(async () => {
      sendDeferred.resolve();
      await sendPromise;
    });
    await harness.unmount();
  });

  test("onSend clears sending state when send fails", async () => {
    const sendDeferred = createDeferred<void>();
    const sendAgentMessage = mock(() => sendDeferred.promise);
    const draft = createComposerDraft("  hello world  ");

    const harness = createHookHarness({
      ...createBaseArgs(),
      activeSession: createSession({ sessionId: "session-existing" }),
      sendAgentMessage,
    });

    await harness.mount();
    let sendPromise: Promise<boolean | undefined> | undefined;
    await harness.run(async (state) => {
      sendPromise = state.onSend(draft).catch(() => undefined);
    });
    expect(harness.getLatest().isSending).toBe(true);

    await harness.run(async () => {
      sendDeferred.reject(new Error("send failed"));
      await sendPromise;
    });

    expect(harness.getLatest().isSending).toBe(false);
    await harness.unmount();
  });

  test("resets transient sending state when switching task context", async () => {
    const sendDeferred = createDeferred<void>();
    const sendAgentMessage = mock(() => sendDeferred.promise);
    const taskOneDraft = createComposerDraft("  hello world  ");
    const taskOneSession = createSession({
      taskId: "task-1",
      sessionId: "session-task-1",
      status: "stopped",
    });
    const taskTwoSession = createSession({
      taskId: "task-2",
      sessionId: "session-task-2",
      status: "stopped",
    });

    const harness = createHookHarness({
      ...createBaseArgs(),
      activeSession: taskOneSession,
      sessionsForTask: [taskOneSession],
      sendAgentMessage,
    });

    await harness.mount();

    let sendPromise: Promise<boolean> | undefined;
    await harness.run((state) => {
      sendPromise = state.onSend(taskOneDraft);
    });

    await harness.waitFor((state) => state.isSending);
    expect(harness.getLatest().isSessionWorking).toBe(true);

    await harness.update({
      ...createBaseArgs(),
      taskId: "task-2",
      activeSession: taskTwoSession,
      sessionsForTask: [taskTwoSession],
      sendAgentMessage,
    });

    const nextState = harness.getLatest();
    expect(nextState.isSending).toBe(false);
    expect(nextState.isSessionWorking).toBe(false);

    await harness.run(async () => {
      sendDeferred.resolve();
      await sendPromise;
    });
    await harness.unmount();
  });

  test("restores the in-flight send state after switching away and back", async () => {
    const firstSendDeferred = createDeferred<void>();
    const sendAgentMessage = mock(() => firstSendDeferred.promise);
    const firstDraft = createComposerDraft("  hello world  ");
    const taskOneSession = createSession({
      taskId: "task-1",
      sessionId: "session-task-1",
      status: "stopped",
    });
    const taskTwoSession = createSession({
      taskId: "task-2",
      sessionId: "session-task-2",
      status: "stopped",
    });

    const harness = createHookHarness({
      ...createBaseArgs(),
      activeSession: taskOneSession,
      sessionsForTask: [taskOneSession],
      sendAgentMessage,
    });

    await harness.mount();

    let firstSendPromise: Promise<boolean> | undefined;
    await harness.run((state) => {
      firstSendPromise = state.onSend(firstDraft);
    });
    await harness.waitFor((state) => state.isSending);

    await harness.update({
      ...createBaseArgs(),
      taskId: "task-2",
      activeSession: taskTwoSession,
      sessionsForTask: [taskTwoSession],
      sendAgentMessage,
    });
    expect(harness.getLatest().isSending).toBe(false);

    await harness.update({
      ...createBaseArgs(),
      activeSession: taskOneSession,
      sessionsForTask: [taskOneSession],
      sendAgentMessage,
    });

    await harness.waitFor((state) => state.isSending);
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);

    await harness.run(async () => {
      firstSendDeferred.resolve();
      await firstSendPromise;
    });
    await harness.waitFor((state) => !state.isSending);
    await harness.unmount();
  });

  test("blocks overlapping sends after returning to an in-flight session", async () => {
    const firstSendDeferred = createDeferred<void>();
    const sendAgentMessage = mock(() => firstSendDeferred.promise);
    const firstDraft = createComposerDraft("  hello world  ");
    const secondDraft = createComposerDraft("second send");
    const taskOneSession = createSession({
      taskId: "task-1",
      sessionId: "session-task-1",
      status: "stopped",
    });
    const taskTwoSession = createSession({
      taskId: "task-2",
      sessionId: "session-task-2",
      status: "stopped",
    });

    const harness = createHookHarness({
      ...createBaseArgs(),
      activeSession: taskOneSession,
      sessionsForTask: [taskOneSession],
      sendAgentMessage,
    });

    await harness.mount();

    let firstSendPromise: Promise<boolean> | undefined;
    await harness.run((state) => {
      firstSendPromise = state.onSend(firstDraft);
    });
    await harness.waitFor((state) => state.isSending);

    await harness.update({
      ...createBaseArgs(),
      taskId: "task-2",
      activeSession: taskTwoSession,
      sessionsForTask: [taskTwoSession],
      sendAgentMessage,
    });
    expect(harness.getLatest().isSending).toBe(false);

    await harness.update({
      ...createBaseArgs(),
      activeSession: taskOneSession,
      sessionsForTask: [taskOneSession],
      sendAgentMessage,
    });
    await harness.waitFor((state) => state.isSending);

    await harness.run(async (state) => {
      await state.onSend(secondDraft);
    });
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
    expect(harness.getLatest().isSending).toBe(true);

    await harness.run(async () => {
      firstSendDeferred.resolve();
      await firstSendPromise;
    });
    await harness.waitFor((state) => !state.isSending);
    await harness.unmount();
  });

  test("keeps sending state while a newly created session becomes selected", async () => {
    const sendDeferred = createDeferred<void>();
    const sendAgentMessage = mock(() => sendDeferred.promise);
    const startAgentSession = mock(async () => "session-new");
    const draft = createComposerDraft("  hello world  ");
    const nextSession = createSession({
      taskId: "task-1",
      sessionId: "session-new",
      role: "spec",
      status: "stopped",
    });

    const harness = createHookHarness({
      ...createBaseArgs(),
      startAgentSession,
      sendAgentMessage,
    });

    await harness.mount();

    let sendPromise: Promise<boolean> | undefined;
    await harness.run((state) => {
      sendPromise = state.onSend(draft);
    });
    await confirmSessionStartModal(harness);

    await harness.waitFor((state) => state.isSending);

    await harness.update({
      ...createBaseArgs(),
      activeSession: nextSession,
      sessionsForTask: [nextSession],
      startAgentSession,
      sendAgentMessage,
    });

    expect(harness.getLatest().isSending).toBe(true);

    await harness.run(async () => {
      sendDeferred.resolve();
      await sendPromise;
    });
    await harness.waitFor((state) => !state.isSending);
    await harness.unmount();
  });

  test("onSend reuses active session when available", async () => {
    const sendAgentMessage = mock(async () => {});
    const updateCalls: Array<Record<string, string | undefined>> = [];
    const draft = createComposerDraft("  hello world  ");
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
      await expect(state.onSend(draft)).resolves.toBe(true);
    });

    expect(sendAgentMessage).toHaveBeenCalledWith("session-existing", [
      { kind: "text", text: "  hello world  " },
    ]);

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
      scenario: undefined,
      autostart: undefined,
      start: undefined,
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
      scenario: "spec_initial",
      autostart: undefined,
      start: undefined,
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

  test("handleCreateSession does not switch query before creating another session for the same role", async () => {
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

      expect(updateCalls).toEqual([]);
    } finally {
      deferredStart.resolve("session-spec-fresh");
      await harness.unmount();
    }
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
