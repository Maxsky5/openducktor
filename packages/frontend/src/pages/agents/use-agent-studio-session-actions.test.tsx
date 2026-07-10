import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR, type RuntimeDescriptor } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import {
  type AgentChatComposerDraft,
  createComposerAttachment,
  createFileReferenceSegment,
  createSlashCommandSegment,
  createTextSegment,
} from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { createSessionStartWorkflowRunner } from "@/features/session-start";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { clearAppQueryClient } from "@/lib/query-client";
import { QueryProvider } from "@/lib/query-provider";
import { toAgentSessionSummary } from "@/state/agent-sessions-store";
import {
  ChecksOperationsContext,
  ChecksStateContext,
  RepoRuntimeHealthContext,
  RuntimeDefinitionsContext,
} from "@/state/app-state-contexts";
import { host } from "@/state/operations/host";
import { createHookHarness as createCoreHookHarness } from "@/test-utils/react-hook-harness";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
  AgentSessionIdentity,
} from "@/types/agent-orchestrator";
import {
  createAgentSessionFixture,
  createChecksStateContextValue,
  createDeferred,
  createRepoRuntimeHealthContextValue,
  createRuntimeDefinitionsContextValue,
  createTaskCardFixture,
  createTaskStoreCheckFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioSelectionActions } from "./session-actions/use-agent-studio-selection-actions";
import { useAgentStudioSessionActions } from "./use-agent-studio-session-actions";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioSessionActions>[0];

const createSessionRuntimeData = (
  overrides: Partial<HookArgs["selectedSession"]["runtimeData"]> = {},
): HookArgs["selectedSession"]["runtimeData"] => ({
  modelCatalog: null,
  todos: [],
  isLoadingModelCatalog: false,
  error: null,
  ...overrides,
});

const createRuntimeCatalog = (
  runtime: RuntimeDescriptor,
): NonNullable<HookArgs["selectedSession"]["runtimeData"]["modelCatalog"]> => ({
  runtime,
  models: [],
  defaultModelsByProvider: {},
  profiles: [],
});

const createTask = (overrides = {}) => createTaskCardFixture(overrides);

const createComposerDraft = (text: string): AgentChatComposerDraft => ({
  segments: [createTextSegment(text)],
  attachments: [],
});

const COMMAND = {
  id: "review",
  trigger: "review",
  title: "review",
  hints: ["review"],
};

const REUSABLE_PROMPT_COMMAND = {
  id: "reusable-prompt:prompt-1",
  trigger: "review",
  title: "review",
  description: "Review context",
  source: "custom" as const,
  hints: [],
};

const FILE_REFERENCE = {
  id: "file-src-main",
  path: "src/main.ts",
  name: "main.ts",
  kind: "code" as const,
};

const createAttachmentDraft = (input: {
  id: string;
  name: string;
  kind: "image" | "pdf";
  mime: string;
  path: string;
}): AgentChatComposerDraft => ({
  segments: [createTextSegment("please review")],
  attachments: [
    createComposerAttachment(
      {
        name: input.name,
        kind: input.kind,
        mime: input.mime,
        path: input.path,
      },
      input.id,
    ),
  ],
});

const createSession = (overrides = {}) => createAgentSessionFixture(overrides);
const summarizeSessions = (sessions: ReturnType<typeof createSession>[]) =>
  sessions.map(toAgentSessionSummary);

const sessionIdentity = (externalSessionId: string) => ({
  externalSessionId,
  runtimeKind: "opencode" as const,
  workingDirectory: `/repo/worktrees/${externalSessionId}`,
});

const createRunSessionStartWorkflow = (
  overrides: Partial<Parameters<typeof createSessionStartWorkflowRunner>[0]> = {},
) =>
  createSessionStartWorkflowRunner({
    queryClient: new QueryClient(),
    workspaceId: "workspace-1",
    startAgentSession: async () => sessionIdentity("session-new"),
    sendAgentMessage: async () => {},
    ...overrides,
  });

const localSessionIdentity = (externalSessionId: string) =>
  toAgentSessionIdentity(createSession({ externalSessionId }));

const createSelectedSessionState = (
  overrides: Partial<HookArgs["selectedSession"]> = {},
): HookArgs["selectedSession"] => ({
  identity: null,
  activityState: null,
  selectedModel: null,
  loadedSession: null,
  runtimeData: createSessionRuntimeData(),
  runtimeReadiness: {
    state: "ready",
    message: null,
    isLoadingChecks: false,
    refreshChecks: async () => {},
  },
  transcriptState: { kind: "visible" },
  ...overrides,
});

const selectedSessionFromSession = (session: ReturnType<typeof createSession>) =>
  createSelectedSessionState({
    identity: toAgentSessionIdentity(session),
    activityState: toAgentSessionSummary(session).activityState,
    selectedModel: session.selectedModel,
    loadedSession: session,
  });

const selectedSessionFromIdentity = (identity: AgentSessionIdentity) =>
  createSelectedSessionState({ identity });

const selectedSessionArgs = (overrides = {}) => {
  const loadedSession = createSession(overrides);
  return {
    selectedSession: selectedSessionFromSession(loadedSession),
  };
};

const selectedSessionWithRuntimeData = (
  sessionOverrides: Parameters<typeof selectedSessionArgs>[0],
  runtimeDataOverrides: Partial<HookArgs["selectedSession"]["runtimeData"]>,
) => {
  const { selectedSession } = selectedSessionArgs(sessionOverrides);
  return {
    selectedSession: {
      ...selectedSession,
      runtimeData: createSessionRuntimeData(runtimeDataOverrides),
    },
  };
};

