import { describe, expect, test } from "bun:test";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createChatSettingsFixture } from "@/test-utils/shared-test-fixtures";
import { AgentChat, AgentChatSurface } from "./agent-chat";
import {
  buildModelSelection,
  buildSession,
  buildThreadTranscriptState,
  buildTodoItem,
  completeThreadModel,
} from "./agent-chat-test-fixtures";

const buildModel = () => ({
  chatSettings: createChatSettingsFixture(),
  thread: completeThreadModel({
    session: buildSession({
      status: "running" as const,
    }),
    isSessionWorking: true,
    transcriptState: buildThreadTranscriptState(),
    runtimeReadiness: {
      state: "ready" as const,
      message: null,
      isLoadingChecks: false,
      refreshChecks: async () => {},
    },
    isInteractionEnabled: true,
    emptyState: {
      title: "Send a message to start a new session automatically.",
    },
    isStarting: false,
    isSending: false,
    sessionAgentColors: {},
    canSubmitQuestionAnswers: true,
    isSubmittingQuestionByRequestId: {},
    canReplyToApprovals: true,
    isSubmittingApprovalByRequestId: {},
    approvalReplyErrorByRequestId: {},
    onSubmitQuestionAnswers: async () => {},
    onReplyApproval: async () => {},
    sessionAuxiliaryError: null,
    todoPanelCollapsed: false,
    onToggleTodoPanel: () => {},
    messagesContainerRef: createRef<HTMLDivElement>(),
    scrollToBottomOnSendRef: { current: null } as { current: (() => void) | null },
    syncBottomAfterComposerLayoutRef: { current: null } as { current: (() => void) | null },
  }),
  composer: {
    taskId: "task-1",
    displayedSessionKey: "session-1",
    isInteractionEnabled: true,
    isReadOnly: false,
    readOnlyReason: null,
    busySendBlockedReason: null,
    pendingInlineCommentCount: 0,
    draftStateKey: "draft-1",
    draftPersistenceIdentity: null,
    onSend: async () => true,
    isSending: false,
    isStarting: false,
    isSessionWorking: false,
    isWaitingInput: false,
    isModelSelectionPending: false,
    selectedModelSelection: buildModelSelection(),
    isSelectionCatalogLoading: false,
    supportsAttachments: true,
    supportsSlashCommands: true,
    supportsFileSearch: true,
    supportsSkillReferences: false,
    supportsSubagentReferences: false,
    slashCommandCatalog: { commands: [] },
    slashCommands: [],
    slashCommandsError: null,
    isSlashCommandsLoading: false,
    skillCatalog: null,
    skills: [],
    skillsError: null,
    isSkillsLoading: false,
    subagentCatalog: null,
    subagents: [],
    subagentsError: null,
    isSubagentsLoading: false,
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

  test("hides the composer when the surface has no composer model", () => {
    const interactiveModel = buildModel();
    const html = renderToStaticMarkup(
      createElement(AgentChatSurface, {
        model: {
          chatSettings: interactiveModel.chatSettings,
          thread: {
            ...interactiveModel.thread,
            isInteractionEnabled: false,
            canSubmitQuestionAnswers: false,
            canReplyToApprovals: false,
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
            session: buildSession({
              status: "idle",
            }),
            todos: [buildTodoItem({ content: "Keep todo anchored", status: "in_progress" })],
            sessionAccentColor: "#123456",
          },
        },
      }),
    );

    expect(html).toContain("agent-chat-bottom-stack");
    expect(html).toContain("Keep todo anchored");
    expect(html).toContain("border-left-color:#123456");
    expect(html.indexOf("agent-chat-bottom-stack")).toBeLessThan(html.indexOf("<form"));
  });

  test("renders session auxiliary errors in the bottom stack above the composer", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChat, {
        model: {
          ...buildModel(),
          thread: {
            ...buildModel().thread,
            session: buildSession({
              status: "idle",
            }),
            todos: [buildTodoItem({ content: "Keep todo anchored", status: "in_progress" })],
            sessionAuxiliaryError: "todos unavailable",
          },
        },
      }),
    );

    expect(html).toContain("todos unavailable");
    expect(html.indexOf("todos unavailable")).toBeLessThan(html.indexOf("<form"));
  });
});
