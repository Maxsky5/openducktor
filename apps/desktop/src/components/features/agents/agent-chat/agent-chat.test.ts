import { describe, expect, test } from "bun:test";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentChat } from "./agent-chat";
import { buildModelSelection, buildSession, TEST_ROLE_OPTIONS } from "./agent-chat-test-fixtures";

const buildModel = () => ({
  thread: {
    session: buildSession({
      status: "running" as const,
      draftAssistantText: "",
    }),
    roleOptions: TEST_ROLE_OPTIONS,
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
    todoPanelBottomOffset: 120,
    isPinnedToBottom: true,
    messagesContainerRef: createRef<HTMLDivElement>(),
    onMessagesScroll: () => {},
  },
  composer: {
    taskId: "task-1",
    agentStudioReady: true,
    input: "Hi",
    onInputChange: () => {},
    onSend: () => {},
    isSending: false,
    isStarting: false,
    isSessionWorking: false,
    selectedModelSelection: buildModelSelection(),
    isSelectionCatalogLoading: false,
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
    composerTextareaRef: createRef<HTMLTextAreaElement>(),
    onComposerTextareaInput: () => {},
  },
});

describe("AgentChat", () => {
  test("renders thread and composer sections", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChat, {
        model: buildModel(),
      }),
    );

    expect(html).toContain("Agent is thinking...");
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
            input: "",
          },
        },
      }),
    );

    expect(html).toContain("Send a message to start a new session automatically.");
    expect(html).toContain("Send message");
  });
});
