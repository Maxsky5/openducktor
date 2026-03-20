import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TestRenderer, { act } from "react-test-renderer";
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
  showThinkingMessages: false,
  isSessionViewLoading: false,
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
} as const;

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const getGlobalWindow = (): unknown => {
  return (globalThis as { window?: unknown }).window;
};

const setGlobalWindow = (value: unknown): void => {
  const target = globalThis as { window?: unknown };
  if (typeof value === "undefined") {
    delete target.window;
    return;
  }

  target.window = value;
};

const createContainer = () => {
  return {
    addEventListener: mock(() => {}),
    clientHeight: 320,
    removeEventListener: mock(() => {}),
    scrollHeight: 2_000,
    scrollTo: mock(() => {}),
    scrollTop: 1_680,
  } as unknown as HTMLDivElement;
};

type ScrollContainerMock = {
  addEventListener: ReturnType<typeof mock>;
  clientHeight: number;
  removeEventListener: ReturnType<typeof mock>;
  scrollHeight: number;
  scrollTo: ReturnType<typeof mock>;
  scrollTop: number;
};

const buildLongSession = (sessionId: string, count = 80) => {
  const messages = Array.from({ length: count }, (_, index) =>
    buildMessage("user", `Message ${index + 1}`, {
      id: `message-${index + 1}`,
    }),
  );

  return buildSession({
    sessionId,
    messages,
    status: "idle",
    pendingQuestions: [],
    pendingPermissions: [],
  });
};

