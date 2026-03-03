import { describe, expect, test } from "bun:test";
import { createElement, createRef } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { buildMessage, buildSession } from "./agent-chat-test-fixtures";
import {
  AGENT_CHAT_VIRTUALIZATION_MIN_ROW_COUNT,
  type AgentChatVirtualRow,
} from "./agent-chat-thread-virtualization";
import { useAgentChatVirtualization } from "./use-agent-chat-virtualization";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

type AgentChatVirtualizationState = {
  activeSessionId: string | null;
  canRenderVirtualRows: boolean;
  hasRenderableSessionRows: boolean;
  shouldVirtualize: boolean;
  virtualRows: AgentChatVirtualRow[];
  virtualRowsToRender: Array<{
    row: AgentChatVirtualRow;
    virtualItem: {
      index: number;
      key: string | number;
      start: number;
    };
  }>;
};

const getLatestState = (stateRef: { current: AgentChatVirtualizationState | null }) => {
  const state = stateRef.current;
  if (!state) {
    throw new Error("Missing hook state");
  }
  return state;
};

describe("useAgentChatVirtualization", () => {
  test("returns empty state when no session is active", async () => {
    const messagesContainerRef = createRef<HTMLDivElement>();
    const latestStateRef: { current: AgentChatVirtualizationState | null } = { current: null };

    const Harness = (): null => {
      latestStateRef.current = useAgentChatVirtualization({
        session: null,
        messagesContainerRef,
      }) as AgentChatVirtualizationState;
      return null;
    };

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Harness));
      await flush();
    });

    const latest = getLatestState(latestStateRef);
    expect(latest.activeSessionId).toBeNull();
    expect(latest.shouldVirtualize).toBe(false);
    expect(latest.hasRenderableSessionRows).toBe(false);
    expect(latest.virtualRows).toHaveLength(0);
    expect(latest.virtualRowsToRender).toHaveLength(0);
    expect(latest.canRenderVirtualRows).toBe(false);

    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  });

  test("enables virtualization for sessions at threshold and exposes mapped rows", async () => {
    const messages = Array.from(
      { length: AGENT_CHAT_VIRTUALIZATION_MIN_ROW_COUNT + 2 },
      (_, index) =>
        buildMessage("assistant", `Message ${index + 1}`, { id: `message-${index + 1}` }),
    );
    const session = buildSession({ messages });
    const messagesContainerRef = createRef<HTMLDivElement>();
    const latestStateRef: { current: AgentChatVirtualizationState | null } = { current: null };

    const Harness = (): null => {
      latestStateRef.current = useAgentChatVirtualization({
        session,
        messagesContainerRef,
      }) as AgentChatVirtualizationState;
      return null;
    };

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Harness));
      await flush();
    });

    const latest = getLatestState(latestStateRef);
    expect(latest.activeSessionId).toBe(session.sessionId);
    expect(latest.shouldVirtualize).toBe(true);
    expect(latest.hasRenderableSessionRows).toBe(true);
    expect(latest.virtualRows.length).toBeGreaterThanOrEqual(
      AGENT_CHAT_VIRTUALIZATION_MIN_ROW_COUNT,
    );
    expect(latest.virtualRows.some((row) => row.kind === "message")).toBe(true);
    expect(latest.virtualRowsToRender.every((entry) => entry.row.key.length > 0)).toBe(true);

    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  });

  test("refreshes row model when message array mutates in place", async () => {
    const messages = Array.from(
      { length: AGENT_CHAT_VIRTUALIZATION_MIN_ROW_COUNT + 1 },
      (_, index) =>
        buildMessage("assistant", `Message ${index + 1}`, { id: `message-${index + 1}` }),
    );
    const session = buildSession({ messages });
    const messagesContainerRef = createRef<HTMLDivElement>();
    const latestStateRef: { current: AgentChatVirtualizationState | null } = { current: null };

    const Harness = (): null => {
      latestStateRef.current = useAgentChatVirtualization({
        session,
        messagesContainerRef,
      }) as AgentChatVirtualizationState;
      return null;
    };

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Harness));
      await flush();
    });

    session.messages.push(
      buildMessage("assistant", "Message added later", {
        id: "message-late",
      }),
    );

    await act(async () => {
      renderer?.update(createElement(Harness));
      await flush();
    });

    const latest = getLatestState(latestStateRef);
    const messageRows = latest.virtualRows.filter((row) => row.kind === "message");
    const lastMessageRow = messageRows.at(-1);
    if (!lastMessageRow || lastMessageRow.kind !== "message") {
      throw new Error("Missing latest message row");
    }
    expect(lastMessageRow.message.id).toBe("message-late");

    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  });

  test("maps virtual items only to valid row entries", async () => {
    const messages = Array.from(
      { length: AGENT_CHAT_VIRTUALIZATION_MIN_ROW_COUNT + 1 },
      (_, index) =>
        buildMessage("assistant", `Message ${index + 1}`, { id: `message-${index + 1}` }),
    );
    const session = buildSession({ messages });
    const messagesContainerRef = createRef<HTMLDivElement>();
    const latestStateRef: { current: AgentChatVirtualizationState | null } = { current: null };

    const Harness = (): null => {
      latestStateRef.current = useAgentChatVirtualization({
        session,
        messagesContainerRef,
      }) as AgentChatVirtualizationState;
      return null;
    };

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Harness));
      await flush();
    });

    const latest = getLatestState(latestStateRef);
    expect(
      latest.virtualRowsToRender.every(({ row, virtualItem }) => {
        return latest.virtualRows[virtualItem.index]?.key === row.key;
      }),
    ).toBe(true);

    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  });
});
