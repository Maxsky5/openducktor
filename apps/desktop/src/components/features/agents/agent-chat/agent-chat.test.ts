import { describe, expect, test } from "bun:test";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentChat } from "./agent-chat";
import {
  buildModelSelection,
  buildSession,
  buildTodoItem,
  TEST_ROLE_OPTIONS,
} from "./agent-chat-test-fixtures";

const buildModel = () => ({
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
    roleOptions: TEST_ROLE_OPTIONS,
    readinessState: "ready" as const,
    agentStudioReady: true,
    blockedReason: "",
    isLoadingChecks: false,
    onRefreshChecks: () => {},
    taskSelected: true,
    canKickoffNewSession: false,
    kickoffLabel: "Start Spec",
    onKickoff: () => {},
    isStarting: false,
    isSending: false,
    sessionAgentColors: {},
    isSubmittingQuestionByRequestId: {},
    isSubmittingPermissionByRequestId: {},
    permissionReplyErrorByRequestId: {},
    onSubmitQuestionAnswers: async () => {},
    onReplyPermission: async () => {},
    todoPanelCollapsed: false,
    onToggleTodoPanel: () => {},
    messagesContainerRef: createRef<HTMLDivElement>(),
    scrollToBottomOnSendRef: { current: null } as { current: (() => void) | null },
    syncBottomAfterComposerLayoutRef: { current: null } as { current: (() => void) | null },
  },
  composer: {
    taskId: "task-1",
    agentStudioReady: true,
    isReadOnly: false,
    readOnlyReason: null,
    busySendBlockedReason: null,
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
});
