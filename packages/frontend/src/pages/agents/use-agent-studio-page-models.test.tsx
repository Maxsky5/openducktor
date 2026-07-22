import { beforeAll, describe, expect, mock, test } from "bun:test";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentChatModel } from "@/components/features/agents/agent-chat/agent-chat.types";
import { AgentChatComposer } from "@/components/features/agents/agent-chat/agent-chat-composer";
import {
  type AgentChatDraftScope,
  agentChatDraftScopeKey,
} from "@/components/features/agents/agent-chat/agent-chat-draft-scope";
import { AgentChatSettingsProvider } from "@/components/features/agents/agent-chat/agent-chat-settings-context";
import { createComposerDraft } from "@/components/features/agents/agent-chat/agent-chat-test-fixtures";
import { AgentChatThread } from "@/components/features/agents/agent-chat/agent-chat-thread";
import type { TaskDocumentState } from "@/components/features/task-details/use-task-documents";
import { getAgentSessionActivityStateFromSession } from "@/lib/agent-session-activity-state";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { toAgentSessionSummary } from "@/state/agent-sessions-store";
import { AgentSessionReadModelStateContext } from "@/state/app-state-contexts";
import { sessionMessageAt } from "@/test-utils/session-message-test-helpers";
import { createChatSettingsFixture } from "@/test-utils/shared-test-fixtures";
import type {
  AgentChatMessage,
  AgentSessionState,
  SessionMessagesState,
} from "@/types/agent-orchestrator";
import { readyAgentSessionReadModelLoadState } from "@/types/agent-session-read-model";
import {
  createAgentSessionFixture,
  createSelectedSessionTranscriptStateFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { ROLE_OPTIONS } from "./agents-page-constants";
import { buildRoleLabelByRole } from "./agents-page-view-model";
import {
  type AgentStudioSelectedSessionContextInput,
  buildAgentStudioSelectedSessionContext,
} from "./selected-session/selected-session-context";

type UseAgentStudioPageModelsHook =
  typeof import("./use-agent-studio-page-models")["useAgentStudioPageModels"];

enableReactActEnvironment();

type HookArgs = Parameters<UseAgentStudioPageModelsHook>[0];
const DEFAULT_SKILLS: HookArgs["modelSelection"]["skills"] = [];
const reloadSessionReadModel = () => undefined;

const draftScopeFixture = (taskId: string): AgentChatDraftScope => ({
  taskId,
  role: "planner",
  session: null,
});

type SelectedSessionTestCore = Omit<
  AgentStudioSelectedSessionContextInput,
  "documents" | "selectedSession" | "sessionActions" | "roleLabelByRole"
> & {
  activeTabValue: string;
  selectedSessionIdentity: AgentStudioSelectedSessionContextInput["selectedSession"]["identity"];
  selectedSessionActivityState: AgentStudioSelectedSessionContextInput["selectedSession"]["activityState"];
  selectedSessionModel: AgentStudioSelectedSessionContextInput["selectedSession"]["selectedModel"];
  loadedSession: AgentStudioSelectedSessionContextInput["selectedSession"]["loadedSession"];
  sessionRuntimeData: AgentStudioSelectedSessionContextInput["selectedSession"]["runtimeData"];
  transcriptState: AgentStudioSelectedSessionContextInput["selectedSession"]["transcriptState"];
};

type HookArgsOverrides = {
  selectedSessionCore?: Partial<SelectedSessionTestCore>;
  taskTabs?: Partial<HookArgs["taskTabs"]>;
  documents?: Partial<AgentStudioSelectedSessionContextInput["documents"]>;
  runtimeReadiness?: Partial<
    AgentStudioSelectedSessionContextInput["selectedSession"]["runtimeReadiness"]
  >;
  sessionActions?: Partial<HookArgs["sessionActions"]>;
  selectedSessionActions?: Partial<AgentStudioSelectedSessionContextInput["sessionActions"]>;
  modelSelection?: Partial<HookArgs["modelSelection"]>;
  selectedSessionContextUsage?: HookArgs["modelSelection"]["selectedSessionContextUsage"];
  chatSettings?: Partial<HookArgs["chatSettings"]>;
  composer?: Partial<HookArgs["composer"]>;
};

let useAgentStudioPageModels: UseAgentStudioPageModelsHook;

beforeAll(async () => {
  ({ useAgentStudioPageModels } = await import("./use-agent-studio-page-models"));
});

const createTask = () =>
  createTaskCardFixture({
    documentSummary: {
      spec: { has: true },
      plan: { has: false },
      qaReport: { has: false, verdict: "not_reviewed" },
    },
  });

type CreateSessionOverrides = Partial<Omit<AgentSessionState, "messages">> & {
  messages?: AgentChatMessage[] | SessionMessagesState;
};

const createSession = (
  externalSessionId = "external-1",
  legacyExternalSessionIdOrOverrides: string | CreateSessionOverrides = {},
  maybeOverrides: CreateSessionOverrides = {},
): AgentSessionState => {
  const overrides =
    typeof legacyExternalSessionIdOrOverrides === "string"
      ? { ...maybeOverrides, externalSessionId: legacyExternalSessionIdOrOverrides }
      : legacyExternalSessionIdOrOverrides;
  return createAgentSessionFixture({
    externalSessionId,
    status: "running",
    ...overrides,
  });
};

const summarizeSessions = (sessions: AgentSessionState[]) => sessions.map(toAgentSessionSummary);

const emptyRuntimeData = {
  modelCatalog: null,
  todos: [],
  isLoadingModelCatalog: false,
  error: null,
};

const createPendingApproval = (
  requestId = "perm-1",
  actionName = "shell",
  affectedPaths = ["bun test"],
) => ({
  requestId,
  requestType: "permission_grant" as const,
  title: `Approve permission: ${actionName}`,
  summary: `Approval request for ${actionName}.`,
  affectedPaths,
  action: { name: actionName },
  mutation: "mutating" as const,
  supportedReplyOutcomes: ["approve_once" as const, "approve_session" as const, "reject" as const],
});

const createPendingQuestion = (requestId = "question-1") => ({
  requestId,
  questions: [
    {
      header: "Question",
      question: "Need input",
      options: [{ label: "Reply", description: "Provide input" }],
    },
  ],
});

const createDocumentState = (markdown: string): TaskDocumentState => ({
  markdown,
  updatedAt: null,
  isLoading: false,
  error: null,
  loaded: true,
});

const createHookArgs = (overrides: HookArgsOverrides = {}): HookArgs => {
  const defaultSession = createSession();
  const sessionsForTask = overrides.selectedSessionCore?.sessionsForTask ?? [
    toAgentSessionSummary(defaultSession),
  ];
  const allSessionSummaries = overrides.selectedSessionCore?.allSessionSummaries ?? sessionsForTask;
  const loadedSession =
    overrides.selectedSessionCore?.loadedSession !== undefined
      ? overrides.selectedSessionCore.loadedSession
      : defaultSession;
  const selectedSessionIdentity =
    overrides.selectedSessionCore?.selectedSessionIdentity !== undefined
      ? overrides.selectedSessionCore.selectedSessionIdentity
      : loadedSession
        ? toAgentSessionIdentity(loadedSession)
        : null;
  const selectedSessionActivityState =
    overrides.selectedSessionCore?.selectedSessionActivityState !== undefined
      ? overrides.selectedSessionCore.selectedSessionActivityState
      : loadedSession
        ? getAgentSessionActivityStateFromSession(loadedSession)
        : null;
  const selectedSessionModel =
    overrides.selectedSessionCore?.selectedSessionModel !== undefined
      ? overrides.selectedSessionCore.selectedSessionModel
      : (loadedSession?.selectedModel ?? null);

  const selectedSessionCore: SelectedSessionTestCore = {
    activeTabValue: "task-1",
    taskId: "task-1",
    role: "spec",
    selectedTask: createTask(),
    hasActiveGitConflict: false,
    transcriptState: createSelectedSessionTranscriptStateFixture(),
    sessionRuntimeData: emptyRuntimeData,
    ...overrides.selectedSessionCore,
    allSessionSummaries,
    sessionsForTask,
    selectedSessionIdentity,
    selectedSessionActivityState,
    selectedSessionModel,
    loadedSession,
  };

  const taskTabs: HookArgs["taskTabs"] = {
    taskTabs: [{ taskId: "task-1", taskTitle: "Task 1", status: "idle", isActive: true }],
    availableTabTasks: [createTask()],
    isLoadingTasks: false,
    onSelectTab: () => {},
    onCreateTab: () => {},
    onCloseTab: () => {},
    onReorderTab: () => {},
    ...overrides.taskTabs,
  };
  const documents = {
    specDoc: createDocumentState("spec"),
    planDoc: createDocumentState(""),
    qaDoc: createDocumentState(""),
    ...overrides.documents,
  };
  const runtimeReadiness: AgentStudioSelectedSessionContextInput["selectedSession"]["runtimeReadiness"] =
    {
      state: "ready",
      message: null,
      isLoadingChecks: false,
      refreshChecks: async () => {},
      ...overrides.runtimeReadiness,
    };
  const sessionActions: HookArgs["sessionActions"] = {
    handleWorkflowStepSelect: () => {},
    handleSessionSelectionChange: () => {},
    handlePrepareMessageFirstSession: () => {},
    handleQuickAction: () => {},
    openTaskDetails: () => {},
    isStarting: false,
    isSending: false,
    isSessionWorking: true,
    isWaitingInput: false,
    busySendBlockedReason: null,
    canUseKickoffPrompt: false,
    kickoffLabel: "Start Spec",
    canStopSession: true,
    startLaunchKickoff: async () => {},
    onSend: async () => true,
    stopAgentSession: async () => {},
    ...overrides.sessionActions,
  };
  const selectedSessionActions: AgentStudioSelectedSessionContextInput["sessionActions"] = {
    isSessionWorking: sessionActions.isSessionWorking,
    onSubmitQuestionAnswers: async () => {},
    isSubmittingQuestionByRequestId: {},
    isSubmittingApprovalByRequestId: {},
    approvalReplyErrorByRequestId: {},
    onReplyApproval: async () => {},
    ...overrides.selectedSessionActions,
  };
  const modelSelection: HookArgs["modelSelection"] = {
    selectedModelSelection: null,
    isSelectionCatalogLoading: false,
    supportsSlashCommands: true,
    supportsFileSearch: true,
    supportsSkillReferences: false,
    supportsSubagentReferences: false,
    slashCommandCatalog: { commands: [] },
    slashCommands: [],
    slashCommandsError: null,
    isSlashCommandsLoading: false,
    skillCatalog: null,
    skills: DEFAULT_SKILLS,
    skillsError: null,
    isSkillsLoading: false,
    subagentCatalog: null,
    subagents: [],
    subagentsError: null,
    isSubagentsLoading: false,
    searchFiles: async () => [],
    agentOptions: [{ value: "spec", label: "Spec" }],
    modelOptions: [],
    modelGroups: [],
    variantOptions: [],
    onSelectAgent: () => {},
    onSelectModel: () => {},
    onSelectVariant: () => {},
    agentAccentColorsByProfileId: {},
    selectedSessionContextUsage: overrides.selectedSessionContextUsage ?? {
      totalTokens: 12,
      contextWindow: 100,
    },
    ...overrides.modelSelection,
  };
  const chatSettings = createChatSettingsFixture(overrides.chatSettings);
  const composer = {
    workspaceId: "workspace-repo",
    draftScope: {
      taskId: selectedSessionCore.taskId,
      role: selectedSessionCore.role,
      session: selectedSessionCore.selectedSessionIdentity,
    },
    ...overrides.composer,
  };
  const selectedSession = {
    ...buildAgentStudioSelectedSessionContext({
      taskId: selectedSessionCore.taskId,
      role: selectedSessionCore.role,
      selectedTask: selectedSessionCore.selectedTask,
      sessionsForTask: selectedSessionCore.sessionsForTask,
      allSessionSummaries: selectedSessionCore.allSessionSummaries,
      selectedSession: {
        identity: selectedSessionCore.selectedSessionIdentity,
        activityState: selectedSessionCore.selectedSessionActivityState,
        selectedModel: selectedSessionCore.selectedSessionModel,
        loadedSession: selectedSessionCore.loadedSession,
        runtimeData: selectedSessionCore.sessionRuntimeData,
        runtimeReadiness,
        transcriptState: selectedSessionCore.transcriptState,
        sessionAuxiliaryError: null,
      },
      hasActiveGitConflict: selectedSessionCore.hasActiveGitConflict,
      documents,
      sessionActions: selectedSessionActions,
      roleLabelByRole: buildRoleLabelByRole(ROLE_OPTIONS),
    }),
  };

  return {
    activeTabValue: selectedSessionCore.activeTabValue,
    selectedSession,
    taskTabs,
    sessionActions,
    modelSelection,
    chatSettings,
    composer,
  };
};

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioPageModels, initialProps, {
    wrapper: ({ children }) =>
      createElement(
        AgentSessionReadModelStateContext.Provider,
        {
          value: {
            sessionReadModelLoadState: readyAgentSessionReadModelLoadState("/repo"),
            reloadSessionReadModel,
            getSessionFault: () => null,
          },
        },
        children,
      ),
  });

