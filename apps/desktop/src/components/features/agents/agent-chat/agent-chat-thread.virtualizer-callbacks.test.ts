import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement, createRef } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { buildMessage, buildSession, TEST_ROLE_OPTIONS } from "./agent-chat-test-fixtures";

type VirtualizerOptions = {
  estimateSize: (index: number) => number;
  measureElement: (element: Element) => number;
  getItemKey: (index: number) => string | number;
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

    await act(async () => {
      renderer.unmount();
    });
  });
});
