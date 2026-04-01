import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { act, createRef } from "react";
import type { AgentChatThreadModel } from "./agent-chat.types";
import { buildMessage, buildQuestionRequest, buildSession } from "./agent-chat-test-fixtures";

const ROW_HEIGHT_PX = 40;
const rowRenderSpy = mock(({ rowKey }: { rowKey: string }) => <div data-testid={rowKey} />);

let AgentChatThread: typeof import("./agent-chat-thread").AgentChatThread;

class MockResizeObserver implements ResizeObserver {
  observe(): void {}

  unobserve(): void {}

  disconnect(): void {}
}

const registerRowElement = (() => {
  const callbackByKey = new Map<string, (element: HTMLDivElement | null) => void>();

  return (rowKey: string) => {
    const cached = callbackByKey.get(rowKey);
    if (cached) {
      return cached;
    }

    const next = () => {};
    callbackByKey.set(rowKey, next);
    return next;
  };
})();

const flushEffects = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const buildMessages = (turnCount: number, sessionId: string) =>
  Array.from({ length: turnCount }, (_, index) => [
    buildMessage("user", `Question ${index}`, {
      id: `${sessionId}-user-${index}`,
      meta: {
        kind: "user",
        state: "sent",
      },
    }),
    buildMessage("assistant", `Answer ${index}`, {
      id: `${sessionId}-assistant-${index}`,
      meta: {
        kind: "assistant",
        agentRole: "spec",
        isFinal: true,
        profileId: "Hephaestus (Deep Agent)",
        durationMs: 1_000,
      },
    }),
  ]).flat();

const createStableThreadProps = () =>
  ({
    isSessionWorking: false,
    showThinkingMessages: true,
    isSessionViewLoading: false,
    isSessionHistoryLoading: false,
    isWaitingForRuntimeReadiness: false,
    roleOptions: [],
    readinessState: "ready" as const,
    agentStudioReady: true,
    blockedReason: null,
    isLoadingChecks: false,
    onRefreshChecks: () => {},
    taskSelected: true,
    canKickoffNewSession: false,
    kickoffLabel: "Kick off",
    onKickoff: () => {},
    isStarting: false,
    isSending: false,
    sessionAgentColors: {},
    isSubmittingQuestionByRequestId: {},
    onSubmitQuestionAnswers: async () => {},
    isSubmittingPermissionByRequestId: {},
    permissionReplyErrorByRequestId: {},
    onReplyPermission: async () => {},
    todoPanelCollapsed: false,
    onToggleTodoPanel: () => {},
    messagesContainerRef: createRef<HTMLDivElement>(),
    scrollToBottomOnSendRef: { current: null },
    syncBottomAfterComposerLayoutRef: { current: null },
  }) satisfies Omit<AgentChatThreadModel, "session">;

const buildModel = (
  session: AgentChatThreadModel["session"],
  stableProps: ReturnType<typeof createStableThreadProps>,
): AgentChatThreadModel => ({
  ...stableProps,
  session,
});

const attachScrollableMetrics = (container: HTMLDivElement) => {
  let scrollTopValue = 0;

  Object.defineProperty(container, "clientHeight", {
    configurable: true,
    get: () => 240,
  });
  Object.defineProperty(container, "scrollHeight", {
    configurable: true,
    get: () => container.querySelectorAll("[data-row-key]").length * ROW_HEIGHT_PX,
  });
  Object.defineProperty(container, "scrollTop", {
    configurable: true,
    get: () => scrollTopValue,
    set: (value: number) => {
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      scrollTopValue = Math.max(0, Math.min(value, maxScrollTop));
    },
  });
};

beforeAll(async () => {
  mock.module("./agent-chat-thread-row", () => ({
    AgentChatThreadRow: ({ row }: { row: { key: string } }): ReactElement => {
      rowRenderSpy({ rowKey: row.key });
      return <div data-testid={row.key}>{row.key}</div>;
    },
  }));
  mock.module("./agent-chat-thread-state", () => ({
    getAgentChatThreadState: () => ({
      isTranscriptLoading: false,
      hideTranscriptWhileHydrating: false,
      showRuntimeCheckingOverlay: false,
      showRuntimeBlockedCard: false,
    }),
  }));
  mock.module("./agent-session-question-card", () => ({
    AgentSessionQuestionCard: ({ request }: { request: { requestId: string } }): ReactElement => (
      <div data-testid={`question-${request.requestId}`}>{request.requestId}</div>
    ),
  }));
  mock.module("./agent-session-permission-card", () => ({
    AgentSessionPermissionCard: (): ReactElement => <div data-testid="permission-card" />,
  }));
  mock.module("./agent-session-todo-panel", () => ({
    AgentSessionTodoPanel: (): ReactElement => <div data-testid="todo-panel" />,
    getActionableSessionTodo: () => null,
    getVisibleSessionTodos: (todos: unknown[]) => todos,
  }));
  mock.module("./scroll-to-bottom-button", () => ({
    ScrollToBottomButton: (): null => null,
  }));
  mock.module("./scroll-to-top-button", () => ({
    ScrollToTopButton: (): null => null,
  }));
  mock.module("./use-agent-chat-deferred-transcript", () => ({
    useAgentChatDeferredTranscript: () => ({ isTranscriptRenderDeferred: false }),
  }));
  mock.module("./use-agent-chat-loading-overlay", () => ({
    useAgentChatLoadingOverlay: () => false,
  }));
  mock.module("./use-agent-chat-row-motion", () => ({
    useAgentChatRowMotion: () => ({
      registerRowElement,
    }),
  }));

  ({ AgentChatThread } = await import("./agent-chat-thread"));
});

describe("AgentChatThread", () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    cleanup();
    rowRenderSpy.mockClear();
    globalThis.ResizeObserver = originalResizeObserver;
  });

  afterAll(() => {
    mock.restore();
  });

  test("keeps transcript rows stable when only pending questions change", async () => {
    const stableProps = createStableThreadProps();
    const session = buildSession({
      sessionId: "session-1",
      messages: buildMessages(12, "session-1"),
      pendingQuestions: [],
    });
    const nextSession = {
      ...session,
      pendingQuestions: [buildQuestionRequest({ requestId: "question-1" })],
    };
    const { rerender } = render(<AgentChatThread model={buildModel(session, stableProps)} />);
    const container = stableProps.messagesContainerRef.current;

    if (!container) {
      throw new Error("Expected messages container");
    }

    attachScrollableMetrics(container);
    await flushEffects();
    const initialRenderCount = rowRenderSpy.mock.calls.length;

    rerender(<AgentChatThread model={buildModel(nextSession, stableProps)} />);
    await flushEffects();

    expect(screen.getByTestId("question-question-1")).toBeDefined();
    expect(rowRenderSpy.mock.calls.length).toBe(initialRenderCount);
  });

  test("switches transcript content on session change", async () => {
    const stableProps = createStableThreadProps();
    const firstSession = buildSession({
      sessionId: "session-a",
      messages: buildMessages(12, "session-a"),
    });
    const secondSession = buildSession({
      sessionId: "session-b",
      messages: buildMessages(12, "session-b"),
    });
    const { rerender } = render(<AgentChatThread model={buildModel(firstSession, stableProps)} />);
    const container = stableProps.messagesContainerRef.current;

    if (!container) {
      throw new Error("Expected messages container");
    }

    attachScrollableMetrics(container);
    await flushEffects();

    rerender(<AgentChatThread model={buildModel(secondSession, stableProps)} />);
    await flushEffects();

    expect(screen.getByTestId("session-b:session-b-user-2")).toBeDefined();
  });
});