const QUEUED_RUNTIME_DESCRIPTOR = {
  ...OPENCODE_RUNTIME_DESCRIPTOR,
  kind: "opencode",
  label: "Queued Runtime",
  capabilities: {
    ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
    sessionLifecycle: {
      ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.sessionLifecycle,
      supportsQueuedUserMessages: true,
    },
  },
} as const;

const TEST_RUNTIME_DEFINITIONS = [OPENCODE_RUNTIME_DESCRIPTOR, QUEUED_RUNTIME_DESCRIPTOR];

const createTestRuntimeDefinitionsContextValue = () =>
  createRuntimeDefinitionsContextValue({
    runtimeDefinitions: TEST_RUNTIME_DEFINITIONS,
    availableRuntimeDefinitions: TEST_RUNTIME_DEFINITIONS,
    refreshRuntimeDefinitions: async () => TEST_RUNTIME_DEFINITIONS,
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
          mode: "primary",
          hidden: false,
        },
        {
          name: "planner",
          mode: "primary",
          hidden: false,
        },
        {
          name: "build",
          mode: "primary",
          hidden: false,
        },
        {
          name: "qa",
          mode: "primary",
          hidden: false,
        },
      ],
    }),
  });

const createHookHarness = (initialProps: HookArgs) => {
  const checksStateContextValue = createChecksStateContextValue();
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
          refreshTaskStoreCheckForRepo: async () => createTaskStoreCheckFixture(),
          clearActiveTaskStoreCheck: () => {},
          setIsLoadingChecks: () => {},
          hasRuntimeCheck: () => false,
          hasCachedTaskStoreCheck: () => false,
        },
      },
      createElement(
        QueryProvider,
        { useIsolatedClient: true },
        createElement(
          RepoRuntimeHealthContext.Provider,
          {
            value: createRepoRuntimeHealthContextValue(),
          },
          createElement(
            ChecksStateContext.Provider,
            { value: checksStateContextValue },
            createElement(
              RuntimeDefinitionsContext.Provider,
              { value: createTestRuntimeDefinitionsContextValue() },
              children,
            ),
          ),
        ),
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
      sourceSessionOptionValue: null,
    });
  });
};

const createBaseArgs = (): HookArgs => {
  return {
    activeWorkspaceId: "workspace-1",
    workspaceRepoPath: "/repo",
    taskId: "task-1",
    role: "spec",
    launchActionId: "spec_initial",
    selectedSession: createSelectedSessionState(),
    runtimeDefinitions: TEST_RUNTIME_DEFINITIONS,
    selectedModelDescriptor: null,
    sessionsForTask: [],
    selectedTask: createTask(),
    isSelectedSessionModelSendable: true,
    agentStudioReady: true,
    isActiveTaskReady: true,
    selectionForNewSession: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "spec",
    },
    reusablePrompts: [],
    repoSettings: null,
    runSessionStartWorkflow: createRunSessionStartWorkflow(),
    sendAgentMessage: async () => {},
    humanRequestChangesTask: async () => {},
    replyAgentApproval: async () => {},
    answerAgentQuestion: async () => {},
    scheduleQueryUpdate: () => {},
    selectAgentStudioSelection: () => {},
  };
};

