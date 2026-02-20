import { describe, expect, test } from "bun:test";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentChat } from "./agent-chat";
import {
  TEST_ROLE_OPTIONS,
  buildModelSelection,
  buildSession,
  buildTask,
} from "./agent-chat-test-fixtures";

describe("AgentChat", () => {
  test("renders integrated header, thread, and composer sections", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChat, {
        model: {
          header: {
            sessionStatus: "running",
            taskId: "task-1",
            tasks: [buildTask()],
            onTaskChange: () => {},
            selectedTaskTitle: "Add social login",
            roleOptions: TEST_ROLE_OPTIONS,
            role: "spec",
            onRoleChange: () => {},
            sessionOptions: [{ value: "session-1", label: "Initial Spec · Feb 20, 10:00 AM" }],
            selectedSessionValue: "session-1",
            onSessionChange: () => {},
            scenario: "spec_initial",
            scenarioOptions: [{ value: "spec_initial", label: "Initial Spec" }],
            scenarioDisabled: false,
            onScenarioChange: () => {},
            canKickoffNewSession: true,
            kickoffLabel: "Start Spec",
            onKickoff: () => {},
            isStarting: false,
            isSending: false,
            showFollowLatest: false,
            onFollowLatest: () => {},
            stats: { sessions: 1, messages: 1, permissions: 0, questions: 0 },
            agentStudioReady: true,
          },
          thread: {
            session: buildSession({
              status: "running",
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
            onSubmitQuestionAnswers: async () => {},
            todoPanelCollapsed: false,
            onToggleTodoPanel: () => {},
            todoPanelBottomOffset: 120,
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
        },
      }),
    );

    expect(html).toContain("Agent Studio");
    expect(html).toContain("Agent is thinking...");
    expect(html).toContain("Send message");
  });

  test("keeps composer visible when no session is selected", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChat, {
        model: {
          header: {
            sessionStatus: null,
            taskId: "task-1",
            tasks: [buildTask()],
            onTaskChange: () => {},
            selectedTaskTitle: "Add social login",
            roleOptions: TEST_ROLE_OPTIONS,
            role: "spec",
            onRoleChange: () => {},
            sessionOptions: [],
            selectedSessionValue: "",
            onSessionChange: () => {},
            scenario: "spec_initial",
            scenarioOptions: [{ value: "spec_initial", label: "Initial Spec" }],
            scenarioDisabled: false,
            onScenarioChange: () => {},
            canKickoffNewSession: false,
            kickoffLabel: "Start Spec",
            onKickoff: () => {},
            isStarting: false,
            isSending: false,
            showFollowLatest: false,
            onFollowLatest: () => {},
            stats: { sessions: 0, messages: 0, permissions: 0, questions: 0 },
            agentStudioReady: true,
          },
          thread: {
            session: null,
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
            onSubmitQuestionAnswers: async () => {},
            todoPanelCollapsed: false,
            onToggleTodoPanel: () => {},
            todoPanelBottomOffset: 120,
            messagesContainerRef: createRef<HTMLDivElement>(),
            onMessagesScroll: () => {},
          },
          composer: {
            taskId: "task-1",
            agentStudioReady: true,
            input: "",
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
        },
      }),
    );

    expect(html).toContain("Send a message to start a new session automatically.");
    expect(html).toContain("Send message");
  });
});
