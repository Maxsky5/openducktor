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
  test("buildAgentChatVirtualRows keeps message order and stable synthetic row keys", () => {
    const session = buildSession({
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
        buildMessage("user", "Follow-up", { id: "user-1" }),
      ],
      draftAssistantText: "Streaming...",
      pendingQuestions: [],
    });

    const rows = buildAgentChatVirtualRows(session);

    expect(rows.map((row) => row.key)).toEqual([
      "session-1:assistant-1:duration",
      "session-1:assistant-1",
      "session-1:user-1",
      "session-1:draft",
    ]);
    expect(rows.map((row) => row.kind)).toEqual(["turn_duration", "message", "message", "draft"]);
  });

  test("buildAgentChatVirtualRows keeps row keys distinct across sessions with repeated message ids", () => {
    const firstSession = buildSession({
      sessionId: "session-a",
      messages: [buildMessage("assistant", "A", { id: "message-1" })],
      pendingQuestions: [],
    });
    const secondSession = buildSession({
      sessionId: "session-b",
      messages: [buildMessage("assistant", "B", { id: "message-1" })],
      pendingQuestions: [],
    });

    const firstKeys = buildAgentChatVirtualRows(firstSession).map((row) => row.key);
    const secondKeys = buildAgentChatVirtualRows(secondSession).map((row) => row.key);

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
      resolveMessageIdentityToken,
    );
    const updatedSignature = buildAgentChatVirtualRowsSignature(
      updatedSession,
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
      resolveMessageIdentityToken,
    );
    messages.push(buildMessage("assistant", "Message 2", { id: "message-2" }));
    const nextSignature = buildAgentChatVirtualRowsSignature(session, resolveMessageIdentityToken);

    expect(nextSignature).not.toBe(previousSignature);
  });

  test("buildAgentChatVirtualRowsSignature changes when a message object is replaced in place", () => {
    const messages = [buildMessage("assistant", "Message 1", { id: "message-1" })];
    const session = buildSession({ messages });
    const resolveMessageIdentityToken = createMessageIdentityResolver();

    const previousSignature = buildAgentChatVirtualRowsSignature(
      session,
      resolveMessageIdentityToken,
    );
    messages[0] = buildMessage("assistant", "Message 1 updated", { id: "message-1" });
    const nextSignature = buildAgentChatVirtualRowsSignature(session, resolveMessageIdentityToken);

    expect(nextSignature).not.toBe(previousSignature);
  });

  test("buildAgentChatVirtualRowsSignature changes when assistant duration mutates in place", () => {
    const messages = [
      buildMessage("assistant", "Message 1", {
        id: "message-1",
        meta: {
          kind: "assistant",
          agentRole: "spec",
          opencodeAgent: "Hephaestus (Deep Agent)",
          durationMs: 1_500,
        },
      }),
    ];
    const session = buildSession({ messages });
    const resolveMessageIdentityToken = createMessageIdentityResolver();
    const previousSignature = buildAgentChatVirtualRowsSignature(
      session,
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

    const nextSignature = buildAgentChatVirtualRowsSignature(session, resolveMessageIdentityToken);
    expect(nextSignature).not.toBe(previousSignature);
  });

  test("buildAgentChatVirtualRows appends thinking row when session is running without draft", () => {
    const session = buildSession({
      messages: [],
      draftAssistantText: "",
      pendingQuestions: [],
      status: "running",
    });

    const rows = buildAgentChatVirtualRows(session);

    expect(rows).toEqual([
      {
        kind: "thinking",
        key: "session-1:thinking",
      },
    ]);
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
