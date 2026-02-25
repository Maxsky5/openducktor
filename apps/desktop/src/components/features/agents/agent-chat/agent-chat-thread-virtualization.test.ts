import { describe, expect, test } from "bun:test";
import { buildMessage, buildSession } from "./agent-chat-test-fixtures";
import {
  buildAgentChatVirtualRows,
  buildVirtualRowLayout,
  findVirtualWindowRange,
  getVirtualWindowEdgeOffsets,
  normalizeVirtualWindowRange,
} from "./agent-chat-thread-virtualization";

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
        estimatedHeightPx: 44,
      },
    ]);
  });

  test("buildAgentChatVirtualRows uses compact estimates for regular tool activity rows", () => {
    const session = buildSession({
      status: "stopped",
      messages: [
        buildMessage("tool", "Tool todowrite completed", {
          id: "tool-1",
          meta: {
            kind: "tool",
            partId: "part-1",
            callId: "call-1",
            tool: "todowrite",
            status: "completed",
          },
        }),
      ],
      pendingQuestions: [],
    });

    const rows = buildAgentChatVirtualRows(session);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("message");
    if (!rows[0] || rows[0].kind !== "message") {
      throw new Error("Expected message row");
    }
    expect(rows[0].estimatedHeightPx).toBe(34);
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
