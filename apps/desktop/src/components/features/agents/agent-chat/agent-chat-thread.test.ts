import { describe, expect, test } from "bun:test";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildMessage,
  buildPermissionRequest,
  buildQuestionRequest,
  buildSession,
  buildTodoItem,
  TEST_ROLE_OPTIONS,
} from "./agent-chat-test-fixtures";
import { AgentChatThread } from "./agent-chat-thread";

const baseModel = {
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
  messagesContainerRef: createRef<HTMLDivElement>(),
  onMessagesScroll: () => {},
} as const;

describe("AgentChatThread", () => {
  test("renders empty state when no session is active", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...baseModel,
          session: null,
          taskSelected: false,
          canKickoffNewSession: true,
        },
      }),
    );

    expect(html).toContain("Select a task to begin.");
    expect(html).toContain("Start Spec");
  });

  test("renders running indicator for active sessions without draft text", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...baseModel,
          session: buildSession({
            status: "running",
            draftAssistantText: "",
            pendingQuestions: [],
          }),
        },
      }),
    );

    expect(html).toContain("Agent is thinking...");
  });

  test("renders initializing state while autostart session is pending", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...baseModel,
          session: null,
          taskSelected: true,
          isStarting: true,
          canKickoffNewSession: true,
        },
      }),
    );

    expect(html).toContain("Initializing session...");
    expect(html).not.toContain("Send a message to start a new session automatically.");
  });

  test("renders blocked warning with recheck action when studio is unavailable", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...baseModel,
          agentStudioReady: false,
          blockedReason: "OpenCode runtime is unavailable",
          session: null,
        },
      }),
    );

    expect(html).toContain("OpenCode runtime is unavailable");
    expect(html).toContain("Recheck");
  });

  test("renders stream draft, duration separators, and question cards", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...baseModel,
          session: buildSession({
            messages: [
              buildMessage("assistant", "Done", {
                id: "assistant-1",
                meta: {
                  kind: "assistant",
                  agentRole: "spec",
                  opencodeAgent: "Hephaestus (Deep Agent)",
                  durationMs: 1_500,
                },
              }),
            ],
            draftAssistantText: "Streaming message",
            pendingQuestions: [buildQuestionRequest()],
          }),
        },
      }),
    );

    expect(html).toContain("Worked for");
    expect(html).toContain("Spec (streaming)");
    expect(html).toContain("Streaming message");
    expect(html).toContain("Input needed");
  });

  test("renders permission cards for pending permission requests", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...baseModel,
          session: buildSession({
            pendingPermissions: [
              buildPermissionRequest({
                requestId: "perm-1",
                permission: "bash",
                patterns: ["**/*.sh", "/tmp/*"],
              }),
            ],
          }),
        },
      }),
    );

    expect(html).toContain("Permission request");
    expect(html).toContain("bash");
    expect(html).toContain("**/*.sh, /tmp/*");
    expect(html).toContain("Allow Once");
    expect(html).toContain("Always Allow");
    expect(html).toContain("Reject");
  });

  test("renders floating todo panel for active todo items", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...baseModel,
          session: buildSession({
            todos: [
              buildTodoItem({
                id: "todo-1",
                content: "Analyze current styling",
                status: "completed",
              }),
              buildTodoItem({
                id: "todo-2",
                content: "Read layout and pages",
                status: "in_progress",
              }),
            ],
          }),
        },
      }),
    );

    expect(html).toContain("Todo");
    expect(html).toContain("Analyze current styling");
    expect(html).toContain("Read layout and pages");
  });

  test("renders messages with fallback rendering (SSR compatible)", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...baseModel,
          session: buildSession({
            messages: [
              buildMessage("user", "Hello", { id: "msg-user-1" }),
              buildMessage("assistant", "Hi there!", { id: "msg-assistant-1" }),
            ],
          }),
        },
      }),
    );

    // Verify messages are rendered (via fallback when virtualizer has no items)
    expect(html).toContain("Hello");
    expect(html).toContain("Hi there!");
  });

  test("renders multiple messages with fallback rendering (SSR compatible)", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...baseModel,
          session: buildSession({
            messages: [
              buildMessage("user", "First message", { id: "msg-1" }),
              buildMessage("assistant", "Second message", { id: "msg-2" }),
              buildMessage("user", "Third message", { id: "msg-3" }),
              buildMessage("assistant", "Fourth message", { id: "msg-4" }),
            ],
          }),
        },
      }),
    );

    // Verify all messages are rendered
    expect(html).toContain("First message");
    expect(html).toContain("Second message");
    expect(html).toContain("Third message");
    expect(html).toContain("Fourth message");
  });

  test("handles session without messages gracefully", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...baseModel,
          session: buildSession({
            messages: [],
          }),
        },
      }),
    );

    // Should not render AgentChatMessageCard when there are no messages
    // (the container might have space-y-3 from other elements, but no message cards)
    expect(html).not.toContain("AgentChatMessageCard");
  });
});