describe("AgentChatThread", () => {
  const originalWindow = getGlobalWindow();
  const originalIntersectionObserver = globalThis.IntersectionObserver;
  const originalMatchMedia = globalThis.matchMedia;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

  beforeEach(() => {
    globalThis.matchMedia = ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList) as typeof matchMedia;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(16);
      return 1;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
    globalThis.IntersectionObserver = class MockIntersectionObserver {
      disconnect(): void {}

      observe(): void {}

      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }

      unobserve(): void {}
    } as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    setGlobalWindow(originalWindow);
    globalThis.IntersectionObserver = originalIntersectionObserver;
    globalThis.matchMedia = originalMatchMedia;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  });

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

  test("does not render a synthetic running indicator row", () => {
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

    expect(html).not.toContain("Agent is thinking...");
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

  test("renders blank transcript area when session has messages but all were filtered", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...baseModel,
          showThinkingMessages: false,
          session: buildSession({
            status: "stopped",
            messages: [
              buildMessage("thinking", "Reasoning trace 1", { id: "thinking-1" }),
              buildMessage("thinking", "Reasoning trace 2", { id: "thinking-2" }),
            ],
            draftAssistantText: "",
            pendingQuestions: [],
            pendingPermissions: [],
          }),
        },
      }),
    );

    expect(html).not.toContain("Loading session history...");
  });

  test("renders pending question and permission cards below blank transcript when filtered to zero", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...baseModel,
          showThinkingMessages: false,
          session: buildSession({
            status: "stopped",
            messages: [buildMessage("thinking", "Reasoning trace", { id: "thinking-1" })],
            pendingQuestions: [buildQuestionRequest()],
            pendingPermissions: [buildPermissionRequest()],
          }),
        },
      }),
    );

    expect(html).not.toContain("Loading session history...");
    expect(html).toContain("Input needed");
    expect(html).toContain("Permission request");
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

  test("renders transcript messages and question cards without synthetic draft rows", () => {
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
                  profileId: "Hephaestus (Deep Agent)",
                  durationMs: 1_500,
                },
              }),
              buildMessage("assistant", "Streaming message", {
                id: "assistant-2",
              }),
            ],
            pendingQuestions: [buildQuestionRequest()],
          }),
        },
      }),
    );

    expect(html).toContain("Worked for");
    expect(html).toContain("Streaming message");
    expect(html).toContain("Input needed");
  });

  test("keeps pending question cards visible after the session becomes idle", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...baseModel,
          session: buildSession({
            status: "idle",
            messages: [buildMessage("assistant", "Need your input", { id: "assistant-idle-1" })],
            pendingQuestions: [buildQuestionRequest()],
          }),
        },
      }),
    );

    expect(html).toContain("Need your input");
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

  test("keeps pending question and permission cards mounted for long sessions", () => {
    const longMessages = Array.from({ length: 80 }, (_, index) =>
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

    expect(html).toContain("Message 80");
    expect(html).toContain("Input needed");
    expect(html).toContain("Permission request");
    expect(html).toContain("hide-scrollbar");
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

  test("refreshes rendered rows when the session gains new visible rows", async () => {
    const messages = Array.from({ length: 80 }, (_, index) =>
      buildMessage("user", `Message ${index + 1}`, {
        id: `message-${index + 1}`,
      }),
    );
    const session = buildSession({ messages });
    const model = {
      ...baseModel,
      messagesContainerRef: { current: createContainer() },
      session,
    };

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(AgentChatThread, {
          model,
        }),
      );
      await flush();
    });

    expect(JSON.stringify(renderer.toJSON())).toContain("Message 80");

    const nextSession = buildSession({
      sessionId: session.sessionId,
      messages: Array.from({ length: 81 }, (_, index) =>
        buildMessage("user", `Message ${index + 1}`, {
          id: `message-${index + 1}`,
        }),
      ),
      pendingQuestions: [],
      pendingPermissions: [],
      status: "idle",
    });

    await act(async () => {
      renderer.update(
        createElement(AgentChatThread, {
          model: {
            ...model,
            session: nextSession,
          },
        }),
      );
      await flush();
    });

    const nextJson = JSON.stringify(renderer.toJSON());
    expect(nextJson).toContain("Message 81");
    expect(nextJson).not.toContain("Message 21");
    await act(async () => {
      renderer.unmount();
      await flush();
    });
  });

  test("shows loading overlay while session context is switching", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...baseModel,
          isSessionViewLoading: true,
          session: buildSession({
            sessionId: "session-loading",
            messages: [buildMessage("assistant", "Loading", { id: "assistant-1" })],
          }),
        },
      }),
    );

    expect(html).toContain("Preparing chat...");
  });

  test("renders native scroll controls for top and bottom navigation", async () => {
    setGlobalWindow(globalThis);
    const rendererRef: { current: TestRenderer.ReactTestRenderer | null } = { current: null };
    const messagesContainerNodeRef: { current: ScrollContainerMock | null } = { current: null };

    const createNodeMock = (element: React.ReactElement): HTMLDivElement => {
      const props = (element.props ?? {}) as Record<string, unknown>;
      const className = typeof props.className === "string" ? props.className : "";
      const isMessagesContainer = className.includes("hide-scrollbar");
      const node = createContainer();
      if (isMessagesContainer) {
        messagesContainerNodeRef.current = node as unknown as ScrollContainerMock;
      }
      return node;
    };

    await act(async () => {
      rendererRef.current = TestRenderer.create(
        createElement(AgentChatThread, {
          model: {
            ...baseModel,
            messagesContainerRef: createRef<HTMLDivElement>(),
            session: buildLongSession("session-scroll", 80),
          },
        }),
        { createNodeMock },
      );
      await flush();
    });

    const mountedRenderer = rendererRef.current;
    if (!mountedRenderer) {
      throw new Error("Expected renderer");
    }

    const buttons = mountedRenderer.root.findAllByType("button");
    const scrollToTopButton = buttons.find(
      (button) => button.props["aria-label"] === "Scroll to top",
    );
    const scrollToBottomButton = buttons.find(
      (button) => button.props["aria-label"] === "Scroll to bottom",
    );

    expect(scrollToTopButton).toBeDefined();
    expect(scrollToBottomButton).toBeDefined();

    await act(async () => {
      scrollToTopButton?.props.onClick();
      await flush();
    });

    const containerNode = messagesContainerNodeRef.current;
    if (!containerNode) {
      throw new Error("Expected messages container node");
    }
    const scrollToMock = containerNode.scrollTo;

    expect(scrollToMock).toHaveBeenCalledWith({
      top: 0,
      behavior: "auto",
    });

    await act(async () => {
      scrollToBottomButton?.props.onClick();
      await flush();
    });

    expect(scrollToMock).toHaveBeenCalledWith({
      top: 2_000,
      behavior: "auto",
    });

    await act(async () => {
      mountedRenderer.unmount();
      await flush();
    });
  });
});
