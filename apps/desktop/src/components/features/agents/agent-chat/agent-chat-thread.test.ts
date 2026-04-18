import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { act, createElement, createRef } from "react";
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

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const buildBaseModel = () => ({
  isSessionWorking: false,
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
  sessionRuntimeDataError: null,
  todoPanelCollapsed: false,
  onToggleTodoPanel: () => {},
  messagesContainerRef: createRef<HTMLDivElement>(),
  scrollToBottomOnSendRef: { current: null } as { current: (() => void) | null },
  syncBottomAfterComposerLayoutRef: { current: null } as { current: (() => void) | null },
});

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

type MockResizeObserverController = {
  callback: ResizeObserverCallback;
  observer: ResizeObserver;
  observedElements: Set<Element>;
};

const mockResizeObserverControllers = new Set<MockResizeObserverController>();

class MockResizeObserver implements ResizeObserver {
  private readonly observedElements = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    mockResizeObserverControllers.add({
      callback,
      observer: this,
      observedElements: this.observedElements,
    });
  }

  disconnect(): void {
    this.observedElements.clear();
  }

  observe(target: Element): void {
    this.observedElements.add(target);
  }

  unobserve(target: Element): void {
    this.observedElements.delete(target);
  }
}

const triggerResizeObservers = (heightByElement = new Map<Element, number>()): void => {
  for (const controller of mockResizeObserverControllers) {
    if (controller.observedElements.size === 0) {
      continue;
    }

    controller.callback(
      Array.from(controller.observedElements).map((target) => ({
        borderBoxSize: [] as ResizeObserverSize[],
        contentBoxSize: [] as ResizeObserverSize[],
        contentRect: {
          height: heightByElement.get(target) ?? 0,
        } as DOMRectReadOnly,
        devicePixelContentBoxSize: [] as ResizeObserverSize[],
        target,
      })),
      controller.observer,
    );
  }
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
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    mockResizeObserverControllers.clear();
    let nextAnimationFrameTime = 16;
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
      const frameTime = nextAnimationFrameTime;
      nextAnimationFrameTime += 16;
      queueMicrotask(() => {
        callback(frameTime);
      });
      return 1;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
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
    globalThis.ResizeObserver = originalResizeObserver;
  });

  test("renders empty state when no session is active", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
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
          ...buildBaseModel(),
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

  test("keeps the transcript area blank when active session has no renderable rows yet", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
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

    expect(html).not.toContain("Loading session history...");
    expect(html).not.toContain("Loading session...");
  });

  test("renders blank transcript area when session has messages but all were filtered", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
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
          ...buildBaseModel(),
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
          ...buildBaseModel(),
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
          ...buildBaseModel(),
          readinessState: "blocked",
          agentStudioReady: false,
          blockedReason: "OpenCode runtime is unavailable",
          session: null,
        },
      }),
    );

    expect(html).toContain("OpenCode runtime is unavailable");
    expect(html).toContain("Recheck");
  });

  test("renders the runtime-starting overlay without unmounting transcript content", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          readinessState: "checking",
          agentStudioReady: false,
          isWaitingForRuntimeReadiness: true,
          session: buildSession({
            messages: [buildMessage("assistant", "Cached transcript", { id: "assistant-1" })],
          }),
        },
      }),
    );

    expect(html).toContain("Runtime is starting");
    expect(html).toContain("Waiting for runtime and MCP health before loading this session.");
    expect(html).toContain("Cached transcript");
  });

  test("renders the runtime-starting overlay while waiting for a worktree runtime after page readiness succeeds", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          readinessState: "ready",
          agentStudioReady: true,
          isWaitingForRuntimeReadiness: true,
          session: buildSession({
            messages: [buildMessage("assistant", "Cached transcript", { id: "assistant-1" })],
          }),
        },
      }),
    );

    expect(html).toContain("Session runtime is reconnecting");
    expect(html).toContain(
      "Waiting for the selected session runtime to become available before loading this session.",
    );
    expect(html).toContain("Cached transcript");
  });

  test("does not show the runtime-starting overlay for generic readiness checks without a waiting session", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          readinessState: "checking",
          agentStudioReady: false,
          isWaitingForRuntimeReadiness: false,
          session: buildSession({
            messages: [buildMessage("assistant", "Cached transcript", { id: "assistant-1" })],
          }),
        },
      }),
    );

    expect(html).not.toContain("Runtime is starting");
    expect(html).toContain("Cached transcript");
  });

  test("renders transcript messages and question cards without synthetic draft rows", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
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
          ...buildBaseModel(),
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
          ...buildBaseModel(),
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
          ...buildBaseModel(),
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

  test("keeps pending cards and todo in a bottom stack outside the scroll region", async () => {
    const rendered = render(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: buildSession({
            pendingQuestions: [buildQuestionRequest()],
            pendingPermissions: [buildPermissionRequest()],
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
    await act(flush);

    const scrollRegion = rendered.container.querySelector(".agent-chat-scroll-region");
    const bottomStack = rendered.container.querySelector(".agent-chat-bottom-stack");

    expect(scrollRegion?.textContent).not.toContain("Input needed");
    expect(scrollRegion?.textContent).not.toContain("Permission request");
    expect(scrollRegion?.textContent).not.toContain("Read layout and pages");
    expect(bottomStack?.textContent).toContain("Input needed");
    expect(bottomStack?.textContent).toContain("Permission request");
    expect(bottomStack?.textContent).toContain("Todo");
    expect(bottomStack?.textContent).toContain("Analyze current styling");
    expect(bottomStack?.textContent).toContain("Read layout and pages");
    expect((bottomStack as HTMLDivElement).innerHTML.indexOf("Input needed")).toBeLessThan(
      (bottomStack as HTMLDivElement).innerHTML.indexOf("Permission request"),
    );
    expect((bottomStack as HTMLDivElement).innerHTML.indexOf("Permission request")).toBeLessThan(
      (bottomStack as HTMLDivElement).innerHTML.indexOf("Todo"),
    );

    rendered.unmount();
  });

  test("adds bottom spacing before the composer when the last bottom-stack item is a question", async () => {
    const rendered = render(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: buildSession({
            pendingQuestions: [buildQuestionRequest()],
            pendingPermissions: [],
            todos: [],
          }),
        },
      }),
    );
    await act(flush);

    const bottomStack = rendered.container.querySelector(".agent-chat-bottom-stack");
    expect(bottomStack?.className).toContain("pb-3");

    rendered.unmount();
  });

  test("adds bottom spacing before the composer when the last bottom-stack item is a permission", async () => {
    const rendered = render(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: buildSession({
            pendingQuestions: [],
            pendingPermissions: [buildPermissionRequest()],
            todos: [],
          }),
        },
      }),
    );
    await act(flush);

    const bottomStack = rendered.container.querySelector(".agent-chat-bottom-stack");
    expect(bottomStack?.className).toContain("pb-3");

    rendered.unmount();
  });

  test("keeps the todo panel flush with the composer when todo is the last bottom-stack item", async () => {
    const rendered = render(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: buildSession({
            pendingQuestions: [buildQuestionRequest()],
            pendingPermissions: [],
            todos: [
              buildTodoItem({
                id: "todo-1",
                content: "Read layout and pages",
                status: "in_progress",
              }),
            ],
          }),
        },
      }),
    );
    await act(flush);

    const bottomStack = rendered.container.querySelector(".agent-chat-bottom-stack");
    expect(bottomStack?.className).toContain("pb-0");

    rendered.unmount();
  });

  test("refreshes rendered rows when the session gains new visible rows", async () => {
    const messages = Array.from({ length: 80 }, (_, index) =>
      buildMessage("user", `Message ${index + 1}`, {
        id: `message-${index + 1}`,
      }),
    );
    const session = buildSession({ messages });
    const model = {
      ...buildBaseModel(),
      messagesContainerRef: { current: createContainer() },
      session,
    };

    const rendered = render(
      createElement(AgentChatThread, {
        model,
      }),
    );
    await act(flush);

    expect(rendered.container.textContent).toContain("Message 80");

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

    rendered.rerender(
      createElement(AgentChatThread, {
        model: {
          ...model,
          session: nextSession,
        },
      }),
    );
    await act(flush);

    expect(rendered.container.textContent).toContain("Message 81");
    rendered.unmount();
  });

  test("shows loading overlay while session context is switching", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          isSessionViewLoading: true,
          session: buildSession({
            sessionId: "session-loading",
            messages: [buildMessage("assistant", "Loading", { id: "assistant-1" })],
          }),
        },
      }),
    );

    expect(html).toContain("Loading session...");
  });

  test("hides transcript rows while session history is hydrating", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          isSessionHistoryLoading: true,
          session: buildSession({
            sessionId: "session-hydrating",
            messages: [buildMessage("assistant", "Old cached message", { id: "assistant-old-1" })],
          }),
        },
      }),
    );

    expect(html).toContain("Loading session...");
    expect(html).not.toContain("Old cached message");
  });

  test("renders native scroll controls for top and bottom navigation", async () => {
    setGlobalWindow(globalThis);
    const rendered = render(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          messagesContainerRef: createRef<HTMLDivElement>(),
          session: buildLongSession("session-scroll", 80),
        },
      }),
    );
    await act(flush);

    const containerNode = rendered.container.querySelector(".hide-scrollbar") as
      | (HTMLDivElement & ScrollContainerMock)
      | null;
    if (!containerNode) {
      throw new Error("Expected messages container node");
    }
    const scrollToMock = mock((options: ScrollToOptions) => {
      containerNode.scrollTop = Number(options.top ?? containerNode.scrollTop);
    });
    Object.defineProperty(containerNode, "scrollTo", {
      configurable: true,
      value: scrollToMock,
    });
    Object.defineProperty(containerNode, "clientHeight", {
      configurable: true,
      value: 320,
    });
    Object.defineProperty(containerNode, "scrollHeight", {
      configurable: true,
      value: 2000,
    });
    Object.defineProperty(containerNode, "scrollTop", {
      configurable: true,
      writable: true,
      value: 1680,
    });

    const scrollToTopButton = screen.getByRole("button", { name: "Scroll to top" });
    const scrollToBottomButton = screen.getByRole("button", { name: "Scroll to bottom" });

    fireEvent.click(scrollToTopButton);
    await act(flush);

    expect(scrollToMock).toHaveBeenCalledWith({ top: 0, behavior: "auto" });

    fireEvent.click(scrollToBottomButton);
    await act(flush);

    expect(containerNode.scrollTop).toBe(2_000);

    rendered.unmount();
  });

  test("resyncs the transcript when the todo stack first appears", async () => {
    const syncBottomAfterComposerLayout = mock(() => {});
    const syncBottomAfterComposerLayoutRef = {
      current: null,
    } as { current: (() => void) | null };
    const model = {
      ...buildBaseModel(),
      syncBottomAfterComposerLayoutRef,
      session: buildSession({
        pendingQuestions: [],
        pendingPermissions: [],
        todos: [],
      }),
    };

    const rendered = render(
      createElement(AgentChatThread, {
        model,
      }),
    );
    await act(flush);
    syncBottomAfterComposerLayoutRef.current = syncBottomAfterComposerLayout;

    rendered.rerender(
      createElement(AgentChatThread, {
        model: {
          ...model,
          session: buildSession({
            sessionId: model.session?.sessionId,
            pendingQuestions: [],
            pendingPermissions: [],
            todos: [buildTodoItem({ content: "Keep transcript pinned", status: "in_progress" })],
          }),
        },
      }),
    );
    await act(flush);

    const bottomStack = rendered.container.querySelector(".agent-chat-bottom-stack");
    if (!(bottomStack instanceof HTMLDivElement)) {
      throw new Error("Expected bottom stack element");
    }
    const bottomStackWrapper = bottomStack.parentElement;
    if (!(bottomStackWrapper instanceof HTMLDivElement)) {
      throw new Error("Expected bottom stack wrapper element");
    }

    syncBottomAfterComposerLayoutRef.current = syncBottomAfterComposerLayout;
    syncBottomAfterComposerLayout.mockClear();

    triggerResizeObservers(new Map([[bottomStackWrapper, 72]]));

    expect(syncBottomAfterComposerLayout).toHaveBeenCalledTimes(1);

    rendered.unmount();
  });

  test("resyncs the transcript when the todo panel expands", async () => {
    const syncBottomAfterComposerLayout = mock(() => {});
    const syncBottomAfterComposerLayoutRef = {
      current: null,
    } as { current: (() => void) | null };
    const session = buildSession({
      pendingQuestions: [],
      pendingPermissions: [],
      todos: [buildTodoItem({ content: "Keep transcript pinned", status: "in_progress" })],
    });
    const model = {
      ...buildBaseModel(),
      syncBottomAfterComposerLayoutRef,
      session,
      todoPanelCollapsed: true,
    };

    const rendered = render(
      createElement(AgentChatThread, {
        model,
      }),
    );
    await act(flush);
    syncBottomAfterComposerLayoutRef.current = syncBottomAfterComposerLayout;

    const bottomStack = rendered.container.querySelector(".agent-chat-bottom-stack");
    if (!(bottomStack instanceof HTMLDivElement)) {
      throw new Error("Expected bottom stack element");
    }
    const bottomStackWrapper = bottomStack.parentElement;
    if (!(bottomStackWrapper instanceof HTMLDivElement)) {
      throw new Error("Expected bottom stack wrapper element");
    }

    syncBottomAfterComposerLayout.mockClear();
    triggerResizeObservers(new Map([[bottomStackWrapper, 56]]));
    syncBottomAfterComposerLayout.mockClear();

    rendered.rerender(
      createElement(AgentChatThread, {
        model: {
          ...model,
          todoPanelCollapsed: false,
        },
      }),
    );
    await act(flush);

    syncBottomAfterComposerLayoutRef.current = syncBottomAfterComposerLayout;
    triggerResizeObservers(new Map([[bottomStackWrapper, 140]]));

    expect(syncBottomAfterComposerLayout).toHaveBeenCalledTimes(1);

    rendered.unmount();
  });
});
