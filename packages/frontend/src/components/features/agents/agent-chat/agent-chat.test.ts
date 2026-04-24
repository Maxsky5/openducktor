import { describe, expect, test } from "bun:test";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentChat, AgentChatSurface } from "./agent-chat";
import { buildModelSelection, buildSession, buildTodoItem } from "./agent-chat-test-fixtures";

const buildModel = () => ({
  mode: "interactive" as const,
  thread: {
    session: buildSession({
      status: "running" as const,
      draftAssistantText: "",
    }),
    isSessionWorking: true,
    showThinkingMessages: false,
    isSessionViewLoading: false,
    isSessionHistoryLoading: false,
    isWaitingForRuntimeReadiness: false,
    readinessState: "ready" as const,
    isInteractionEnabled: true,
    blockedReason: "",
    isLoadingChecks: false,
    onRefreshChecks: () => {},
    emptyState: {
      title: "Send a message to start a new session automatically.",
    },
    isStarting: false,
    isSending: false,
    sessionAgentColors: {},
    canSubmitQuestionAnswers: true,
    isSubmittingQuestionByRequestId: {},
    canReplyToPermissions: true,
    isSubmittingPermissionByRequestId: {},
    permissionReplyErrorByRequestId: {},
    onSubmitQuestionAnswers: async () => {},
    onReplyPermission: async () => {},
    sessionRuntimeDataError: null,
    todoPanelCollapsed: false,
    onToggleTodoPanel: () => {},
    messagesContainerRef: createRef<HTMLDivElement>(),
    scrollToBottomOnSendRef: { current: null } as { current: (() => void) | null },
    syncBottomAfterComposerLayoutRef: { current: null } as { current: (() => void) | null },
  },
  composer: {
    taskId: "task-1",
    displayedSessionId: "session-1",
    isInteractionEnabled: true,
    isReadOnly: false,
    readOnlyReason: null,
    busySendBlockedReason: null,
    pendingInlineCommentCount: 0,
    draftStateKey: "draft-1",
    onSend: async () => true,
    isSending: false,
    isStarting: false,
    isSessionWorking: false,
    isWaitingInput: false,
    isModelSelectionPending: false,
    selectedModelSelection: buildModelSelection(),
    isSelectionCatalogLoading: false,
    supportsSlashCommands: true,
    supportsFileSearch: true,
    slashCommandCatalog: { commands: [] },
    slashCommands: [],
    slashCommandsError: null,
    isSlashCommandsLoading: false,
    searchFiles: async () => [],
    agentOptions: [{ value: "Hephaestus (Deep Agent)", label: "Hephaestus (Deep Agent)" }],
    modelOptions: [{ value: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex" }],
    modelGroups: [
      {
        label: "OpenAI",
        options: [{ value: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex" }],
      },
    ],
    variantOptions: [{ value: "high", label: "high" }],
    onSelectAgent: () => {},
    onSelectModel: () => {},
    onSelectVariant: () => {},
    contextUsage: null,
    canStopSession: false,
    onStopSession: () => {},
    composerFormRef: createRef<HTMLFormElement>(),
    composerEditorRef: createRef<HTMLDivElement>(),
    onComposerEditorInput: () => {},
    scrollToBottomOnSendRef: { current: null } as { current: (() => void) | null },
    syncBottomAfterComposerLayoutRef: { current: null } as { current: (() => void) | null },
  },
});

describe("AgentChat", () => {
  test("renders thread and composer sections", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChat, {
        model: buildModel(),
      }),
    );

    expect(html).toContain("Initial response");
    expect(html).toContain("Send message");
  });

  test("renders optional header slot", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChat, {
        header: createElement("div", null, "Header slot"),
        model: buildModel(),
      }),
    );

    expect(html).toContain("Header slot");
  });

  test("hides the composer in non-interactive mode", () => {
    const interactiveModel = buildModel();
    const html = renderToStaticMarkup(
      createElement(AgentChatSurface, {
        model: {
          mode: "non_interactive",
          thread: {
            ...interactiveModel.thread,
            isInteractionEnabled: false,
            canSubmitQuestionAnswers: false,
            canReplyToPermissions: false,
          },
        },
      }),
    );

    expect(html).toContain("Initial response");
    expect(html).not.toContain("Send message");
  });

  test("keeps composer visible when no session is selected", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChat, {
        model: {
          ...buildModel(),
          thread: {
            ...buildModel().thread,
            session: null,
          },
          composer: {
            ...buildModel().composer,
          },
        },
      }),
    );

    expect(html).toContain("Send a message to start a new session automatically.");
    expect(html).toContain("Send message");
  });

  test("renders the todo stack immediately above the composer", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChat, {
        model: {
          ...buildModel(),
          thread: {
            ...buildModel().thread,
            sessionAgentColors: { "Hephaestus (Deep Agent)": "#123456" },
            session: buildSession({
              status: "idle",
              selectedModel: buildModelSelection({ profileId: "Hephaestus (Deep Agent)" }),
              todos: [buildTodoItem({ content: "Keep todo anchored", status: "in_progress" })],
            }),
          },
        },
      }),
    );

    expect(html).toContain("agent-chat-bottom-stack");
    expect(html).toContain("Keep todo anchored");
    expect(html).toContain("border-left-color:#123456");
    expect(html.indexOf("agent-chat-bottom-stack")).toBeLessThan(html.indexOf("<form"));
  });

  test("renders session runtime data errors in the bottom stack above the composer", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChat, {
        model: {
          ...buildModel(),
          thread: {
            ...buildModel().thread,
            session: buildSession({
              status: "idle",
              todos: [buildTodoItem({ content: "Keep todo anchored", status: "in_progress" })],
            }),
            sessionRuntimeDataError:
              "Runtime connection type 'stdio' is unsupported for active session runtime data access in runtime 'opencode'; local_http is required.",
          },
        },
      }),
    );

    expect(html).toContain("active session runtime data access");
    expect(html.indexOf("active session runtime data access")).toBeLessThan(html.indexOf("<form"));
  });
});
