import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { createRef } from "react";
import type { AgentChatThreadModel } from "./agent-chat.types";
import { buildMessage, buildQuestionRequest, buildSession } from "./agent-chat-test-fixtures";

const rowRenderSpy = mock(({ rowKey }: { rowKey: string }) => <div data-testid={rowKey} />);
const registerRowElement = () => () => {};

let AgentChatThread: typeof import("./agent-chat-thread").AgentChatThread;

const stableModelProps = {
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
} satisfies Omit<AgentChatThreadModel, "session">;

const buildModel = (session = buildSession()): AgentChatThreadModel => ({
  ...stableModelProps,
  session,
});

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
  mock.module("./use-agent-chat-window", () => ({
    useAgentChatWindow: ({ rows }: { rows: unknown[] }) => ({
      windowedRows: rows,
      windowStart: 0,
      isNearBottom: true,
      isNearTop: true,
      scrollToBottom: () => {},
      scrollToTop: () => {},
      scrollToBottomOnSend: () => {},
    }),
  }));

  ({ AgentChatThread } = await import("./agent-chat-thread"));
});

afterEach(() => {
  cleanup();
  rowRenderSpy.mockClear();
});

afterAll(() => {
  mock.restore();
});

describe("AgentChatThread", () => {
  test("keeps transcript rows stable when only pending questions change", () => {
    const message = buildMessage("assistant", "Stable transcript", {
      id: "assistant-1",
      meta: {
        kind: "assistant",
        agentRole: "spec",
        isFinal: false,
        profileId: "Hephaestus (Deep Agent)",
        durationMs: 1_200,
      },
    });
    const session = buildSession({
      messages: [message],
      pendingQuestions: [],
    });
    const nextSession = {
      ...session,
      pendingQuestions: [buildQuestionRequest({ requestId: "question-1" })],
    };
    const { rerender } = render(<AgentChatThread model={buildModel(session)} />);

    expect(rowRenderSpy).toHaveBeenCalledTimes(1);

    rerender(<AgentChatThread model={buildModel(nextSession)} />);

    expect(screen.getByTestId("question-question-1")).toBeDefined();
    expect(rowRenderSpy).toHaveBeenCalledTimes(1);
  });
});