const createAgentChatThreadElement = (model: AgentChatModel) =>
  createElement(
    AgentChatSettingsProvider,
    { value: model.chatSettings },
    createElement(AgentChatThread, { model: model.thread }),
  );

describe("useAgentStudioPageModels", () => {
  test("keeps the interactive composer model available before a task is selected", async () => {
    const harness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          activeTabValue: "",
          taskId: "",
          selectedTask: null,
          sessionsForTask: [],
          loadedSession: null,
        },
      }),
    );

    await harness.mount();

    const state = harness.getLatest();
    expect(state.agentChatModel.composer.taskId).toBe("");
    expect(state.agentChatModel.thread.emptyState?.title).toBe("Select a task to begin.");

    await harness.unmount();
  });

  test("builds page models and forwards wrapper callbacks", async () => {
    const onRefreshChecks = mock(async () => {});
    const onKickoff = mock(async () => {});
    const onSend = mock(async () => true);
    const onStopSession = mock(async () => {});

    const harness = createHookHarness(
      createHookArgs({
        selectedSessionContextUsage: { totalTokens: 12, contextWindow: 100 },
        composer: {
          draftScope: draftScopeFixture("draft-message"),
        },
        runtimeReadiness: {
          refreshChecks: onRefreshChecks,
        },
        sessionActions: {
          onSend,
          stopAgentSession: onStopSession,
          startLaunchKickoff: onKickoff,
        },
      }),
    );

    await harness.mount();

    const state = harness.getLatest();
    expect(state.activeTabValue).toBe("task-1");
    expect(state.agentStudioTaskTabsModel.tabs).toHaveLength(1);
    expect(state.agentStudioHeaderModel.taskId).toBe("task-1");
    expect(state.agentChatModel.composer.contextUsage).toEqual({
      totalTokens: 12,
      contextWindow: 100,
    });
    expect(state.agentChatModel.composer.draftPersistenceIdentity).toEqual({
      workspaceId: "workspace-repo",
      externalSessionId: "external-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo",
    });
    expect(state.agentChatModel.thread.runtimeReadiness.state).toBe("ready");
    expect(state.agentChatModel.thread.isSessionWorking).toBe(true);
    expect(state.agentChatModel.chatSettings.showThinkingMessages).toBe(false);

    await state.agentChatModel.thread.runtimeReadiness.refreshChecks();
    await state.agentChatModel.composer.onSend(createComposerDraft("message"));
    state.agentChatModel.composer.onStopSession();

    expect(onRefreshChecks).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onStopSession).toHaveBeenCalledTimes(1);

    await harness.unmount();
  });

  test("keeps selected-session facts authoritative for the chat thread", async () => {
    const selectedSession = createSession("session-shared", {
      runtimeKind: "codex",
      workingDirectory: "/repo/selected-worktree",
      status: "running",
      selectedModel: {
        runtimeKind: "codex",
        providerId: "openai",
        modelId: "gpt-5-codex",
        profileId: "selected-builder",
      },
    });
    const staleLoadedSession = createSession("session-shared", {
      runtimeKind: "opencode",
      workingDirectory: "/repo/stale-worktree",
      status: "stopped",
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        profileId: "stale-builder",
      },
      messages: [
        {
          id: "message-1",
          role: "assistant",
          content: "Loaded messages still belong to the live transcript.",
          timestamp: "2026-02-22T10:00:00.000Z",
        },
      ],
    });
    const harness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          selectedSessionIdentity: toAgentSessionIdentity(selectedSession),
          selectedSessionActivityState: "running",
          selectedSessionModel: selectedSession.selectedModel,
          loadedSession: staleLoadedSession,
          sessionsForTask: summarizeSessions([selectedSession]),
          allSessionSummaries: summarizeSessions([selectedSession]),
        },
        modelSelection: {
          agentAccentColorsByProfileId: {
            "selected-builder": "#0ea5e9",
            "stale-builder": "#ef4444",
          },
        },
      }),
    );

    await harness.mount();

    const chatModel = harness.getLatest().agentChatModel;
    expect(chatModel.thread.session).toMatchObject({
      externalSessionId: "session-shared",
      runtimeKind: "codex",
      workingDirectory: "/repo/selected-worktree",
      activityState: "running",
    });
    expect(chatModel.thread.session?.messages.items[0]?.content).toContain(
      "Loaded messages still belong to the live transcript.",
    );
    expect(chatModel.thread.isSessionWorking).toBe(true);
    expect(chatModel.thread.sessionAccentColor).toBe("#0ea5e9");
    expect(chatModel.composer.accentColor).toBe("#0ea5e9");

    await harness.unmount();
  });

  test("preserves active Codex runtime identity for composer accent while catalog loads", async () => {
    const codexSession = createSession("session-codex", {
      runtimeKind: "codex",
      selectedModel: null,
    });
    const harness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          loadedSession: codexSession,
          sessionRuntimeData: {
            modelCatalog: null,
            todos: [],
            isLoadingModelCatalog: true,
            error: null,
          },
          sessionsForTask: [toAgentSessionSummary(codexSession)],
        },
        modelSelection: {
          selectedModelSelection: {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5.3-codex",
            profileId: "Ares (Legacy Agent)",
          },
          agentAccentColorsByProfileId: {
            "Ares (Legacy Agent)": "#f97316",
          },
          supportsProfiles: false,
        },
      }),
    );

    await harness.mount();

    const composer = harness.getLatest().agentChatModel.composer;
    expect(composer.accentColor).toBe("var(--odt-runtime-accent-codex)");

    const html = renderToStaticMarkup(createElement(AgentChatComposer, { model: composer }));
    expect(html).toContain("border-left-color:var(--odt-runtime-accent-codex)");

    await harness.unmount();
  });

  test("forwards session runtime data errors into the chat thread model", async () => {
    const harness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          sessionRuntimeData: {
            modelCatalog: null,
            todos: [],
            isLoadingModelCatalog: false,
            error: "todos unavailable",
          },
        },
      }),
    );

    await harness.mount();

    expect(harness.getLatest().agentChatModel.thread.sessionAuxiliaryError).toContain(
      "todos unavailable",
    );

    await harness.unmount();
  });

  test("scrolls to bottom immediately when sending a message", async () => {
    const sendResolver = { current: null as ((value: boolean) => void) | null };
    const onSend = mock(
      () =>
        new Promise<boolean>((resolve) => {
          sendResolver.current = resolve;
        }),
    );
    const scrollToBottomOnSend = mock(() => {});

    const harness = createHookHarness(
      createHookArgs({
        sessionActions: {
          onSend,
        },
      }),
    );

    await harness.mount();
    const state = harness.getLatest();
    state.agentChatModel.composer.scrollToBottomOnSendRef.current = scrollToBottomOnSend;

    let sendPromise: Promise<boolean> | null = null;
    await act(async () => {
      sendPromise = state.agentChatModel.composer.onSend(createComposerDraft("message"));
      await Promise.resolve();
    });

    expect(scrollToBottomOnSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledTimes(1);

    if (!sendResolver.current) {
      throw new Error("Expected pending send resolver");
    }
    sendResolver.current(true);
    await sendPromise;
    await harness.unmount();
  });

  test("keeps transcript visible while waiting for runtime readiness", async () => {
    const cachedSession = createSession("session-waiting", "external-waiting", {
      messages: [
        {
          id: "assistant-cached",
          role: "assistant",
          content: "Cached transcript",
          timestamp: "2026-02-22T08:00:05.000Z",
        },
      ],
    });
    const harness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          loadedSession: cachedSession,
          sessionsForTask: [toAgentSessionSummary(cachedSession)],
          transcriptState: createSelectedSessionTranscriptStateFixture({ kind: "visible" }),
        },
        runtimeReadiness: {
          state: "checking",
        },
      }),
    );

    await harness.mount();

    const thread = harness.getLatest().agentChatModel.thread;
    expect(thread.transcriptState).toEqual({ kind: "visible" });
    expect(thread.runtimeReadiness.state).toBe("checking");
    expect(thread.session ? sessionMessageAt(thread.session, 0)?.content : null).toBe(
      "Cached transcript",
    );

    await harness.unmount();
  });

  test("shows runtime loading instead of kickoff while selected session state is loading", async () => {
    const selectedSummary = toAgentSessionSummary(createSession("session-pending"));
    const harness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          loadedSession: null,
          sessionsForTask: [selectedSummary],
          allSessionSummaries: [selectedSummary],
          transcriptState: createSelectedSessionTranscriptStateFixture({ kind: "runtime_waiting" }),
        },
        runtimeReadiness: {
          state: "checking",
        },
        sessionActions: {
          canUseKickoffPrompt: true,
          kickoffLabel: "Start Spec",
        },
      }),
    );

    await harness.mount();

    const html = renderToStaticMarkup(
      createAgentChatThreadElement(harness.getLatest().agentChatModel),
    );
    expect(html).toContain("Runtime is starting");
    expect(html).not.toContain("Start Spec");

    await harness.unmount();
  });

  test("shows runtime loading instead of kickoff before selected session state is known", async () => {
    const harness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          loadedSession: null,
          sessionsForTask: [],
          allSessionSummaries: [],
          transcriptState: createSelectedSessionTranscriptStateFixture({ kind: "runtime_waiting" }),
        },
        runtimeReadiness: {
          state: "checking",
        },
        sessionActions: {
          canUseKickoffPrompt: true,
          kickoffLabel: "Start Spec",
        },
      }),
    );

    await harness.mount();

    const html = renderToStaticMarkup(
      createAgentChatThreadElement(harness.getLatest().agentChatModel),
    );
    expect(html).toContain("Runtime is starting");
    expect(html).not.toContain("Start Spec");

    await harness.unmount();
  });

  test("shows session loading instead of kickoff while session read model is resolving", async () => {
    const harness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          loadedSession: null,
          sessionsForTask: [],
          allSessionSummaries: [],
          transcriptState: createSelectedSessionTranscriptStateFixture({
            kind: "session_loading",
            reason: "preparing",
          }),
        },
        sessionActions: {
          canUseKickoffPrompt: true,
          kickoffLabel: "Start Spec",
        },
      }),
    );

    await harness.mount();

    const html = renderToStaticMarkup(
      createAgentChatThreadElement(harness.getLatest().agentChatModel),
    );
    expect(html).toContain("Loading session");
    expect(html).not.toContain("Start Spec");

    await harness.unmount();
  });

  test("does not mark session history loading during background history load when transcript can render", async () => {
    const cachedSession = createSession("session-history-loading", "external-history-loading", {
      messages: [
        {
          id: "assistant-cached",
          role: "assistant",
          content: "Cached transcript",
          timestamp: "2026-02-22T08:00:05.000Z",
        },
      ],
    });
    const harness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          loadedSession: cachedSession,
          sessionsForTask: summarizeSessions([cachedSession]),
          transcriptState: createSelectedSessionTranscriptStateFixture({ kind: "visible" }),
        },
      }),
    );

    await harness.mount();

    const thread = harness.getLatest().agentChatModel.thread;
    expect(thread.transcriptState).toEqual({ kind: "visible" });
    const html = renderToStaticMarkup(
      createAgentChatThreadElement(harness.getLatest().agentChatModel),
    );
    expect(html).toContain("Cached transcript");
    expect(html).not.toContain("Loading session");

    await harness.unmount();
  });

  test("renders Planner subagent waiting-input state", async () => {
    const plannerSession = createSession("session-planner", "external-planner", {
      role: "planner",
      runtimeKind: "opencode",
      workingDirectory: "/repo",
      messages: [
        {
          id: "subagent-message",
          role: "assistant",
          content: "",
          timestamp: "2026-02-22T08:00:05.000Z",
          meta: {
            kind: "subagent" as const,
            partId: "subtask-a",
            correlationKey: "part:assistant-message:subtask-a",
            agent: "explorer",
            description: "Read omp.json file",
            prompt: "Read omp.json file",
            status: "running" as const,
            externalSessionId: "external-child",
            startedAtMs: 1_000,
          },
        },
      ],
    });
    const childSession = createSession("session-child", "external-child", {
      taskId: "other-task",
      pendingApprovals: [createPendingApproval("perm-child")],
    });
    const harness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          role: "planner",
          loadedSession: plannerSession,
          sessionsForTask: [toAgentSessionSummary(plannerSession)],
          allSessionSummaries: [
            toAgentSessionSummary(plannerSession),
            toAgentSessionSummary(childSession),
          ],
        },
      }),
    );

    await harness.mount();

    const html = renderToStaticMarkup(
      createAgentChatThreadElement(harness.getLatest().agentChatModel),
    );
    expect(html).toContain("explorer");
    expect(html).toContain("Waiting for input");

    await harness.unmount();
  });

  test("marks session history loading while history load blocks transcript rendering", async () => {
    const pendingSession = createSession("session-pending", "external-pending", {
      messages: [],
    });
    const harness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          loadedSession: pendingSession,
          sessionsForTask: summarizeSessions([pendingSession]),
          transcriptState: createSelectedSessionTranscriptStateFixture({
            kind: "session_loading",
            reason: "history",
          }),
        },
      }),
    );

    await harness.mount();

    expect(harness.getLatest().agentChatModel.thread.transcriptState).toEqual({
      kind: "session_loading",
      reason: "history",
    });
    const html = renderToStaticMarkup(
      createAgentChatThreadElement(harness.getLatest().agentChatModel),
    );
    expect(html).toContain("Loading session");

    await harness.unmount();
  });

  test("selects role-specific sidebar document", async () => {
    const specSession = createSession("session-spec", "external-spec", { role: "spec" });
    const harness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          role: "spec",
          loadedSession: specSession,
          sessionsForTask: summarizeSessions([specSession]),
        },
        documents: {
          specDoc: createDocumentState("spec"),
          planDoc: createDocumentState(""),
          qaDoc: createDocumentState(""),
        },
      }),
    );
    await harness.mount();
    expect(harness.getLatest().taskExecutionDocumentPanelModel.activeDocument?.title).toBe(
      "Specification",
    );
    await harness.unmount();

    const plannerSession = createSession("session-planner", "external-planner", {
      role: "planner",
    });
    const plannerHarness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          role: "planner",
          loadedSession: plannerSession,
          sessionsForTask: summarizeSessions([plannerSession]),
        },
        documents: {
          specDoc: createDocumentState(""),
          planDoc: createDocumentState("plan"),
          qaDoc: createDocumentState(""),
        },
      }),
    );
    await plannerHarness.mount();
    expect(plannerHarness.getLatest().taskExecutionDocumentPanelModel.activeDocument?.title).toBe(
      "Implementation Plan",
    );
    await plannerHarness.unmount();

    const qaSession = createSession("session-qa", "external-qa", {
      role: "qa",
    });
    const qaHarness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          role: "qa",
          loadedSession: qaSession,
          sessionsForTask: summarizeSessions([qaSession]),
        },
        documents: {
          specDoc: createDocumentState(""),
          planDoc: createDocumentState(""),
          qaDoc: createDocumentState("qa"),
        },
      }),
    );
    await qaHarness.mount();
    expect(qaHarness.getLatest().taskExecutionDocumentPanelModel.activeDocument?.title).toBe(
      "QA Report",
    );
    await qaHarness.unmount();

    const buildSession = createSession("session-build", "external-build", { role: "build" });
    const buildHarness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          role: "build",
          loadedSession: buildSession,
          sessionsForTask: summarizeSessions([buildSession]),
        },
        documents: {
          specDoc: createDocumentState(""),
          planDoc: createDocumentState(""),
          qaDoc: createDocumentState(""),
        },
      }),
    );
    await buildHarness.mount();
    expect(buildHarness.getLatest().taskExecutionDocumentPanelModel.activeDocument).toBeNull();
    await buildHarness.unmount();
  });

  test("uses the resolved selected role to select the workspace document", async () => {
    const plannerSession = createSession("session-1", "external-1", {
      role: "planner",
    });
    const harness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          role: "planner",
          loadedSession: plannerSession,
          sessionsForTask: summarizeSessions([plannerSession]),
        },
        documents: {
          specDoc: createDocumentState("spec"),
          planDoc: createDocumentState("plan"),
          qaDoc: createDocumentState(""),
        },
      }),
    );

    await harness.mount();
    expect(harness.getLatest().taskExecutionDocumentPanelModel.activeDocument?.title).toBe(
      "Implementation Plan",
    );
    await harness.unmount();
  });

  test("keeps build workspace document selection aligned to the resolved selected role", async () => {
    const buildSession = createSession("session-build", "external-build", {
      role: "build",
    });
    const harness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          role: "build",
          loadedSession: buildSession,
          sessionsForTask: summarizeSessions([buildSession]),
        },
        documents: {
          specDoc: createDocumentState("spec"),
          planDoc: createDocumentState("plan"),
          qaDoc: createDocumentState("qa"),
        },
      }),
    );

    await harness.mount();
    expect(harness.getLatest().taskExecutionDocumentPanelModel.activeDocument).toBeNull();
    await harness.unmount();
  });

  test("keeps the header model stable across approval-only session changes", async () => {
    const approvalSession = createSession("session-1", "external-1", {
      status: "running",
      pendingApprovals: [
        {
          requestId: "p-1",
          requestType: "permission_grant" as const,
          title: `Approve permission: ${"shell"}`,
          summary: `Approval request for ${"shell"}.`,
          affectedPaths: ["rm -rf /tmp"],
          action: { name: "shell" },
          mutation: "mutating" as const,
          supportedReplyOutcomes: [
            "approve_once" as const,
            "approve_session" as const,
            "reject" as const,
          ],
        },
      ],
    });
    const harness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          loadedSession: approvalSession,
          sessionsForTask: summarizeSessions([approvalSession]),
        },
      }),
    );

    await harness.mount();
    const initialHeaderModel = harness.getLatest().agentStudioHeaderModel;

    const approvalSessionWithoutRequests = createSession("session-1", "external-1", {
      status: "running",
      pendingApprovals: [],
    });

    await harness.update(
      createHookArgs({
        selectedSessionCore: {
          loadedSession: approvalSessionWithoutRequests,
          sessionsForTask: summarizeSessions([approvalSessionWithoutRequests]),
        },
      }),
    );

    expect(harness.getLatest().agentStudioHeaderModel.workflowSteps[0]?.state.liveSession).toBe(
      "running",
    );
    expect(harness.getLatest().agentStudioHeaderModel).not.toBe(initialHeaderModel);
    await harness.unmount();
  });

  test("hides approval outcomes unsupported by the active runtime descriptor", async () => {
    const approvalSession = createSession("session-approval", "external-approval", {
      runtimeKind: "opencode",
      status: "running",
      pendingApprovals: [
        {
          requestId: "approval-turn",
          requestType: "runtime_tool" as const,
          title: "Approve runtime tool",
          summary: "Runtime asks for a turn-scoped tool approval.",
          tool: { name: "shell" },
          mutation: "mutating" as const,
          supportedReplyOutcomes: [
            "approve_once" as const,
            "approve_turn" as const,
            "reject" as const,
          ],
        },
      ],
    });
    const harness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          loadedSession: approvalSession,
          sessionsForTask: summarizeSessions([approvalSession]),
        },
      }),
    );

    await harness.mount();
    const html = renderToStaticMarkup(
      createAgentChatThreadElement(harness.getLatest().agentChatModel),
    );

    expect(html).toContain("Approve once");
    expect(html).toContain("Reject");
    expect(html).not.toContain("Approve for turn");
    expect(html).not.toContain("Approve for session");
    await harness.unmount();
  });

  test("tracks todo panel collapse state per loaded session identity", async () => {
    const sessionA = createSession("external-shared", {
      runtimeKind: "opencode",
      workingDirectory: "/repo/session-a",
    });
    const sessionB = createSession("external-shared", {
      runtimeKind: "codex",
      workingDirectory: "/repo/session-b",
    });
    const sharedOverrides: HookArgsOverrides = {
      selectedSessionCore: {},
      sessionActions: {
        isSessionWorking: false,
      },
      selectedSessionContextUsage: null,
    };

    const harness = createHookHarness(
      createHookArgs({
        ...sharedOverrides,
        selectedSessionCore: {
          ...sharedOverrides.selectedSessionCore,
          sessionsForTask: summarizeSessions([sessionA, sessionB]),
          loadedSession: sessionA,
        },
      }),
    );

    await harness.mount();
    expect(harness.getLatest().agentChatModel.thread.todoPanelCollapsed).toBe(true);

    await harness.run((state) => {
      state.agentChatModel.thread.onToggleTodoPanel();
    });
    expect(harness.getLatest().agentChatModel.thread.todoPanelCollapsed).toBe(false);

    await harness.update(
      createHookArgs({
        ...sharedOverrides,
        selectedSessionCore: {
          ...sharedOverrides.selectedSessionCore,
          sessionsForTask: summarizeSessions([sessionA, sessionB]),
          loadedSession: sessionB,
        },
      }),
    );
    expect(harness.getLatest().agentChatModel.thread.todoPanelCollapsed).toBe(true);

    await harness.run((state) => {
      state.agentChatModel.thread.onToggleTodoPanel();
    });
    expect(harness.getLatest().agentChatModel.thread.todoPanelCollapsed).toBe(false);

    await harness.update(
      createHookArgs({
        ...sharedOverrides,
        selectedSessionCore: {
          ...sharedOverrides.selectedSessionCore,
          sessionsForTask: summarizeSessions([sessionA, sessionB]),
          loadedSession: sessionA,
        },
      }),
    );
    expect(harness.getLatest().agentChatModel.thread.todoPanelCollapsed).toBe(false);

    await harness.unmount();
  });

  test("keeps thread model stable for input-only composer updates", async () => {
    const session = createSession("session-1", "external-1");
    const baseProps = createHookArgs({
      selectedSessionCore: {
        loadedSession: session,
        sessionsForTask: summarizeSessions([session]),
      },
      composer: {
        draftScope: draftScopeFixture("draft-empty"),
      },
    });
    const harness = createHookHarness(baseProps);

    await harness.mount();
    const initialState = harness.getLatest();
    const initialThreadModel = initialState.agentChatModel.thread;
    const initialComposerModel = initialState.agentChatModel.composer;

    await harness.update({
      ...baseProps,
      composer: {
        ...baseProps.composer,
        draftScope: draftScopeFixture("draft-update"),
      },
    });

    const nextState = harness.getLatest();
    expect(nextState.agentChatModel.thread).toBe(initialThreadModel);
    expect(nextState.agentChatModel.composer).not.toBe(initialComposerModel);
    expect(nextState.agentChatModel.composer.draftStateKey).toBe(
      agentChatDraftScopeKey(draftScopeFixture("draft-update")),
    );

    await harness.unmount();
  });

  test("keeps composer model stable for thread-only updates", async () => {
    const session = createSession("session-1", "external-1");
    const baseProps = createHookArgs({
      selectedSessionCore: {
        loadedSession: session,
        sessionsForTask: summarizeSessions([session]),
      },
      composer: {
        draftScope: draftScopeFixture("draft-thread-stable"),
      },
    });
    const harness = createHookHarness(baseProps);

    await harness.mount();
    const initialState = harness.getLatest();
    const initialThreadModel = initialState.agentChatModel.thread;
    const initialComposerModel = initialState.agentChatModel.composer;

    await harness.run((state) => {
      state.agentChatModel.thread.onToggleTodoPanel();
    });

    const nextState = harness.getLatest();
    expect(nextState.agentChatModel.thread).not.toBe(initialThreadModel);
    expect(nextState.agentChatModel.composer).toBe(initialComposerModel);
    expect(nextState.agentChatModel.thread.todoPanelCollapsed).toBe(false);

    await harness.unmount();
  });

  test("updates chat settings when showThinkingMessages changes without rebuilding thread or composer", async () => {
    const session = createSession("session-1", "external-1");
    const baseProps = createHookArgs({
      selectedSessionCore: {
        loadedSession: session,
        sessionsForTask: summarizeSessions([session]),
      },
      composer: {
        draftScope: draftScopeFixture("draft-thinking-toggle"),
      },
      chatSettings: createChatSettingsFixture(),
    });
    const harness = createHookHarness(baseProps);

    await harness.mount();
    const initialState = harness.getLatest();
    const initialThreadModel = initialState.agentChatModel.thread;
    const initialComposerModel = initialState.agentChatModel.composer;

    await harness.update({
      ...baseProps,
      chatSettings: createChatSettingsFixture({ showThinkingMessages: true }),
    });

    const nextState = harness.getLatest();
    expect(nextState.agentChatModel.thread).toBe(initialThreadModel);
    expect(nextState.agentChatModel.composer).toBe(initialComposerModel);
    expect(nextState.agentChatModel.chatSettings.showThinkingMessages).toBe(true);

    await harness.unmount();
  });

  test("updates chat settings when file diff expansion default changes without rebuilding thread or composer", async () => {
    const session = createSession("session-1", "external-1");
    const baseProps = createHookArgs({
      selectedSessionCore: {
        loadedSession: session,
        sessionsForTask: summarizeSessions([session]),
      },
      composer: {
        draftScope: draftScopeFixture("draft-diff-toggle"),
      },
      chatSettings: createChatSettingsFixture(),
    });
    const harness = createHookHarness(baseProps);

    await harness.mount();
    const initialState = harness.getLatest();
    const initialThreadModel = initialState.agentChatModel.thread;
    const initialComposerModel = initialState.agentChatModel.composer;

    await harness.update({
      ...baseProps,
      chatSettings: createChatSettingsFixture({ expandFileDiffsByDefault: false }),
    });

    const nextState = harness.getLatest();
    expect(nextState.agentChatModel.thread).toBe(initialThreadModel);
    expect(nextState.agentChatModel.composer).toBe(initialComposerModel);
    expect(nextState.agentChatModel.chatSettings.expandFileDiffsByDefault).toBe(false);

    await harness.unmount();
  });

  test("updates thread model for pending request maps without rebuilding composer", async () => {
    const session = createSession("session-1", "external-1");
    const baseProps = createHookArgs({
      selectedSessionCore: {
        loadedSession: session,
        sessionsForTask: summarizeSessions([session]),
      },
      composer: {
        draftScope: draftScopeFixture("draft-pending-maps"),
      },
    });
    const harness = createHookHarness(baseProps);

    await harness.mount();
    const initialState = harness.getLatest();
    const initialThreadModel = initialState.agentChatModel.thread;
    const initialComposerModel = initialState.agentChatModel.composer;

    const approvalUpdateProps = {
      ...baseProps,
      selectedSession: {
        ...baseProps.selectedSession,
        pendingInput: {
          ...baseProps.selectedSession.pendingInput,
          approvals: {
            ...baseProps.selectedSession.pendingInput.approvals,
            isSubmittingByRequestId: {
              "perm-1": true,
            },
          },
        },
      },
    };
    await harness.update(approvalUpdateProps);

    const approvalState = harness.getLatest();
    const approvalThreadModel = approvalState.agentChatModel.thread;
    expect(approvalThreadModel).not.toBe(initialThreadModel);
    expect(approvalState.agentChatModel.composer).toBe(initialComposerModel);
    expect(approvalThreadModel.isSubmittingApprovalByRequestId["perm-1"]).toBe(true);

    await harness.update({
      ...approvalUpdateProps,
      selectedSession: {
        ...approvalUpdateProps.selectedSession,
        pendingInput: {
          ...approvalUpdateProps.selectedSession.pendingInput,
          pendingQuestions: {
            ...approvalUpdateProps.selectedSession.pendingInput.pendingQuestions,
            isSubmittingByRequestId: {
              "q-1": true,
            },
          },
        },
      },
    });

    const questionState = harness.getLatest();
    expect(questionState.agentChatModel.thread).not.toBe(approvalThreadModel);
    expect(questionState.agentChatModel.composer).toBe(initialComposerModel);
    expect(questionState.agentChatModel.thread.isSubmittingQuestionByRequestId["q-1"]).toBe(true);

    await harness.unmount();
  });

  test("derives subagent pending approval counts from all live session summaries", async () => {
    const parentSession = createSession("session-parent", "external-parent");
    const childWithApproval = createSession("session-child-1", "external-child-1", {
      taskId: "other-task",
      pendingApprovals: [
        createPendingApproval("perm-1"),
        createPendingApproval("perm-2", "shell", ["git status"]),
      ],
    });
    const childWithoutApproval = createSession("session-child-2", "external-child-2", {
      pendingApprovals: [],
    });
    const harness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          loadedSession: parentSession,
          sessionsForTask: [toAgentSessionSummary(parentSession)],
          allSessionSummaries: [
            toAgentSessionSummary(parentSession),
            toAgentSessionSummary(childWithApproval),
            toAgentSessionSummary(childWithoutApproval),
          ],
        },
      }),
    );

    await harness.mount();

    expect(
      harness.getLatest().agentChatModel.thread.subagentPendingApprovalCountBySessionKey,
    ).toEqual({
      [agentSessionIdentityKey(childWithApproval)]: 2,
    });

    await harness.unmount();
  });

  test("keys subagent pending approval counts by session identity", async () => {
    const parentSession = createSession("session-parent", "external-parent");
    const childWithApproval = createSession("session-child-internal", "session-child-runtime", {
      taskId: "other-task",
      pendingApprovals: [createPendingApproval("perm-1")],
    });
    const harness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          loadedSession: parentSession,
          sessionsForTask: [toAgentSessionSummary(parentSession)],
          allSessionSummaries: [
            toAgentSessionSummary(parentSession),
            toAgentSessionSummary(childWithApproval),
          ],
        },
      }),
    );

    await harness.mount();

    const counts =
      harness.getLatest().agentChatModel.thread.subagentPendingApprovalCountBySessionKey ?? {};
    expect(counts[agentSessionIdentityKey(childWithApproval)]).toBe(1);

    await harness.unmount();
  });

  test("derives subagent pending approval counts from child session summaries", async () => {
    const parentSession = createSession("session-parent", "external-parent");
    const childSummary = toAgentSessionSummary(
      createSession("internal-child-session", "external-child-session", {
        taskId: "other-task",
        pendingApprovals: [createPendingApproval("perm-1")],
      }),
    );
    const harness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          loadedSession: parentSession,
          sessionsForTask: [toAgentSessionSummary(parentSession)],
          allSessionSummaries: [toAgentSessionSummary(parentSession), childSummary],
        },
      }),
    );

    await harness.mount();

    const counts =
      harness.getLatest().agentChatModel.thread.subagentPendingApprovalCountBySessionKey ?? {};
    expect(counts[agentSessionIdentityKey(childSummary)]).toBe(1);

    await harness.unmount();
  });

  test("keeps subagent pending approval counts unchanged when unrelated sessions change", async () => {
    const parentSession = createSession("session-parent", "external-parent");
    const childWithApproval = createSession("session-child-1", "external-child-1", {
      taskId: "other-task",
      pendingApprovals: [createPendingApproval("perm-1")],
    });
    const initialProps = createHookArgs({
      selectedSessionCore: {
        loadedSession: parentSession,
        sessionsForTask: [toAgentSessionSummary(parentSession)],
        allSessionSummaries: [
          toAgentSessionSummary(parentSession),
          toAgentSessionSummary(childWithApproval),
        ],
      },
    });
    const harness = createHookHarness(initialProps);

    await harness.mount();

    const initialCounts =
      harness.getLatest().agentChatModel.thread.subagentPendingApprovalCountBySessionKey;

    await harness.update(
      createHookArgs({
        selectedSessionCore: {
          loadedSession: parentSession,
          sessionsForTask: [toAgentSessionSummary(parentSession)],
          allSessionSummaries: [
            toAgentSessionSummary(parentSession),
            toAgentSessionSummary(childWithApproval),
            toAgentSessionSummary(
              createSession("session-child-2", "external-child-2", {
                taskId: "other-task",
                pendingApprovals: [],
              }),
            ),
          ],
        },
      }),
    );

    expect(
      harness.getLatest().agentChatModel.thread.subagentPendingApprovalCountBySessionKey,
    ).toEqual(initialCounts);

    await harness.unmount();
  });

  test("derives subagent pending question counts from all live session summaries", async () => {
    const parentSession = createSession("session-parent", "external-parent");
    const childWithQuestion = createSession("session-child-1", "external-child-1", {
      taskId: "other-task",
      pendingQuestions: [createPendingQuestion("question-1"), createPendingQuestion("question-2")],
    });
    const childWithoutQuestion = createSession("session-child-2", "external-child-2", {
      pendingQuestions: [],
    });
    const harness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          loadedSession: parentSession,
          sessionsForTask: [toAgentSessionSummary(parentSession)],
          allSessionSummaries: [
            toAgentSessionSummary(parentSession),
            toAgentSessionSummary(childWithQuestion),
            toAgentSessionSummary(childWithoutQuestion),
          ],
        },
      }),
    );

    await harness.mount();

    expect(
      harness.getLatest().agentChatModel.thread.subagentPendingQuestionCountBySessionKey,
    ).toEqual({
      [agentSessionIdentityKey(childWithQuestion)]: 2,
    });

    await harness.unmount();
  });

  test("derives subagent pending question counts from child session summaries", async () => {
    const parentSession = createSession("session-parent", "external-parent");
    const childSummary = toAgentSessionSummary(
      createSession("internal-child-session", "external-child-session", {
        taskId: "other-task",
        pendingQuestions: [createPendingQuestion("question-1")],
      }),
    );
    const harness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          loadedSession: parentSession,
          sessionsForTask: [toAgentSessionSummary(parentSession)],
          allSessionSummaries: [toAgentSessionSummary(parentSession), childSummary],
        },
      }),
    );

    await harness.mount();

    expect(
      harness.getLatest().agentChatModel.thread.subagentPendingQuestionCountBySessionKey,
    ).toEqual({
      [agentSessionIdentityKey(childSummary)]: 1,
    });

    await harness.unmount();
  });

  test("keeps subagent pending question counts unchanged when unrelated sessions change", async () => {
    const parentSession = createSession("session-parent", "external-parent");
    const childWithQuestion = createSession("session-child-1", "external-child-1", {
      taskId: "other-task",
      pendingQuestions: [createPendingQuestion("question-1")],
    });
    const initialProps = createHookArgs({
      selectedSessionCore: {
        loadedSession: parentSession,
        sessionsForTask: [toAgentSessionSummary(parentSession)],
        allSessionSummaries: [
          toAgentSessionSummary(parentSession),
          toAgentSessionSummary(childWithQuestion),
        ],
      },
    });
    const harness = createHookHarness(initialProps);

    await harness.mount();

    const initialCounts =
      harness.getLatest().agentChatModel.thread.subagentPendingQuestionCountBySessionKey;

    await harness.update(
      createHookArgs({
        selectedSessionCore: {
          loadedSession: parentSession,
          sessionsForTask: [toAgentSessionSummary(parentSession)],
          allSessionSummaries: [
            toAgentSessionSummary(parentSession),
            toAgentSessionSummary(childWithQuestion),
            toAgentSessionSummary(
              createSession("session-child-2", "external-child-2", {
                taskId: "other-task",
                pendingQuestions: [],
              }),
            ),
          ],
        },
      }),
    );

    expect(
      harness.getLatest().agentChatModel.thread.subagentPendingQuestionCountBySessionKey,
    ).toEqual(initialCounts);

    await harness.unmount();
  });

  test("keeps composer identity tied to selected session instead of loaded session state", async () => {
    const initialSession = createSession("session-1", "external-1", {
      role: "spec",
      status: "running",
      workingDirectory: "/repo/selected-worktree",
    });
    const selectedSessionIdentity = toAgentSessionIdentity(initialSession);
    const baseProps = createHookArgs({
      selectedSessionCore: {
        selectedSessionIdentity,
        loadedSession: initialSession,
        sessionsForTask: summarizeSessions([initialSession]),
      },
      composer: {
        draftScope: draftScopeFixture("draft-same-session"),
      },
      sessionActions: {
        isSessionWorking: true,
      },
    });
    const harness = createHookHarness(baseProps);

    await harness.mount();
    const initialComposerModel = harness.getLatest().agentChatModel.composer;
    const selectedSessionKey = agentSessionIdentityKey(selectedSessionIdentity);

    const sameSessionIdNewRef = createSession("session-1", "external-1", {
      role: "spec",
      status: "running",
      workingDirectory: "/repo/stale-worktree",
    });
    await harness.update(
      createHookArgs({
        ...baseProps,
        selectedSessionCore: {
          selectedSessionIdentity,
          loadedSession: sameSessionIdNewRef,
          sessionsForTask: summarizeSessions([initialSession]),
        },
      }),
    );

    const nextComposerModel = harness.getLatest().agentChatModel.composer;
    expect(initialComposerModel.displayedSessionKey).toBe(selectedSessionKey);
    expect(nextComposerModel.displayedSessionKey).toBe(selectedSessionKey);
    expect(nextComposerModel.isSessionWorking).toBe(initialComposerModel.isSessionWorking);
    expect(nextComposerModel.isWaitingInput).toBe(initialComposerModel.isWaitingInput);

    await harness.unmount();
  });

  test("updates composer model when a running session starts waiting for input", async () => {
    const initialSession = createSession("session-1", "external-1", {
      role: "spec",
      status: "running",
      pendingQuestions: [],
    });
    const baseProps = createHookArgs({
      selectedSessionCore: {
        loadedSession: initialSession,
        sessionsForTask: summarizeSessions([initialSession]),
      },
      composer: {
        draftScope: draftScopeFixture("draft-waiting-input"),
      },
      sessionActions: {
        isSessionWorking: true,
        isWaitingInput: false,
      },
    });
    const harness = createHookHarness(baseProps);

    await harness.mount();
    const initialComposerModel = harness.getLatest().agentChatModel.composer;
    expect(initialComposerModel.isWaitingInput).toBe(false);

    const waitingSession = createSession("session-1", "external-1", {
      role: "spec",
      status: "running",
      pendingQuestions: [
        {
          requestId: "question-1",
          questions: [
            {
              header: "Question",
              question: "Need input",
              options: [{ label: "Reply", description: "Provide input" }],
            },
          ],
        },
      ],
    });
    await harness.update(
      createHookArgs({
        ...baseProps,
        selectedSessionCore: {
          loadedSession: waitingSession,
          sessionsForTask: summarizeSessions([waitingSession]),
        },
        sessionActions: {
          ...baseProps.sessionActions,
          isSessionWorking: true,
          isWaitingInput: true,
        },
      }),
    );

    const nextComposerModel = harness.getLatest().agentChatModel.composer;
    expect(nextComposerModel).not.toBe(initialComposerModel);
    expect(nextComposerModel.isWaitingInput).toBe(true);
    expect(nextComposerModel.waitingInputPlaceholder).toBe(
      "Answer the pending question above to continue",
    );

    await harness.unmount();
  });

  test("treats unavailable selected role as read-only when no kickoff is available", async () => {
    const unavailablePlannerTask = createTaskCardFixture({
      status: "open",
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: false, completed: false },
        builder: { required: true, canSkip: false, available: false, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
    });

    const harness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          role: "planner",
          selectedTask: unavailablePlannerTask,
          loadedSession: null,
          sessionsForTask: [],
        },
        sessionActions: {
          canUseKickoffPrompt: false,
          isSessionWorking: false,
        },
      }),
    );

    await harness.mount();

    const state = harness.getLatest();
    expect(state.agentChatModel.thread.emptyState?.actionLabel).toBeUndefined();
    expect(state.agentChatModel.composer.isReadOnly).toBe(true);
    expect(state.agentChatModel.composer.readOnlyReason).toContain("Planner is unavailable");

    await harness.unmount();
  });

  test("keeps existing session composer and stop control enabled when role is unavailable", async () => {
    const unavailablePlannerTask = createTaskCardFixture({
      status: "open",
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: false, completed: false },
        builder: { required: true, canSkip: false, available: false, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
    });
    const runningPlannerSession = createSession("session-plan", "external-plan", {
      role: "planner",
      status: "running",
    });

    const harness = createHookHarness(
      createHookArgs({
        selectedSessionCore: {
          role: "planner",
          selectedTask: unavailablePlannerTask,
          loadedSession: runningPlannerSession,
          sessionsForTask: summarizeSessions([runningPlannerSession]),
        },
        sessionActions: {
          canStopSession: true,
          isSessionWorking: true,
        },
      }),
    );

    await harness.mount();

    const state = harness.getLatest();
    expect(state.agentChatModel.composer.isReadOnly).toBe(false);
    expect(state.agentChatModel.composer.readOnlyReason).toBeNull();
    expect(state.agentChatModel.composer.canStopSession).toBe(true);

    await harness.unmount();
  });
});
