import { describe, expect, test } from "bun:test";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { buildMessage, buildModelSelection, buildSession } from "./agent-chat-test-fixtures";
import {
  buildAgentChatVirtualRows,
  buildAgentChatVirtualRowsSignature,
  buildVirtualRowLayout,
  findVirtualWindowRange,
  getVirtualWindowEdgeOffsets,
  normalizeVirtualWindowRange,
  resolveAgentChatVirtualRowGapPx,
  resolveAgentChatVirtualRowSize,
} from "./agent-chat-thread-virtualization";

const createMessageIdentityResolver = (): ((message: AgentChatMessage) => number) => {
  const tokenByMessage = new WeakMap<AgentChatMessage, number>();
  let nextToken = 1;

  return (message: AgentChatMessage): number => {
    const cached = tokenByMessage.get(message);
    if (typeof cached === "number") {
      return cached;
    }

    const assignedToken = nextToken;
    nextToken += 1;
    tokenByMessage.set(message, assignedToken);
    return assignedToken;
  };
};

describe("agent-chat-thread virtualization helpers", () => {
  test("buildAgentChatVirtualRows keeps message order without synthetic draft rows", () => {
    const session = buildSession({
      messages: [
        buildMessage("assistant", "Done", {
          id: "assistant-1",
          meta: {
            kind: "assistant",
            agentRole: "spec",
            isFinal: true,
            profileId: "Hephaestus (Deep Agent)",
            durationMs: 1_500,
          },
        }),
        buildMessage("user", "Follow-up", { id: "user-1" }),
      ],
      pendingQuestions: [],
    });

    const rows = buildAgentChatVirtualRows(session, { showThinkingMessages: true });

    expect(rows.map((row) => row.key)).toEqual([
      "session-1:assistant-1:duration",
      "session-1:assistant-1",
      "session-1:user-1",
    ]);
    expect(rows.map((row) => row.kind)).toEqual(["turn_duration", "message", "message"]);
  });

  test("buildAgentChatVirtualRows keeps row keys distinct across sessions with repeated message ids", () => {
    const firstSession = buildSession({
      runtimeKind: "opencode",
      sessionId: "session-a",
      messages: [buildMessage("assistant", "A", { id: "message-1" })],
      pendingQuestions: [],
    });
    const secondSession = buildSession({
      runtimeKind: "opencode",
      sessionId: "session-b",
      messages: [buildMessage("assistant", "B", { id: "message-1" })],
      pendingQuestions: [],
    });

    const firstKeys = buildAgentChatVirtualRows(firstSession, { showThinkingMessages: true }).map(
      (row) => row.key,
    );
    const secondKeys = buildAgentChatVirtualRows(secondSession, { showThinkingMessages: true }).map(
      (row) => row.key,
    );

    expect(firstKeys).toContain("session-a:message-1");
    expect(secondKeys).toContain("session-b:message-1");
    expect(firstKeys).not.toContain("session-b:message-1");
  });

  test("buildAgentChatVirtualRowsSignature stays stable for non-row session updates", () => {
    const messages = [buildMessage("assistant", "Message 1", { id: "message-1" })];
    const baseSession = buildSession({
      messages,
      selectedModel: buildModelSelection({ variant: "high" }),
      isLoadingModelCatalog: false,
    });
    const updatedSession = {
      ...baseSession,
      selectedModel: buildModelSelection({ variant: "low" }),
      isLoadingModelCatalog: true,
    };
    const resolveMessageIdentityToken = createMessageIdentityResolver();

    const baselineSignature = buildAgentChatVirtualRowsSignature(
      baseSession,
      true,
      resolveMessageIdentityToken,
    );
    const updatedSignature = buildAgentChatVirtualRowsSignature(
      updatedSession,
      true,
      resolveMessageIdentityToken,
    );

    expect(updatedSignature).toBe(baselineSignature);
  });

  test("buildAgentChatVirtualRowsSignature changes when messages are appended in place", () => {
    const messages = [buildMessage("assistant", "Message 1", { id: "message-1" })];
    const session = buildSession({ messages });
    const resolveMessageIdentityToken = createMessageIdentityResolver();

    const previousSignature = buildAgentChatVirtualRowsSignature(
      session,
      true,
      resolveMessageIdentityToken,
    );
    messages.push(buildMessage("assistant", "Message 2", { id: "message-2" }));
    const nextSignature = buildAgentChatVirtualRowsSignature(
      session,
      true,
      resolveMessageIdentityToken,
    );

    expect(nextSignature).not.toBe(previousSignature);
  });

  test("buildAgentChatVirtualRowsSignature changes when a message object is replaced in place", () => {
    const messages = [buildMessage("assistant", "Message 1", { id: "message-1" })];
    const session = buildSession({ messages });
    const resolveMessageIdentityToken = createMessageIdentityResolver();

    const previousSignature = buildAgentChatVirtualRowsSignature(
      session,
      true,
      resolveMessageIdentityToken,
    );
    messages[0] = buildMessage("assistant", "Message 1 updated", { id: "message-1" });
    const nextSignature = buildAgentChatVirtualRowsSignature(
      session,
      true,
      resolveMessageIdentityToken,
    );

    expect(nextSignature).not.toBe(previousSignature);
  });

  test("buildAgentChatVirtualRowsSignature changes when assistant duration mutates in place", () => {
    const messages = [
      buildMessage("assistant", "Message 1", {
        id: "message-1",
        meta: {
          kind: "assistant",
          agentRole: "spec",
          profileId: "Hephaestus (Deep Agent)",
          durationMs: 1_500,
        },
      }),
    ];
    const session = buildSession({ messages });
    const resolveMessageIdentityToken = createMessageIdentityResolver();
    const previousSignature = buildAgentChatVirtualRowsSignature(
      session,
      true,
      resolveMessageIdentityToken,
    );

    const assistantMessage = messages[0];
    if (!assistantMessage) {
      throw new Error("Expected assistant message");
    }
    expect(assistantMessage.meta?.kind).toBe("assistant");
    if (assistantMessage.meta?.kind !== "assistant") {
      throw new Error("Expected assistant message metadata");
    }
    assistantMessage.meta.durationMs = 2_400;

    const nextSignature = buildAgentChatVirtualRowsSignature(
      session,
      true,
      resolveMessageIdentityToken,
    );
    expect(nextSignature).not.toBe(previousSignature);
  });

  test("buildAgentChatVirtualRows omits reasoning rows when showThinkingMessages is false", () => {
    const session = buildSession({
      messages: [
        buildMessage("user", "Question", { id: "user-1" }),
        buildMessage("thinking", "Reasoning", { id: "thinking-1" }),
        buildMessage("assistant", "Answer", { id: "assistant-1" }),
      ],
      pendingQuestions: [],
    });

    const visibleRows = buildAgentChatVirtualRows(session, { showThinkingMessages: true });
    const hiddenRows = buildAgentChatVirtualRows(session, { showThinkingMessages: false });

    expect(visibleRows.map((row) => row.key)).toEqual([
      "session-1:user-1",
      "session-1:thinking-1",
      "session-1:assistant-1:duration",
      "session-1:assistant-1",
    ]);
    expect(hiddenRows.map((row) => row.key)).toEqual([
      "session-1:user-1",
      "session-1:assistant-1:duration",
      "session-1:assistant-1",
    ]);
    expect(
      hiddenRows.some((row) => row.kind === "message" && row.message.role === "thinking"),
    ).toBe(false);
  });

  test("buildAgentChatVirtualRowsSignature changes when showThinkingMessages flips", () => {
    const session = buildSession({
      messages: [
        buildMessage("thinking", "Reasoning", { id: "thinking-1" }),
        buildMessage("assistant", "Answer", { id: "assistant-1" }),
      ],
    });
    const resolveMessageIdentityToken = createMessageIdentityResolver();

    const visibleSignature = buildAgentChatVirtualRowsSignature(
      session,
      true,
      resolveMessageIdentityToken,
    );
    const hiddenSignature = buildAgentChatVirtualRowsSignature(
      session,
      false,
      resolveMessageIdentityToken,
    );

    expect(hiddenSignature).not.toBe(visibleSignature);
  });

  test("buildAgentChatVirtualRows does not append synthetic thinking rows", () => {
    const session = buildSession({
      messages: [],
      draftAssistantText: "",
      pendingQuestions: [],
      status: "running",
    });

    const rows = buildAgentChatVirtualRows(session, { showThinkingMessages: true });

    expect(rows).toEqual([]);
  });

  test("row size helpers include the virtual gap for every row except the last", () => {
    expect(resolveAgentChatVirtualRowGapPx(0, 3)).toBe(4);
    expect(resolveAgentChatVirtualRowGapPx(2, 3)).toBe(0);
    expect(resolveAgentChatVirtualRowSize({ index: 0, rowCount: 3, rowHeight: 80 })).toBe(84);
    expect(resolveAgentChatVirtualRowSize({ index: 2, rowCount: 3, rowHeight: 80 })).toBe(80);
  });

  test("buildAgentChatVirtualRows skips turn duration rows for non-final assistant messages", () => {
    const session = buildSession({
      messages: [
        buildMessage("assistant", "Working", {
          id: "assistant-live",
          meta: {
            kind: "assistant",
            agentRole: "spec",
            isFinal: false,
            profileId: "Hephaestus (Deep Agent)",
            durationMs: 1_500,
          },
        }),
      ],
      pendingQuestions: [],
    });

    const rows = buildAgentChatVirtualRows(session, { showThinkingMessages: true });

    expect(rows.map((row) => row.kind)).toEqual(["message"]);
    expect(rows[0]?.key).toBe("session-1:assistant-live");
  });

  test("range and spacer helpers compute visible window boundaries", () => {
    const layout = buildVirtualRowLayout({
      itemHeights: [100, 120, 140, 160],
      gapPx: 4,
    });

    const range = findVirtualWindowRange({
      itemOffsets: layout.itemOffsets,
      itemHeights: [100, 120, 140, 160],
      totalHeight: layout.totalHeight,
      viewportStart: 110,
      viewportEnd: 280,
    });

    expect(range).toEqual({ startIndex: 1, endIndex: 2 });

    const spacers = getVirtualWindowEdgeOffsets({
      range,
      itemOffsets: layout.itemOffsets,
      itemHeights: [100, 120, 140, 160],
      totalHeight: layout.totalHeight,
    });

    expect(spacers).toEqual({
      topSpacerHeight: 104,
      bottomSpacerHeight: 164,
    });
  });

  test("normalizeVirtualWindowRange clamps stale ranges to valid row bounds", () => {
    expect(normalizeVirtualWindowRange({ startIndex: 500, endIndex: 520 }, 45)).toEqual({
      startIndex: 44,
      endIndex: 44,
    });
    expect(normalizeVirtualWindowRange({ startIndex: 0, endIndex: -1 }, 10)).toEqual({
      startIndex: 0,
      endIndex: 0,
    });
    expect(normalizeVirtualWindowRange({ startIndex: 0, endIndex: -1 }, 0)).toEqual({
      startIndex: 0,
      endIndex: -1,
    });
  });
});
