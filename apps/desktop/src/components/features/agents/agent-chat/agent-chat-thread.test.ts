import { describe, expect, test } from "bun:test";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create } from "react-test-renderer";
import {
  buildMessage,
  buildPermissionRequest,
  buildQuestionRequest,
  buildSession,
  buildTodoItem,
  TEST_ROLE_OPTIONS,
} from "./agent-chat-test-fixtures";
import { AgentChatThread } from "./agent-chat-thread";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

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
  isPinnedToBottom: true,
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

  test("renders loading state when active session has no renderable rows yet", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...baseModel,
          session: buildSession({
            status: "stopped",
            messages: [],
            draftAssistantText: "",
            pendingQuestions: [],
            pendingPermissions: [],
          }),
        },
      }),
    );

    expect(html).toContain("Loading session history...");
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

  test("keeps pending question and permission cards mounted for long virtualized sessions", () => {
    const longMessages = Array.from({ length: 45 }, (_, index) =>
      buildMessage("assistant", `Message ${index + 1}`, {
        id: `message-${index + 1}`,
      }),
    );

    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...baseModel,
          session: buildSession({
            messages: longMessages,
            pendingQuestions: [buildQuestionRequest()],
            pendingPermissions: [buildPermissionRequest()],
          }),
        },
      }),
    );

    expect(html).toContain("Message 45");
    expect(html).toContain("Input needed");
    expect(html).toContain("Permission request");
    expect(html).toContain("flow-root");
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
    expect(html).toContain("max-h-[40vh]");
    expect(html).toContain("overflow-y-auto");
  });

  test("refreshes virtualized rows when message array mutates without changing session identity", () => {
    const messages = Array.from({ length: 45 }, (_, index) =>
      buildMessage("assistant", `Message ${index + 1}`, {
        id: `message-${index + 1}`,
      }),
    );
    const session = buildSession({ messages });
    const model = {
      ...baseModel,
      session,
    };

    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        createElement(AgentChatThread, {
          model,
        }),
      );
    });

    expect(JSON.stringify(renderer.toJSON())).toContain("Message 45");

    session.messages.push(
      buildMessage("assistant", "Message 46", {
        id: "message-46",
      }),
    );

    act(() => {
      renderer.update(
        createElement(AgentChatThread, {
          model,
        }),
      );
    });

    expect(JSON.stringify(renderer.toJSON())).toContain("Message 46");
    act(() => {
      renderer.unmount();
    });
  });
});