describe("useAgentStudioSessionActions", () => {
  const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;
  const originalWorkspaceGetSettingsSnapshot = host.workspaceGetSettingsSnapshot;

  beforeEach(async () => {
    await clearAppQueryClient();
    host.workspaceGetRepoConfig = async () =>
      ({
        workspaceId: "repo",
        workspaceName: "Repo",
        repoPath: "/repo",
        promptOverrides: {},
      }) as Awaited<ReturnType<typeof host.workspaceGetRepoConfig>>;
    host.workspaceGetSettingsSnapshot = async () => createSettingsSnapshotFixture();
  });

  afterEach(() => {
    host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
    host.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
  });

  test("prepares a message-first session target without starting or sending", async () => {
    const scheduleQueryUpdate = mock(() => {});
    const selectAgentStudioSelection = mock(() => {});
    const startAgentSession = mock(async () => sessionIdentity("session-new"));
    const sendAgentMessage = mock(async () => {});
    const harness = createHookHarness({
      ...createBaseArgs(),
      scheduleQueryUpdate,
      selectAgentStudioSelection,
      runSessionStartWorkflow: createRunSessionStartWorkflow({
        startAgentSession,
        sendAgentMessage,
      }),
      sendAgentMessage,
    });

    await harness.mount();

    await harness.run((state) => {
      state.handlePrepareMessageFirstSession({
        id: "build:build_implementation_start:message_first",
        role: "build",
        launchActionId: "build_implementation_start",
        label: "Prepare Builder session",
        description: "Open a Builder composer without sending a kickoff.",
        disabled: false,
      });
    });

    expect(scheduleQueryUpdate).not.toHaveBeenCalled();
    expect(selectAgentStudioSelection).toHaveBeenCalledWith({
      taskId: "task-1",
      sessionExternalId: null,
      sessionIdentity: null,
      role: "build",
      hasExplicitRoleSelection: true,
      keepSessionless: true,
    });
    expect(startAgentSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("does not prepare a message-first target when parent start policy rejects it", async () => {
    const selectAgentStudioSelection = mock(() => {});
    const harness = createCoreHookHarness(useAgentStudioSelectionActions, {
      taskId: "task-1",
      sessionsForTask: [],
      canPrepareMessageFirstSession: () => false,
      selectAgentStudioSelection,
    });

    await harness.mount();
    await harness.run((state) => {
      state.handlePrepareMessageFirstSession({
        id: "build:build_implementation_start:message_first",
        role: "build",
        launchActionId: "build_implementation_start",
        label: "Prepare Builder session",
        description: "Open a Builder composer without sending a kickoff.",
        disabled: false,
      });
    });

    expect(selectAgentStudioSelection).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("quick action opens the modal-backed session start flow", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "build",
      launchActionId: "build_implementation_start",
      selectedTask: createTask({
        agentWorkflows: {
          builder: { required: true, canSkip: false, available: true, completed: false },
        },
      }),
      selectionForNewSession: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        profileId: "build",
      },
    });

    await harness.mount();

    await harness.run((state) => {
      state.handleQuickAction({
        id: "quick:build_pull_request_generation",
        role: "build",
        launchActionId: "build_pull_request_generation",
        label: "Generate Pull Request",
        description: "Reuse or fork a Builder session to create or update a pull request.",
        postStartAction: "kickoff",
        disabled: false,
        existingSessionOptions: [
          {
            value: "builder-1",
            sourceSession: {
              externalSessionId: "builder-1",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktree",
            },
            label: "Builder #1",
            description: "Existing Builder session",
          },
        ],
        initialSourceSession: {
          externalSessionId: "builder-1",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
        },
        initialStartMode: "reuse",
      });
    });

    await harness.waitFor((state) => state.sessionStartModal !== null);
    expect(harness.getLatest().sessionStartModal?.description).toContain("Generate Pull Request");
    expect(harness.getLatest().sessionStartModal?.selectedStartMode).toBe("reuse");
    expect(harness.getLatest().sessionStartModal?.selectedSourceSessionValue).toBe("builder-1");

    await harness.unmount();
  });

  test("request changes quick action applies feedback before starting Builder", async () => {
    const calls: string[] = [];
    const humanRequestChangesTask = mock(async () => {
      calls.push("request-changes");
    });
    const startAgentSession = mock(async () => {
      calls.push("start-session");
      return sessionIdentity("builder-rework-session");
    });
    const sendAgentMessage = mock(async () => {});
    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "build",
      launchActionId: "build_after_human_request_changes",
      selectedTask: createTask({
        status: "human_review",
        availableActions: ["human_request_changes"],
        agentWorkflows: {
          spec: { required: true, canSkip: false, available: false, completed: true },
          planner: { required: true, canSkip: false, available: false, completed: true },
          builder: { required: true, canSkip: false, available: true, completed: false },
          qa: { required: true, canSkip: false, available: false, completed: true },
        },
      }),
      selectionForNewSession: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        profileId: "build",
      },
      humanRequestChangesTask,
      runSessionStartWorkflow: createRunSessionStartWorkflow({
        startAgentSession,
        sendAgentMessage,
      }),
      sendAgentMessage,
    });

    await harness.mount();

    await harness.run((state) => {
      state.handleQuickAction({
        id: "quick:build_after_human_request_changes",
        role: "build",
        launchActionId: "build_after_human_request_changes",
        label: "Request Changes",
        description: "Collect human feedback, then open the Builder rework flow.",
        postStartAction: "kickoff",
        disabled: false,
        requiresHumanFeedback: true,
      });
    });
    await harness.waitFor((state) => state.humanReviewFeedbackModal !== null);
    await harness.run((state) => {
      state.humanReviewFeedbackModal?.onMessageChange("Please address the review comments.");
    });
    let feedbackPromise: Promise<void> | undefined;
    await harness.run((state) => {
      feedbackPromise = state.humanReviewFeedbackModal?.onConfirm();
    });

    await harness.waitFor((state) => state.sessionStartModal !== null);
    await harness.run((state) => {
      state.sessionStartModal?.onSelectModel("openai/gpt-5");
      state.sessionStartModal?.onSelectAgent("build");
      state.sessionStartModal?.onSelectVariant("default");
    });
    await harness.waitFor((state) => {
      const selection = state.sessionStartModal?.selectedModelSelection;
      return selection?.profileId === "build" && selection.modelId === "gpt-5";
    });
    await harness.run(async (state) => {
      state.sessionStartModal?.onConfirm({
        runInBackground: false,
        startMode: "fresh",
        sourceSessionOptionValue: null,
      });
    });
    await harness.run(async () => {
      await feedbackPromise;
    });

    await harness.waitFor(() => startAgentSession.mock.calls.length > 0);
    expect(humanRequestChangesTask).toHaveBeenCalledWith(
      "task-1",
      "Please address the review comments.",
    );
    expect(calls).toEqual(["request-changes", "start-session"]);
    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-1", role: "build", startMode: "fresh" }),
    );

    await harness.unmount();
  });

  test("onSend starts session and sends trimmed message", async () => {
    const startAgentSession = mock(async () => sessionIdentity("session-new"));
    const sendAgentMessage = mock(async () => {});
    const updateCalls: Array<Record<string, string | undefined>> = [];
    const draft = createComposerDraft("  hello world  ");

    const harness = createHookHarness({
      ...createBaseArgs(),
      runSessionStartWorkflow: createRunSessionStartWorkflow({
        startAgentSession,
        sendAgentMessage,
      }),
      sendAgentMessage,
      scheduleQueryUpdate: (updates) => {
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
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        profileId: "spec",
      },
      startMode: "fresh" as const,
      holdForPostStartMessage: true,
    });
    expect(sendAgentMessage).toHaveBeenCalledWith(sessionIdentity("session-new"), [
      { kind: "text", text: "  hello world  " },
    ]);
    expect(updateCalls.some((entry) => entry.session === "session-new")).toBe(true);

    await harness.unmount();
  });

  test("onSend reuses loaded session when one exists", async () => {
    const sendAgentMessage = mock(async () => {});
    const startAgentSession = mock(async () => sessionIdentity("session-new"));
    const draft = createComposerDraft("  hello world  ");

    const harness = createHookHarness({
      ...createBaseArgs(),
      ...selectedSessionArgs({ externalSessionId: "session-existing" }),
      sendAgentMessage,
      runSessionStartWorkflow: createRunSessionStartWorkflow({
        startAgentSession,
        sendAgentMessage,
      }),
    });

    await harness.mount();
    await harness.run(async (state) => {
      await state.onSend(draft);
    });

    expect(startAgentSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).toHaveBeenCalledWith(localSessionIdentity("session-existing"), [
      { kind: "text", text: "  hello world  " },
    ]);

    await harness.unmount();
  });

  test("onSend targets the selected session while the session state has not loaded it yet", async () => {
    const selectedSessionIdentity = sessionIdentity("session-selected");
    const sendAgentMessage = mock(async () => {});
    const startAgentSession = mock(async () => sessionIdentity("session-new"));
    const draft = createComposerDraft("  selected-session follow-up  ");

    const harness = createHookHarness({
      ...createBaseArgs(),
      selectedSession: selectedSessionFromIdentity(selectedSessionIdentity),
      sendAgentMessage,
      runSessionStartWorkflow: createRunSessionStartWorkflow({
        startAgentSession,
        sendAgentMessage,
      }),
    });

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(draft)).resolves.toBe(true);
    });

    expect(startAgentSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).toHaveBeenCalledWith(selectedSessionIdentity, [
      { kind: "text", text: "  selected-session follow-up  " },
    ]);

    await harness.unmount();
  });

  test("onSend allows slash-command-only drafts without relying on serialized text", async () => {
    const sendAgentMessage = mock(async () => {});
    const draft: AgentChatComposerDraft = {
      segments: [
        createTextSegment("", "text-before"),
        createSlashCommandSegment(COMMAND, "slash-1"),
        createTextSegment("", "text-after"),
      ],
      attachments: [],
    };

    const harness = createHookHarness({
      ...createBaseArgs(),
      ...selectedSessionArgs({ externalSessionId: "session-existing" }),
      sendAgentMessage,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(draft)).resolves.toBe(true);
    });

    expect(sendAgentMessage).toHaveBeenCalledWith(localSessionIdentity("session-existing"), [
      { kind: "slash_command", command: COMMAND },
    ]);

    await harness.unmount();
  });

  test("onSend expands reusable prompt slash commands to normal text with arguments", async () => {
    const sendAgentMessage = mock(async () => {});
    const draft: AgentChatComposerDraft = {
      segments: [
        createTextSegment("", "text-before"),
        createSlashCommandSegment(REUSABLE_PROMPT_COMMAND, "slash-1"),
        createTextSegment(" src/foo.ts ", "text-after"),
      ],
      attachments: [],
    };

    const harness = createHookHarness({
      ...createBaseArgs(),
      ...selectedSessionArgs({ externalSessionId: "session-existing" }),
      reusablePrompts: [
        {
          id: "prompt-1",
          name: "review",
          description: "Review context",
          content: "Review this file:\n$ARGUMENTS",
        },
      ],
      sendAgentMessage,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(draft)).resolves.toBe(true);
    });

    expect(sendAgentMessage).toHaveBeenCalledWith(localSessionIdentity("session-existing"), [
      { kind: "text", text: "Review this file:\nsrc/foo.ts" },
    ]);

    await harness.unmount();
  });

  test("onSend appends reusable prompt arguments when no placeholder is present", async () => {
    const sendAgentMessage = mock(async () => {});
    const draft: AgentChatComposerDraft = {
      segments: [
        createTextSegment("", "text-before"),
        createSlashCommandSegment(REUSABLE_PROMPT_COMMAND, "slash-1"),
        createTextSegment(" src/foo.ts ", "text-after"),
      ],
      attachments: [],
    };

    const harness = createHookHarness({
      ...createBaseArgs(),
      ...selectedSessionArgs({ externalSessionId: "session-existing" }),
      reusablePrompts: [
        {
          id: "prompt-1",
          name: "review",
          description: "Review context",
          content: "Review this carefully.",
        },
      ],
      sendAgentMessage,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(draft)).resolves.toBe(true);
    });

    expect(sendAgentMessage).toHaveBeenCalledWith(localSessionIdentity("session-existing"), [
      { kind: "text", text: "Review this carefully.\nsrc/foo.ts" },
    ]);

    await harness.unmount();
  });

  test("onSend returns false when a reusable prompt command is stale", async () => {
    const sendAgentMessage = mock(async () => {});
    const draft: AgentChatComposerDraft = {
      segments: [
        createTextSegment("", "text-before"),
        createSlashCommandSegment(REUSABLE_PROMPT_COMMAND, "slash-1"),
        createTextSegment(" src/foo.ts ", "text-after"),
      ],
      attachments: [],
    };

    const harness = createHookHarness({
      ...createBaseArgs(),
      ...selectedSessionArgs({ externalSessionId: "session-existing" }),
      reusablePrompts: [],
      sendAgentMessage,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(draft)).resolves.toBe(false);
    });

    expect(sendAgentMessage).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("onSend allows file-reference-only drafts without relying on serialized text", async () => {
    const sendAgentMessage = mock(async () => {});
    const draft: AgentChatComposerDraft = {
      segments: [
        createTextSegment("", "text-before"),
        createFileReferenceSegment(FILE_REFERENCE, "file-1"),
        createTextSegment("", "text-after"),
      ],
      attachments: [],
    };

    const harness = createHookHarness({
      ...createBaseArgs(),
      ...selectedSessionArgs({ externalSessionId: "session-existing" }),
      sendAgentMessage,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(draft)).resolves.toBe(true);
    });

    expect(sendAgentMessage).toHaveBeenCalledWith(localSessionIdentity("session-existing"), [
      { kind: "file_reference", file: FILE_REFERENCE },
    ]);

    await harness.unmount();
  });

  test("onSend allows busy follow-ups when the runtime supports queued user messages", async () => {
    const sendAgentMessage = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      ...selectedSessionWithRuntimeData(
        {
          externalSessionId: "session-existing",
          status: "running",
        },
        {
          modelCatalog: createRuntimeCatalog({
            ...OPENCODE_RUNTIME_DESCRIPTOR,
            capabilities: {
              ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
              sessionLifecycle: {
                ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.sessionLifecycle,
                supportsQueuedUserMessages: true,
              },
            },
          }),
        },
      ),
      runtimeDefinitions: [],
      sendAgentMessage,
    });

    await harness.mount();
    await harness.waitFor((state) => state.busySendBlockedReason === null, 1_000);
    expect(harness.getLatest().busySendBlockedReason).toBeNull();
    await harness.run(async (state) => {
      await expect(state.onSend(createComposerDraft("hello world"))).resolves.toBe(true);
    });

    expect(sendAgentMessage).toHaveBeenCalledWith(localSessionIdentity("session-existing"), [
      { kind: "text", text: "hello world" },
    ]);

    await harness.unmount();
  });

  test("onSend allows queued follow-ups while a starting loaded session is being prepared", async () => {
    const sendAgentMessage = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      ...selectedSessionWithRuntimeData(
        {
          externalSessionId: "session-existing",
          status: "starting",
        },
        {
          modelCatalog: createRuntimeCatalog({
            ...OPENCODE_RUNTIME_DESCRIPTOR,
            capabilities: {
              ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
              sessionLifecycle: {
                ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.sessionLifecycle,
                supportsQueuedUserMessages: true,
              },
            },
          }),
        },
      ),
      runtimeDefinitions: [],
      sendAgentMessage,
    });

    await harness.mount();
    expect(harness.getLatest().busySendBlockedReason).toBeNull();
    await harness.run(async (state) => {
      await expect(state.onSend(createComposerDraft("hello while starting"))).resolves.toBe(true);
    });

    expect(sendAgentMessage).toHaveBeenCalledWith(localSessionIdentity("session-existing"), [
      { kind: "text", text: "hello while starting" },
    ]);

    await harness.unmount();
  });

  test("onSend blocks busy follow-ups when the runtime does not support queued user messages", async () => {
    const sendAgentMessage = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      ...selectedSessionWithRuntimeData(
        {
          externalSessionId: "session-existing",
          status: "running",
        },
        {
          modelCatalog: createRuntimeCatalog({
            ...OPENCODE_RUNTIME_DESCRIPTOR,
            capabilities: {
              ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
              sessionLifecycle: {
                ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.sessionLifecycle,
                supportsQueuedUserMessages: false,
              },
            },
          }),
        },
      ),
      runtimeDefinitions: [],
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
      ...selectedSessionArgs({
        externalSessionId: "session-existing",
        status: "running",
        runtimeKind: "opencode",
      }),
      sendAgentMessage,
    });

    await harness.mount();
    await harness.waitFor((state) => state.busySendBlockedReason === null, 1_000);
    expect(harness.getLatest().busySendBlockedReason).toBeNull();
    await harness.run(async (state) => {
      await expect(state.onSend(createComposerDraft("hello world"))).resolves.toBe(true);
    });

    expect(sendAgentMessage).toHaveBeenCalledWith(localSessionIdentity("session-existing"), [
      { kind: "text", text: "hello world" },
    ]);

    await harness.unmount();
  });

  test("onSend blocks busy follow-ups when runtime support cannot be resolved", async () => {
    const sendAgentMessage = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      ...selectedSessionArgs({
        externalSessionId: "session-existing",
        status: "running",
        runtimeKind: "opencode",
      }),
      runtimeDefinitions: [],
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

  test("onSend re-enables busy follow-ups when queued-message support becomes available", async () => {
    const sendAgentMessage = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      ...selectedSessionWithRuntimeData(
        {
          externalSessionId: "session-existing",
          status: "running",
        },
        {
          modelCatalog: createRuntimeCatalog({
            ...OPENCODE_RUNTIME_DESCRIPTOR,
            capabilities: {
              ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
              sessionLifecycle: {
                ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.sessionLifecycle,
                supportsQueuedUserMessages: false,
              },
            },
          }),
        },
      ),
      runtimeDefinitions: [],
      sendAgentMessage,
    });

    await harness.mount();
    expect(harness.getLatest().busySendBlockedReason).toContain(
      "does not support queued messages while the session is working",
    );

    await harness.update({
      ...createBaseArgs(),
      ...selectedSessionArgs({
        externalSessionId: "session-existing",
        status: "running",
        runtimeKind: "opencode",
      }),
      sendAgentMessage,
    });

    expect(harness.getLatest().busySendBlockedReason).toBeNull();
    await harness.run(async (state) => {
      await expect(state.onSend(createComposerDraft("hello world"))).resolves.toBe(true);
    });

    expect(sendAgentMessage).toHaveBeenCalledWith(localSessionIdentity("session-existing"), [
      { kind: "text", text: "hello world" },
    ]);

    await harness.unmount();
  });

  test("onSend uses loaded session runtime support for busy follow-ups", async () => {
    const sendAgentMessage = mock(async () => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      ...selectedSessionWithRuntimeData(
        {
          externalSessionId: "session-existing",
          status: "running",
          runtimeKind: "opencode",
        },
        {
          modelCatalog: createRuntimeCatalog({
            ...OPENCODE_RUNTIME_DESCRIPTOR,
            capabilities: {
              ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
              sessionLifecycle: {
                ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.sessionLifecycle,
                supportsQueuedUserMessages: false,
              },
            },
          }),
        },
      ),
      runtimeDefinitions: [],
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

  test("onSend does not send while the loaded session is waiting for answers", async () => {
    const sendAgentMessage = mock(async () => {});
    const startAgentSession = mock(async () => sessionIdentity("session-new"));
    const draft = createComposerDraft("  hello world  ");

    const harness = createHookHarness({
      ...createBaseArgs(),
      ...selectedSessionArgs({
        externalSessionId: "session-existing",
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
      runSessionStartWorkflow: createRunSessionStartWorkflow({
        startAgentSession,
        sendAgentMessage,
      }),
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
      ...selectedSessionArgs({ externalSessionId: "session-existing" }),
      sendAgentMessage,
    });

    await harness.mount();
    let sendPromise: Promise<boolean | undefined> | undefined;
    await harness.run(async (state) => {
      sendPromise = state.onSend(draft);
    });
    await harness.waitFor(() => sendAgentMessage.mock.calls.length === 1, 1_000);
    expect(sendAgentMessage).toHaveBeenCalledWith(localSessionIdentity("session-existing"), [
      { kind: "text", text: "  hello world  " },
    ]);
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
      ...selectedSessionArgs({ externalSessionId: "session-existing" }),
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

  test("onSend allows path-backed attachments when the selected model descriptor supports them", async () => {
    const sendAgentMessage = mock(async () => {});
    const harness = createHookHarness({
      ...createBaseArgs(),
      ...selectedSessionArgs({ externalSessionId: "session-existing" }),
      selectedModelDescriptor: {
        id: "openai/gpt-5",
        providerId: "openai",
        providerName: "OpenAI",
        modelId: "gpt-5",
        modelName: "GPT-5",
        variants: ["default"],
        contextWindow: 200_000,
        outputLimit: 8_192,
        attachmentSupport: {
          image: false,
          audio: false,
          video: false,
          pdf: true,
        },
      },
      sendAgentMessage,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await expect(
        state.onSend(
          createAttachmentDraft({
            id: "pdf-attachment",
            name: "brief.pdf",
            kind: "pdf",
            mime: "application/pdf",
            path: "/tmp/brief.pdf",
          }),
        ),
      ).resolves.toBe(true);
    });

    expect(sendAgentMessage).toHaveBeenCalledWith(localSessionIdentity("session-existing"), [
      { kind: "text", text: "please review" },
      {
        kind: "attachment",
        attachment: {
          id: "pdf-attachment",
          name: "brief.pdf",
          kind: "pdf",
          mime: "application/pdf",
          path: "/tmp/brief.pdf",
        },
      },
    ]);

    await harness.unmount();
  });

  test("onSend blocks path-backed attachments when the selected model descriptor rejects them", async () => {
    const sendAgentMessage = mock(async () => {});
    const harness = createHookHarness({
      ...createBaseArgs(),
      ...selectedSessionArgs({ externalSessionId: "session-existing" }),
      selectedModelDescriptor: {
        id: "openai/gpt-5",
        providerId: "openai",
        providerName: "OpenAI",
        modelId: "gpt-5",
        modelName: "GPT-5",
        variants: ["default"],
        contextWindow: 200_000,
        outputLimit: 8_192,
        attachmentSupport: {
          image: false,
          audio: false,
          video: false,
          pdf: true,
        },
      },
      sendAgentMessage,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await expect(
        state.onSend(
          createAttachmentDraft({
            id: "image-attachment",
            name: "preview.png",
            kind: "image",
            mime: "image/png",
            path: "/tmp/preview.png",
          }),
        ),
      ).resolves.toBe(false);
    });

    expect(sendAgentMessage).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("resets transient sending state when switching task context", async () => {
    const sendDeferred = createDeferred<void>();
    const sendAgentMessage = mock(() => sendDeferred.promise);
    const taskOneDraft = createComposerDraft("  hello world  ");
    const taskOneSession = createSession({
      taskId: "task-1",
      externalSessionId: "session-task-1",
      status: "stopped",
    });
    const taskTwoSession = createSession({
      taskId: "task-2",
      externalSessionId: "session-task-2",
      status: "stopped",
    });

    const harness = createHookHarness({
      ...createBaseArgs(),
      selectedSession: selectedSessionFromSession(taskOneSession),
      sessionsForTask: summarizeSessions([taskOneSession]),
      sendAgentMessage,
    });

    await harness.mount();

    let sendPromise: Promise<boolean> | undefined;
    await harness.run((state) => {
      sendPromise = state.onSend(taskOneDraft);
    });

    await harness.waitFor((state) => state.isSending);
    expect(harness.getLatest().isSessionWorking).toBe(false);

    await harness.update({
      ...createBaseArgs(),
      taskId: "task-2",
      selectedSession: selectedSessionFromSession(taskTwoSession),
      sessionsForTask: summarizeSessions([taskTwoSession]),
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
      externalSessionId: "session-task-1",
      status: "stopped",
    });
    const taskTwoSession = createSession({
      taskId: "task-2",
      externalSessionId: "session-task-2",
      status: "stopped",
    });

    const harness = createHookHarness({
      ...createBaseArgs(),
      selectedSession: selectedSessionFromSession(taskOneSession),
      sessionsForTask: summarizeSessions([taskOneSession]),
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
      selectedSession: selectedSessionFromSession(taskTwoSession),
      sessionsForTask: summarizeSessions([taskTwoSession]),
      sendAgentMessage,
    });
    expect(harness.getLatest().isSending).toBe(false);

    await harness.update({
      ...createBaseArgs(),
      selectedSession: selectedSessionFromSession(taskOneSession),
      sessionsForTask: summarizeSessions([taskOneSession]),
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
      externalSessionId: "session-task-1",
      status: "stopped",
    });
    const taskTwoSession = createSession({
      taskId: "task-2",
      externalSessionId: "session-task-2",
      status: "stopped",
    });

    const harness = createHookHarness({
      ...createBaseArgs(),
      selectedSession: selectedSessionFromSession(taskOneSession),
      sessionsForTask: summarizeSessions([taskOneSession]),
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
      selectedSession: selectedSessionFromSession(taskTwoSession),
      sessionsForTask: summarizeSessions([taskTwoSession]),
      sendAgentMessage,
    });
    expect(harness.getLatest().isSending).toBe(false);

    await harness.update({
      ...createBaseArgs(),
      selectedSession: selectedSessionFromSession(taskOneSession),
      sessionsForTask: summarizeSessions([taskOneSession]),
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

  test("blocks fresh session creation while a loaded session send is in flight", async () => {
    const sendDeferred = createDeferred<void>();
    const sendAgentMessage = mock(() => sendDeferred.promise);
    const startAgentSession = mock(async () => sessionIdentity("session-new"));
    const loadedSession = createSession({
      externalSessionId: "session-existing",
      status: "stopped",
    });
    const harness = createHookHarness({
      ...createBaseArgs(),
      selectedSession: selectedSessionFromSession(loadedSession),
      sessionsForTask: summarizeSessions([loadedSession]),
      sendAgentMessage,
      runSessionStartWorkflow: createRunSessionStartWorkflow({
        startAgentSession,
        sendAgentMessage,
      }),
    });

    await harness.mount();
    let sendPromise: Promise<boolean> | undefined;
    await harness.run((state) => {
      sendPromise = state.onSend(createComposerDraft("hello world"));
    });
    await harness.waitFor((state) => state.isSending);
    expect(harness.getLatest().isSessionWorking).toBe(false);
    expect(harness.getLatest().canStopSession).toBe(false);

    await harness.run((state) => {
      state.handleCreateSession({
        id: "spec:spec_initial:fresh",
        launchActionId: "spec_initial",
        role: "spec",
        label: "Spec · Start Spec",
        description: "Create a new spec session from scratch",
        disabled: false,
      });
    });

    expect(startAgentSession).not.toHaveBeenCalled();

    await harness.run(async () => {
      sendDeferred.resolve();
      await sendPromise;
    });
    await harness.unmount();
  });

  test("keeps sending state while a newly created session becomes selected", async () => {
    const sendDeferred = createDeferred<void>();
    const sendAgentMessage = mock(() => sendDeferred.promise);
    const startAgentSession = mock(async () => sessionIdentity("session-new"));
    const draft = createComposerDraft("  hello world  ");
    const nextSession = createSession({
      taskId: "task-1",
      ...sessionIdentity("session-new"),
      role: "spec",
      status: "stopped",
    });

    const harness = createHookHarness({
      ...createBaseArgs(),
      runSessionStartWorkflow: createRunSessionStartWorkflow({
        startAgentSession,
        sendAgentMessage,
      }),
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
      selectedSession: selectedSessionFromSession(nextSession),
      sessionsForTask: summarizeSessions([nextSession]),
      runSessionStartWorkflow: createRunSessionStartWorkflow({
        startAgentSession,
        sendAgentMessage,
      }),
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

  test("onSend reuses loaded session when available", async () => {
    const sendAgentMessage = mock(async () => {});
    const updateCalls: Array<Record<string, string | undefined>> = [];
    const draft = createComposerDraft("  hello world  ");
    const existingSpecSession = createSession({
      runtimeKind: "opencode",
      externalSessionId: "session-existing",
      role: "spec",
    });

    const harness = createHookHarness({
      ...createBaseArgs(),
      selectedSession: selectedSessionFromSession(existingSpecSession),
      sessionsForTask: summarizeSessions([existingSpecSession]),
      sendAgentMessage,
      scheduleQueryUpdate: (updates) => {
        updateCalls.push(updates);
      },
    });

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(draft)).resolves.toBe(true);
    });

    expect(sendAgentMessage).toHaveBeenCalledWith(localSessionIdentity("session-existing"), [
      { kind: "text", text: "  hello world  " },
    ]);

    await harness.unmount();
  });

  test("session selection and workflow selection publish selected session state", async () => {
    const selectAgentStudioSelection = mock(() => {});
    const sessionTwo = createSession({ externalSessionId: "session-2", taskId: "task-2" });

    const harness = createHookHarness({
      ...createBaseArgs(),
      sessionsForTask: summarizeSessions([sessionTwo]),
      taskId: "task-2",
      selectAgentStudioSelection,
    });

    await harness.mount();
    const sessionTwoValue = agentSessionIdentityKey(sessionTwo);
    await harness.run((state) => {
      state.handleSessionSelectionChange(sessionTwoValue);
      state.handleWorkflowStepSelect("spec", sessionTwoValue);
    });

    expect(selectAgentStudioSelection).toHaveBeenCalledWith({
      taskId: "task-2",
      sessionExternalId: "session-2",
      sessionIdentity: toAgentSessionIdentity(sessionTwo),
      role: "spec",
      hasExplicitRoleSelection: true,
      keepSessionless: false,
    });

    await harness.unmount();
  });

  test("workflow selection without existing session switches role context", async () => {
    const selectAgentStudioSelection = mock(() => {});

    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "spec",
      sessionsForTask: [],
      selectAgentStudioSelection,
    });

    await harness.mount();
    await harness.run((state) => {
      state.handleWorkflowStepSelect("planner", null);
    });

    expect(selectAgentStudioSelection).toHaveBeenCalledWith({
      taskId: "task-1",
      sessionExternalId: null,
      sessionIdentity: null,
      role: "planner",
      hasExplicitRoleSelection: true,
      keepSessionless: true,
    });

    await harness.unmount();
  });

  test("submits question answers when session is active", async () => {
    const answerAgentQuestion = mock(async () => {});
    const questionRequest = {
      requestId: "req-1",
      questions: [
        {
          header: "Confirm",
          question: "Continue?",
          options: [{ label: "Yes", description: "Continue the session" }],
        },
      ],
    } satisfies AgentQuestionRequest;

    const harness = createHookHarness({
      ...createBaseArgs(),
      ...selectedSessionArgs({
        externalSessionId: "session-9",
        pendingQuestions: [questionRequest],
      }),
      answerAgentQuestion,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await state.onSubmitQuestionAnswers("req-1", [["yes"]]);
    });

    expect(answerAgentQuestion).toHaveBeenCalledWith(
      localSessionIdentity("session-9"),
      questionRequest,
      [["yes"]],
    );

    await harness.unmount();
  });

  test("replies to approval requests when session is active", async () => {
    const replyAgentApproval = mock(async () => {});
    const approvalRequest = {
      requestId: "approval-1",
      requestType: "permission_grant",
      title: "Approve command",
      mutation: "mutating",
      supportedReplyOutcomes: ["approve_once", "reject"],
    } satisfies AgentApprovalRequest;

    const harness = createHookHarness({
      ...createBaseArgs(),
      ...selectedSessionArgs({
        externalSessionId: "session-approval",
        pendingApprovals: [approvalRequest],
      }),
      replyAgentApproval,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await state.onReplyApproval("approval-1", "approve_once");
    });

    expect(replyAgentApproval).toHaveBeenCalledWith(
      localSessionIdentity("session-approval"),
      approvalRequest,
      "approve_once",
      undefined,
    );

    await harness.unmount();
  });

  test("handleCreateSession does not switch query before creating another session for the same role", async () => {
    const deferredStart = createDeferred<ReturnType<typeof sessionIdentity>>();
    const startAgentSession = mock(async () => deferredStart.promise);
    const sendAgentMessage = mock(async () => {});
    const updateCalls: Array<Record<string, string | undefined>> = [];

    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "spec",
      ...selectedSessionArgs({ externalSessionId: "session-spec", role: "spec" }),
      selectedTask: createTask(),
      runSessionStartWorkflow: createRunSessionStartWorkflow({
        startAgentSession,
        sendAgentMessage,
      }),
      sendAgentMessage,
      scheduleQueryUpdate: (updates) => {
        updateCalls.push(updates);
      },
    });

    try {
      await harness.mount();
      await harness.run((state) => {
        state.handleCreateSession({
          id: "spec:spec_initial:fresh",
          launchActionId: "spec_initial",
          role: "spec",
          label: "Spec · Start Spec",
          description: "Create a new spec session from scratch",
          disabled: false,
        });
      });

      expect(updateCalls).toEqual([]);
    } finally {
      deferredStart.resolve(sessionIdentity("session-spec-fresh"));
      await harness.unmount();
    }
  });

  test("does not expose kickoff for message-only rebase conflict launch action", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "build",
      launchActionId: "build_rebase_conflict_resolution",
      selectedTask: createTask(),
      sessionsForTask: [],
    });

    await harness.mount();

    expect(harness.getLatest().canUseKickoffPrompt).toBe(false);

    await harness.unmount();
  });

  test("keeps kickoff available for build launch actions with kickoff prompts", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "build",
      launchActionId: "build_after_human_request_changes",
      selectedTask: createTask({ status: "human_review" }),
      sessionsForTask: [],
    });

    await harness.mount();

    expect(harness.getLatest().canUseKickoffPrompt).toBe(true);

    await harness.unmount();
  });

  test("selection actions ignore invalid session ids without mutating selection state", async () => {
    const selectAgentStudioSelection = mock(() => {});
    const harness = createCoreHookHarness(useAgentStudioSelectionActions, {
      taskId: "task-1",
      sessionsForTask: summarizeSessions([createSession({ externalSessionId: "session-1" })]),
      canPrepareMessageFirstSession: () => true,
      selectAgentStudioSelection,
    });

    await harness.mount();
    await harness.run((state) => {
      state.handleSessionSelectionChange("missing-session");
    });

    expect(selectAgentStudioSelection).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("selection actions apply selected session identity", async () => {
    const selectAgentStudioSelection = mock(() => {});
    const session = createSession({ externalSessionId: "session-1", role: "spec" });
    const harness = createCoreHookHarness(useAgentStudioSelectionActions, {
      taskId: "task-1",
      sessionsForTask: summarizeSessions([session]),
      canPrepareMessageFirstSession: () => true,
      selectAgentStudioSelection,
    });

    await harness.mount();
    await harness.run((state) => {
      state.handleSessionSelectionChange(agentSessionIdentityKey(session));
    });

    expect(selectAgentStudioSelection).toHaveBeenCalledWith({
      taskId: "task-1",
      sessionExternalId: "session-1",
      sessionIdentity: toAgentSessionIdentity(session),
      role: "spec",
      hasExplicitRoleSelection: true,
      keepSessionless: false,
    });

    await harness.unmount();
  });

  test("selection actions publish local selection immediately", async () => {
    const selections: unknown[] = [];
    const session = createSession({ externalSessionId: "session-1", role: "spec" });
    const harness = createCoreHookHarness(useAgentStudioSelectionActions, {
      taskId: "task-1",
      sessionsForTask: summarizeSessions([session]),
      canPrepareMessageFirstSession: () => true,
      selectAgentStudioSelection: (selection) => {
        selections.push(selection);
      },
    });

    await harness.mount();
    await harness.run((state) => {
      state.handleSessionSelectionChange(agentSessionIdentityKey(session));
    });
    expect(selections).toEqual([
      {
        taskId: "task-1",
        sessionExternalId: "session-1",
        sessionIdentity: toAgentSessionIdentity(session),
        role: "spec",
        hasExplicitRoleSelection: true,
        keepSessionless: false,
      },
    ]);

    selections.length = 0;
    await harness.run((state) => {
      state.handleWorkflowStepSelect("planner", null);
    });
    expect(selections).toEqual([
      {
        taskId: "task-1",
        sessionExternalId: null,
        sessionIdentity: null,
        role: "planner",
        hasExplicitRoleSelection: true,
        keepSessionless: true,
      },
    ]);

    await harness.unmount();
  });
});
