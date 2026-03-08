import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement, createRef } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { buildMessage, buildSession, TEST_ROLE_OPTIONS } from "./agent-chat-test-fixtures";
import {
  AGENT_CHAT_VIRTUAL_ROW_GAP_PX,
  buildAgentChatVirtualRows,
} from "./agent-chat-thread-virtualization";

type VirtualizerOptions = {
  estimateSize: (index: number) => number;
  measureElement: (element: Element) => number;
  getItemKey: (index: number) => string | number;
  getScrollElement: () => Element | null;
};

const useVirtualizerOptionsByRender: VirtualizerOptions[] = [];

const useVirtualizerMock = mock((options: VirtualizerOptions) => {
  useVirtualizerOptionsByRender.push(options);
  return {
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    measureElement: () => 0,
    measure: () => {},
    scrollToIndex: () => {},
  };
});

mock.module("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: VirtualizerOptions) => useVirtualizerMock(options),
}));

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

describe("AgentChatThread virtualizer callbacks", () => {
  beforeEach(() => {
    useVirtualizerMock.mockClear();
    useVirtualizerOptionsByRender.length = 0;
  });

  afterAll(() => {
    mock.restore();
  });

  test("keeps virtualizer callback references stable when virtual rows change", async () => {
    const { AgentChatThread } = await import("./agent-chat-thread");

    const session = buildSession({
      messages: Array.from({ length: 45 }, (_, index) =>
        buildMessage("assistant", `Message ${index + 1}`, {
          id: `message-${index + 1}`,
        }),
      ),
    });
    const measuredRowKey = `${session.sessionId}:message-1`;
    const initialRows = buildAgentChatVirtualRows(session);
    const initialRowCount = initialRows.length;
    const appendedRowIndex = initialRowCount;
    const measuredRowIndex = initialRows.findIndex((row) => row.key === measuredRowKey);
    expect(measuredRowIndex).toBeGreaterThanOrEqual(0);
    const model = {
      ...baseModel,
      session,
    };

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        createElement(AgentChatThread, {
          model,
        }),
      );
    });

    const firstOptions = useVirtualizerOptionsByRender.at(-1);
    expect(firstOptions).toBeDefined();
    expect(firstOptions?.estimateSize(appendedRowIndex)).toBe(0);
    expect(firstOptions?.getItemKey(appendedRowIndex)).toBe(appendedRowIndex);

    const firstMeasureElement = firstOptions?.measureElement;
    expect(firstMeasureElement).toBeDefined();
    const measuredHeight = firstMeasureElement?.({
      getBoundingClientRect: () => ({ height: 32 }),
      getAttribute: (attributeName: string) => {
        if (attributeName === "data-row-key") {
          return measuredRowKey;
        }
        if (attributeName === "data-index") {
          return "999";
        }
        return null;
      },
    } as unknown as Element);
    expect(measuredHeight).toBe(32);
    const measuredRowTrailingGap =
      measuredRowIndex < initialRowCount - 1 ? AGENT_CHAT_VIRTUAL_ROW_GAP_PX : 0;
    expect(firstOptions?.estimateSize(measuredRowIndex)).toBe(32 + measuredRowTrailingGap);

    session.messages.push(
      buildMessage("assistant", "Message 46", {
        id: "message-46",
      }),
    );

    await act(async () => {
      renderer.update(
        createElement(AgentChatThread, {
          model,
        }),
      );
    });

    const secondOptions = useVirtualizerOptionsByRender.at(-1);
    expect(secondOptions).toBeDefined();

    expect(secondOptions?.estimateSize).toBe(firstOptions?.estimateSize);
    expect(secondOptions?.measureElement).toBe(firstOptions?.measureElement);
    expect(secondOptions?.getItemKey).toBe(firstOptions?.getItemKey);
    expect(secondOptions?.getScrollElement).toBe(firstOptions?.getScrollElement);
    const updatedRows = buildAgentChatVirtualRows(session);
    expect(firstOptions?.estimateSize(appendedRowIndex)).toBeGreaterThan(0);
    expect(firstOptions?.getItemKey(appendedRowIndex)).toBe(updatedRows[appendedRowIndex]?.key);

    await act(async () => {
      renderer.unmount();
    });
  });

  test("clears measured row cache when active session changes", async () => {
    const { AgentChatThread } = await import("./agent-chat-thread");

    const firstSession = buildSession({
      runtimeKind: "opencode",
      sessionId: "session-a",
      messages: Array.from({ length: 45 }, (_, index) =>
        buildMessage("assistant", `Session A Message ${index + 1}`, {
          id: `message-${index + 1}`,
        }),
      ),
    });
    const secondSession = buildSession({
      runtimeKind: "opencode",
      sessionId: "session-b",
      messages: Array.from({ length: 45 }, (_, index) =>
        buildMessage("assistant", `Session B Message ${index + 1}`, {
          id: `message-${index + 1}`,
        }),
      ),
    });
    const secondSessionFirstRowKey = `${secondSession.sessionId}:message-1`;
    let model = {
      ...baseModel,
      session: firstSession,
    };

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        createElement(AgentChatThread, {
          model,
        }),
      );
    });

    const firstOptions = useVirtualizerOptionsByRender.at(-1);
    expect(firstOptions).toBeDefined();
    const seededMeasurement = firstOptions?.measureElement({
      getBoundingClientRect: () => ({ height: 77 }),
      getAttribute: (attributeName: string) => {
        if (attributeName === "data-row-key") {
          return secondSessionFirstRowKey;
        }
        if (attributeName === "data-index") {
          return "0";
        }
        return null;
      },
    } as unknown as Element);
    expect(seededMeasurement).toBe(77);

    model = {
      ...baseModel,
      session: secondSession,
    };
    await act(async () => {
      renderer.update(
        createElement(AgentChatThread, {
          model,
        }),
      );
    });

    const secondOptions = useVirtualizerOptionsByRender.at(-1);
    expect(secondOptions).toBeDefined();
    const secondSessionRows = buildAgentChatVirtualRows(secondSession);
    const secondSessionRowIndex = secondSessionRows.findIndex(
      (row) => row.key === secondSessionFirstRowKey,
    );
    expect(secondSessionRowIndex).toBeGreaterThanOrEqual(0);
    const expectedDefaultEstimate =
      secondSessionRowIndex < secondSessionRows.length - 1 ? 1 + AGENT_CHAT_VIRTUAL_ROW_GAP_PX : 1;
    expect(secondOptions?.estimateSize(secondSessionRowIndex)).toBe(expectedDefaultEstimate);

    await act(async () => {
      renderer.unmount();
    });
  });
});
