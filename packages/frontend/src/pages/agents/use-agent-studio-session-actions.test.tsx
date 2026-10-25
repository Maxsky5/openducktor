import type { AgentStudioQueryUpdate } from "./query-sync/agent-studio-navigation";
import { createSessionStartWorkflowRunner } from "@/test-utils/workflow-launch-client";
import { AgentChatSendProviders } from "@/test-utils/agent-chat-send-providers";
import type { AgentChatSendResult } from "@/components/features/agents/agent-chat/agent-chat-send-result";
import { describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR, repoConfigSchema } from "@openducktor/contracts";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import {
  type AgentChatComposerDraft,
  createComposerAttachment,
  createSlashCommandSegment,
  createTextSegment,
} from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import {
  agentSessionIdentityKey,
  toAgentSessionIdentity,
} from "@openducktor/frontend-core/lib/agent-session-identity";
import { QueryProvider } from "@/test-utils/query-provider";
import { toAgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import {
  ChecksOperationsContext,
  ChecksStateContext,
  RuntimeDefinitionsContext,
} from "@/state/app-state-contexts";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { type HostClient, HostInvokeError } from "@openducktor/host-client";
import { createHookHarness as createCoreHookHarness } from "@openducktor/frontend-core/test-support/react-hook-harness";
import {
  type AgentSessionFixtureOverrides,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import type {
  AgentApprovalRequest,
  AgentChatMessage,
  AgentQuestionRequest,
  AgentSessionIdentity,
} from "@openducktor/frontend-core/types/agent-orchestrator";
import {
  createAgentSessionFixture,
  createChecksStateContextValue,
  createDeferred,
  createRuntimeDefinitionsContextValue,
  createTaskCardFixture,
  createTaskStoreCheckFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioSelectionActions } from "./session-actions/use-agent-studio-selection-actions";
import { deriveSelectedSessionViewProjection } from "./selected-session/selected-session-view-projection";
import { useAgentStudioSessionActions } from "./use-agent-studio-session-actions";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioSessionActions>[0];

const createSessionRuntimeData = (
  overrides: Partial<HookArgs["selectedSession"]["runtimeData"]> = {},
): HookArgs["selectedSession"]["runtimeData"] => ({
  modelCatalog: null,
  todos: [],
  isLoadingModelCatalog: false,
  catalogError: null,
  todosError: null,
  runtimePolicyError: null,
  contextError: null,
  ...overrides,
});

const createTask = (overrides = {}) => createTaskCardFixture(overrides);

const createComposerDraft = (text: string): AgentChatComposerDraft => ({
  segments: [createTextSegment(text)],
  attachments: [],
});

const REUSABLE_PROMPT_COMMAND = {
  id: "reusable-prompt:prompt-1",
  trigger: "review",
  title: "review",
  description: "Review context",
  source: "custom" as const,
  hints: [],
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

const createSession = (overrides: AgentSessionFixtureOverrides = {}) =>
  createAgentSessionFixture(overrides);
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
    workspaceId: "workspace-1",
    startAgentSession: async () => sessionIdentity("session-new"),
    sendAgentMessage: async () => null,
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
  sessionAuxiliaryError: null,
  preparation: { ready: true, error: null },
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

const TEST_RUNTIME_DEFINITIONS = [OPENCODE_RUNTIME_DESCRIPTOR];

const createTestRuntimeDefinitionsContextValue = () =>
  createRuntimeDefinitionsContextValue({
    runtimeDefinitions: TEST_RUNTIME_DEFINITIONS,
    availableRuntimeDefinitions: TEST_RUNTIME_DEFINITIONS,
    refreshRuntimeDefinitions: async () => TEST_RUNTIME_DEFINITIONS,
    loadRepoRuntimeCatalog: async () => ({
      models: {
        status: "available",
        catalog: {
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
        },
      },
    }),
  });

const createSessionActionsHostClient = (): Partial<HostClient> => ({
  workspaceGetRepoConfig: async () =>
    repoConfigSchema.parse({
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      promptOverrides: {},
    }),
  workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
});

const createHookWrapper = () => {
  const connection = createTestClientConnection({ client: createSessionActionsHostClient() });
  const checksStateContextValue = createChecksStateContextValue();
  const wrapper = ({ children }: PropsWithChildren): ReactElement =>
    createElement(
      ChecksOperationsContext.Provider,
      {
        value: {
          refreshTaskStoreCheckForRepo: async () => createTaskStoreCheckFixture(),
        },
      },
      createElement(
        QueryProvider,
        { connection },
        createElement(
          ChecksStateContext.Provider,
          { value: checksStateContextValue },
          createElement(
            RuntimeDefinitionsContext.Provider,
            { value: createTestRuntimeDefinitionsContextValue() },
            createElement(AgentChatSendProviders, null, children),
          ),
        ),
      ),
    );

  return wrapper;
};

const createHookHarness = (initialProps: HookArgs) =>
  createCoreHookHarness(useAgentStudioSessionActions, initialProps, {
    wrapper: createHookWrapper(),
  });

const createBaseArgs = (): HookArgs => {
  return {
    activeWorkspaceId: "workspace-1",
    workspaceRepoPath: "/repo",
    favoriteState: {
      favorites: [],
      isLoading: false,
      readError: null,
      isMutationPending: false,
      mutationError: null,
      canMutate: false,
      toggleFavorite: () => {},
      retryRead: () => {},
      retryMutation: () => {},
    },
    taskId: "task-1",
    role: "spec",
    launchActionId: "spec_initial",
    selectedSession: createSelectedSessionState(),
    runtimeDefinitions: TEST_RUNTIME_DEFINITIONS,
    selectedModelDescriptor: null,
    isSelectionCatalogLoading: false,
    supportsAttachments: true,
    sessionsForTask: [],
    selectedTask: createTask(),

    assertCanPrepareSession: () => {},
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
    repoSettings: {
      worktreeBasePath: "",
      branchPrefix: "task/",
      defaultModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "",
        profileId: "",
      },
      defaultTargetBranch: { remote: "origin", branch: "main" },
      postCompleteHooks: [],
      actions: { items: [], defaultActionId: null },
      worktreeCopyPaths: [],
      agentDefaults: { spec: null, planner: null, build: null, qa: null },
    },
    runSessionStartWorkflow: createRunSessionStartWorkflow(),
    sendAgentMessage: async () => null,
    continueInterruptedTurn: async () => undefined,
    replyAgentApproval: async () => {},
    answerAgentQuestion: async () => {},
    scheduleQueryUpdate: () => {},
    selectAgentStudioSelection: () => {},
  };
};

describe("useAgentStudioSessionActions", () => {
  test("keeps Stop available after an unconfirmed termination", async () => {
    const unavailableReason = "Claude termination is unconfirmed. Retry Stop.";
    const session = createSession({
      runtimeKind: "claude",
      status: "running",
      foregroundTurnActive: false,
      statusUnavailableReason: unavailableReason,
    });
    const selectedSession = {
      ...selectedSessionFromSession(session),
      ...deriveSelectedSessionViewProjection({
        selectedSessionIdentity: toAgentSessionIdentity(session),
        session,
        sessionSummary: null,
        selectedTask: null,
        sessionFault: null,
        readModelLoadState: { kind: "ready", workspaceRepoPath: "/repo" },
        runtimeReadinessState: "ready",
      }),
    };
    const harness = createHookHarness({ ...createBaseArgs(), selectedSession });
    try {
      await harness.mount();
      expect(selectedSession.activityState).toBeNull();
      expect(selectedSession.sessionAuxiliaryError).toBe(unavailableReason);
      expect(harness.getLatest().isSessionWorking).toBe(false);
      expect(harness.getLatest().canStopSession).toBe(true);
    } finally {
      await harness.unmount();
    }
  });

  test("shows the host reason and next action when the runtime refuses a continuation", async () => {
    const failure = new HostInvokeError("Continuation refused", {
      kind: "agent_session_resume",
      agentSessionResumeFailure: {
        reason: "completed_turn",
        sessionRef: {
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        },
        operation: "agent-session.continue-interrupted-turn",
        message: "OpenCode session 'session-1' has a completed latest turn.",
        nextAction: "Send a new message to start new work.",
      },
    });
    const harness = createHookHarness({
      ...createBaseArgs(),
      ...selectedSessionArgs(),
      continueInterruptedTurn: async () => {
        throw failure;
      },
    });

    try {
      await harness.mount();
      await harness.run((state) => {
        state.onResumeSession();
      });
      await harness.waitFor(() => harness.getLatest().resumeSessionError !== null);

      expect(harness.getLatest().resumeSessionError).toBe(
        "OpenCode session 'session-1' has a completed latest turn. Send a new message to start new work.",
      );
      expect(harness.getLatest().isResumingSession).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps an unconfirmed continuation failure for the chat surface", async () => {
    const failure = new HostInvokeError("Continuation unconfirmed", {
      kind: "agent_session_resume",
      agentSessionResumeFailure: {
        reason: "runtime_unavailable",
        sessionRef: {
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        },
        operation: "agent-session.continue-interrupted-turn",
        message: "The runtime did not confirm the continuation.",
        nextAction: "Inspect the runtime and this session.",
      },
    });
    const harness = createHookHarness({
      ...createBaseArgs(),
      ...selectedSessionArgs(),
      continueInterruptedTurn: async () => {
        throw failure;
      },
    });

    try {
      await harness.mount();
      await harness.run((state) => {
        state.onResumeSession();
      });
      await harness.waitFor(() => harness.getLatest().persistentResumeError !== null);

      expect(harness.getLatest().persistentResumeError).toBe(
        "The runtime did not confirm the continuation. Inspect the runtime and this session.",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("clears an unconfirmed continuation failure when the selected transcript settles", async () => {
    const failure = new HostInvokeError("Continuation unconfirmed", {
      kind: "agent_session_resume",
      agentSessionResumeFailure: {
        reason: "runtime_unavailable",
        sessionRef: {
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        },
        operation: "agent-session.continue-interrupted-turn",
        message: "The runtime did not confirm the continuation.",
        nextAction: "Inspect the runtime and this session.",
      },
    });
    const userMessage: AgentChatMessage = {
      id: "user-1",
      role: "user",
      content: "Continue please",
      timestamp: "2026-09-12T10:00:00.000Z",
    };
    const finalAssistantMessage: AgentChatMessage = {
      id: "assistant-1",
      role: "assistant",
      content: "Done",
      timestamp: "2026-09-12T10:01:00.000Z",
      meta: { kind: "assistant", isFinal: true },
    };
    const args = {
      ...createBaseArgs(),
      ...selectedSessionArgs({
        externalSessionId: "session-1",
        messages: [userMessage],
      }),
      continueInterruptedTurn: async () => {
        throw failure;
      },
    };
    const harness = createHookHarness(args);

    try {
      await harness.mount();
      await harness.run((state) => {
        state.onResumeSession();
      });
      await harness.waitFor(() => harness.getLatest().persistentResumeError !== null);

      await harness.update({
        ...args,
        ...selectedSessionArgs({
          externalSessionId: "session-1",
          messages: [userMessage, finalAssistantMessage],
        }),
      });

      await harness.waitFor(() => harness.getLatest().persistentResumeError === null);
      expect(harness.getLatest().resumeSessionError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("blocks a second resume selection before the first one renders", async () => {
    let resolveContinuation = (): void => {};
    const continueInterruptedTurn = mock(
      () =>
        new Promise<void>((resolve) => {
          resolveContinuation = resolve;
        }),
    );
    const harness = createHookHarness({
      ...createBaseArgs(),
      ...selectedSessionArgs(),
      continueInterruptedTurn,
    });

    try {
      await harness.mount();
      await harness.run((state) => {
        state.onResumeSession();
        state.onResumeSession();
      });

      expect(continueInterruptedTurn).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().isResumingSession).toBe(true);

      resolveContinuation();
      await harness.waitFor(() => harness.getLatest().isResumingSession === false);
      expect(continueInterruptedTurn).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("Prepare keeps a draft and first Send creates a fresh Builder with the chosen model", async () => {
    const scheduleQueryUpdate = mock(() => {});
    const selectAgentStudioSelection = mock(() => {});
    const createdSession: AgentSessionIdentity = {
      externalSessionId: "session-new",
      runtimeKind: "codex",
      workingDirectory: "/repo/worktrees/task-1",
    };
    const startAgentSession = mock(async () => createdSession);
    const sendAgentMessage = mock<HookArgs["sendAgentMessage"]>(async () => null);
    const existingSession = createSession({
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
      externalSessionId: "builder-old",
    });
    const initialArgs: HookArgs = {
      ...createBaseArgs(),
      role: "build",
      launchActionId: "build_after_qa_rejected",
      agentStudioReady: false,
      selectedTask: createTask({
        status: "in_progress",
        artifactSummary: { qaReport: { has: true, verdict: "rejected" } },
      }),
      selectedSession: selectedSessionFromSession(existingSession),
      sessionsForTask: summarizeSessions([existingSession]),
      scheduleQueryUpdate,
      selectAgentStudioSelection,
      runSessionStartWorkflow: createRunSessionStartWorkflow({
        startAgentSession,
        sendAgentMessage,
      }),
      sendAgentMessage,
    };
    const harness = createHookHarness(initialArgs);

    await harness.mount();
    try {
      await harness.run((state) => {
        state.handlePrepareMessageFirstSession({
          id: "build:build_after_qa_rejected:message_first",
          role: "build",
          launchActionId: "build_after_qa_rejected",
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
      expect(harness.getLatest().sessionStartModal).toBeNull();

      const selectedModel = {
        runtimeKind: "codex" as const,
        providerId: "openai",
        modelId: "gpt-5-codex",
        variant: "high",
        profileId: "build",
        speed: "fast",
      };
      const draftArgs: HookArgs = {
        ...initialArgs,
        agentStudioReady: true,
        selectedSession: createSelectedSessionState({ preparation: { ready: false, error: null } }),
        selectionForNewSession: selectedModel,
      };
      await harness.update(draftArgs);
      await harness.run(async (state) => {
        expect(
          await state.messageDelivery.onSend(
            createComposerDraft("Please fix the QA issues."),
            "default",
          ),
        ).toBe(true);
      });

      expect(harness.getLatest().sessionStartModal).toBeNull();
      expect(startAgentSession).toHaveBeenCalledTimes(1);
      expect(startAgentSession).toHaveBeenCalledWith({
        taskId: "task-1",
        role: "build",
        startMode: "fresh",
        selectedModel,
      });
      expect(sendAgentMessage).toHaveBeenCalledTimes(1);
      expect(sendAgentMessage.mock.calls[0]).toEqual([
        createdSession,
        [{ kind: "text", text: "Please fix the QA issues." }],
      ]);
      expect(scheduleQueryUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ session: "session-new", agent: "build" }),
      );

      await harness.update({
        ...draftArgs,
        selectedSession: selectedSessionFromIdentity(createdSession),
      });
      await harness.run(async (state) => {
        expect(
          await state.messageDelivery.onSend(createComposerDraft("One more detail."), "default"),
        ).toBe(true);
      });
      expect(startAgentSession).toHaveBeenCalledTimes(1);
      expect(sendAgentMessage).toHaveBeenCalledTimes(2);
      expect(sendAgentMessage.mock.calls[1]?.[0]).toEqual(createdSession);
    } finally {
      await harness.unmount();
    }
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

  test("request changes quick action submits feedback and mutation intent to the host", async () => {
    let submitted: import("@openducktor/contracts").WorkflowLaunchRequest | undefined;
    const calls: string[] = [];
    const startAgentSession = mock(async () => {
      calls.push("start-session");
      return sessionIdentity("builder-rework-session");
    });
    const sendAgentMessage = mock(async () => null);
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
      runSessionStartWorkflow: createRunSessionStartWorkflow({
        startAgentSession,
        sendAgentMessage,
        onRequest: (request) => {
          submitted = request;
        },
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
      state.sessionStartModal?.onSelectModelPair({
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
      });
      state.sessionStartModal?.onSelectRuntimeProfile("build");
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
    expect(submitted?.beforeStartAction).toEqual({
      action: "human_request_changes",
      note: "Please address the review comments.",
    });
    expect(submitted?.instruction).toMatchObject({
      kind: "kickoff",
      feedback: "Please address the review comments.",
    });
    expect(calls).toEqual(["start-session"]);
    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-1", role: "build", startMode: "fresh" }),
    );

    await harness.unmount();
  });

  test("keeps an unsent first message in the created session for the next Send", async () => {
    const createdSession = sessionIdentity("session-new");
    const startAgentSession = mock(async () => createdSession);
    const failure = new Error("The runtime refused the first message.");
    const sendAgentMessage = mock<HookArgs["sendAgentMessage"]>(async () => null);
    sendAgentMessage.mockRejectedValueOnce(failure);
    const scheduleQueryUpdate = mock(() => {});
    const args: HookArgs = {
      ...createBaseArgs(),
      selectedSession: createSelectedSessionState({ preparation: { ready: false, error: null } }),
      runSessionStartWorkflow: createRunSessionStartWorkflow({
        startAgentSession,
        sendAgentMessage,
      }),
      sendAgentMessage,
      scheduleQueryUpdate,
    };
    const harness = createHookHarness(args);
    const draft = createComposerDraft("Keep this first message.");
    try {
      await harness.mount();
      await harness.run(async (state) => {
        expect(await state.messageDelivery.onSend(draft, "default")).toMatchObject({
          kind: "recover_draft",
          originKey: "workspace-1:task-1:spec:new",
          recoveryKey:
            "workspace-1:task-1:spec:session-new|opencode|%2Frepo%2Fworktrees%2Fsession-new",
          error: expect.objectContaining({ message: failure.message }),
          inAppFeedbackHandled: true,
        });
      });
      expect(startAgentSession).toHaveBeenCalledTimes(1);
      expect(sendAgentMessage).toHaveBeenCalledTimes(1);
      expect(scheduleQueryUpdate).toHaveBeenCalledWith({
        task: "task-1",
        session: "session-new",
        agent: "spec",
      });

      await harness.update({
        ...args,
        selectedSession: selectedSessionFromIdentity(createdSession),
      });
      await harness.run(async (state) => {
        expect(await state.messageDelivery.onSend(draft, "default")).toBe(true);
      });
      expect(startAgentSession).toHaveBeenCalledTimes(1);
      expect(sendAgentMessage).toHaveBeenCalledTimes(2);
      expect(sendAgentMessage.mock.calls[1]?.[0]).toEqual(createdSession);
    } finally {
      await harness.unmount();
    }
  });

  test("onSend reuses loaded session when one exists", async () => {
    const sendAgentMessage = mock(async () => null);
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
      await state.messageDelivery.onSend(draft, "default");
    });

    expect(startAgentSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).toHaveBeenCalledWith(
      localSessionIdentity("session-existing"),
      [{ kind: "text", text: "  hello world  " }],
      expect.objectContaining({ mode: "default", assertCanSubmit: expect.any(Function) }),
    );

    await harness.unmount();
  });

  test("onSend targets the selected session while the session state has not loaded it yet", async () => {
    const selectedSessionIdentity = sessionIdentity("session-selected");
    const sendAgentMessage = mock(async () => null);
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
      await expect(state.messageDelivery.onSend(draft, "default")).resolves.toBe(true);
    });

    expect(startAgentSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).toHaveBeenCalledWith(
      selectedSessionIdentity,
      [{ kind: "text", text: "  selected-session follow-up  " }],
      expect.objectContaining({ mode: "default", assertCanSubmit: expect.any(Function) }),
    );

    await harness.unmount();
  });

  test("onSend reports when a reusable prompt command is stale", async () => {
    const sendAgentMessage = mock(async () => null);
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
      await expect(state.messageDelivery.onSend(draft, "default")).rejects.toThrow(
        'Reusable prompt "review" is no longer available.',
      );
    });

    expect(sendAgentMessage).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("onSend does not send while the loaded session is waiting for answers", async () => {
    const sendAgentMessage = mock(async () => null);
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
      await expect(state.messageDelivery.onSend(draft, "default")).resolves.toBe(false);
    });

    expect(startAgentSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(harness.getLatest().isWaitingInput).toBe(true);
    expect(harness.getLatest().canStopSession).toBe(false);

    await harness.unmount();
  });

  test("onSend marks the context as sending until the send settles", async () => {
    const sendDeferred = createDeferred<void>();
    const sendAgentMessage = mock(() => sendDeferred.promise.then(() => null));
    const draft = createComposerDraft("  hello world  ");

    const harness = createHookHarness({
      ...createBaseArgs(),
      ...selectedSessionArgs({ externalSessionId: "session-existing" }),
      sendAgentMessage,
    });

    await harness.mount();
    let sendPromise: Promise<AgentChatSendResult | undefined> | undefined;
    await harness.run(async (state) => {
      sendPromise = state.messageDelivery.onSend(draft, "default");
    });
    await harness.waitFor(() => sendAgentMessage.mock.calls.length === 1, 1_000);
    expect(sendAgentMessage).toHaveBeenCalledWith(
      localSessionIdentity("session-existing"),
      [{ kind: "text", text: "  hello world  " }],
      expect.objectContaining({ mode: "default", assertCanSubmit: expect.any(Function) }),
    );
    expect(harness.getLatest().messageDelivery.isSending).toBe(true);

    await harness.run(async () => {
      sendDeferred.resolve();
      await sendPromise;
    });
    await harness.unmount();
  });

  test("onSend blocks path-backed attachments when the selected model descriptor rejects them", async () => {
    const sendAgentMessage = mock(async () => null);
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
        state.messageDelivery.onSend(
          createAttachmentDraft({
            id: "image-attachment",
            name: "preview.png",
            kind: "image",
            mime: "image/png",
            path: "/tmp/preview.png",
          }),
          "default",
        ),
      ).resolves.toBe(false);
    });

    expect(sendAgentMessage).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("blocks fresh session creation while a loaded session send is in flight", async () => {
    const sendDeferred = createDeferred<void>();
    const sendAgentMessage = mock(() => sendDeferred.promise.then(() => null));
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
    let sendPromise: Promise<AgentChatSendResult> | undefined;
    await harness.run((state) => {
      sendPromise = state.messageDelivery.onSend(createComposerDraft("hello world"), "default");
    });
    await harness.waitFor((state) => state.messageDelivery.isSending);
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

  test("session selection and workflow selection publish selected session state", async () => {
    const selectAgentStudioSelection = mock(() => {});
    const sessionTwo = createSession({
      externalSessionId: "session-2",
      sessionAssociation: { kind: "workflow", taskId: "task-2", role: "spec" },
    });

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
      { kind: "workflow", taskId: "task-1", role: "spec" },
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
    const sendAgentMessage = mock(async () => null);
    const updateCalls: AgentStudioQueryUpdate[] = [];

    const harness = createHookHarness({
      ...createBaseArgs(),
      role: "spec",
      ...selectedSessionArgs({
        externalSessionId: "session-spec",
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
      }),
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
    const session = createSession({
      externalSessionId: "session-1",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
    });
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
    const session = createSession({
      externalSessionId: "session-1",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
    });
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
