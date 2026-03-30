import { describe, expect, test } from "bun:test";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { buildMessage, buildModelSelection, buildSession } from "./agent-chat-test-fixtures";
import {
  buildAgentChatWindowRows,
  buildAgentChatWindowTurns,
  CHAT_TURN_WINDOW_BATCH,
  CHAT_TURN_WINDOW_INIT,
  getAgentChatWindowRowsKey,
} from "./agent-chat-thread-windowing";

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

describe("agent-chat-thread windowing helpers", () => {
  test("exports the turn window constants", () => {
    expect(CHAT_TURN_WINDOW_INIT).toBe(10);
    expect(CHAT_TURN_WINDOW_BATCH).toBe(8);
  });

  test("buildAgentChatWindowRows keeps message order without synthetic draft rows", () => {
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

    const rows = buildAgentChatWindowRows(session, { showThinkingMessages: true });

    expect(rows.map((row) => row.key)).toEqual([
      "session-1:assistant-1:duration",
      "session-1:assistant-1",
      "session-1:user-1",
    ]);
    expect(rows.map((row) => row.kind)).toEqual(["turn_duration", "message", "message"]);
  });

  test("buildAgentChatWindowTurns groups transcript rows by user turns", () => {
    const session = buildSession({
      messages: [
        buildMessage("assistant", "Prelude", { id: "assistant-0" }),
        buildMessage("user", "Question 1", { id: "user-1" }),
        buildMessage("assistant", "Answer 1", { id: "assistant-1" }),
        buildMessage("user", "Question 2", { id: "user-2" }),
        buildMessage("assistant", "Answer 2", { id: "assistant-2" }),
      ],
      pendingQuestions: [],
    });

    const rows = buildAgentChatWindowRows(session, { showThinkingMessages: true });
    const turns = buildAgentChatWindowTurns(rows);

    expect(turns).toEqual([
      {
        key: "session-1:assistant-0:duration",
        start: 0,
        end: 1,
      },
      {
        key: "session-1:user-1",
        start: 2,
        end: 4,
      },
      {
        key: "session-1:user-2",
        start: 5,
        end: 7,
      },
    ]);
  });

  test("buildAgentChatWindowRows keeps row keys distinct across sessions with repeated message ids", () => {
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

    const firstKeys = buildAgentChatWindowRows(firstSession, { showThinkingMessages: true }).map(
      (row) => row.key,
    );
    const secondKeys = buildAgentChatWindowRows(secondSession, { showThinkingMessages: true }).map(
      (row) => row.key,
    );

    expect(firstKeys).toContain("session-a:message-1");
    expect(secondKeys).toContain("session-b:message-1");
    expect(firstKeys).not.toContain("session-b:message-1");
  });

  test("getAgentChatWindowRowsKey stays stable for non-row session updates", () => {
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

    const baselineSignature = getAgentChatWindowRowsKey(
      baseSession,
      true,
      resolveMessageIdentityToken,
    );
    const updatedSignature = getAgentChatWindowRowsKey(
      updatedSession,
      true,
      resolveMessageIdentityToken,
    );

    expect(updatedSignature).toBe(baselineSignature);
  });

  test("getAgentChatWindowRowsKey changes when messages are appended in place", () => {
    const messages = [buildMessage("assistant", "Message 1", { id: "message-1" })];
    const session = buildSession({ messages });
    const resolveMessageIdentityToken = createMessageIdentityResolver();

    const previousSignature = getAgentChatWindowRowsKey(session, true, resolveMessageIdentityToken);
    messages.push(buildMessage("assistant", "Message 2", { id: "message-2" }));
    const nextSignature = getAgentChatWindowRowsKey(session, true, resolveMessageIdentityToken);

    expect(nextSignature).not.toBe(previousSignature);
  });

  test("getAgentChatWindowRowsKey changes when a message object is replaced in place", () => {
    const messages = [buildMessage("assistant", "Message 1", { id: "message-1" })];
    const session = buildSession({ messages });
    const resolveMessageIdentityToken = createMessageIdentityResolver();

    const previousSignature = getAgentChatWindowRowsKey(session, true, resolveMessageIdentityToken);
    messages[0] = buildMessage("assistant", "Message 1 updated", { id: "message-1" });
    const nextSignature = getAgentChatWindowRowsKey(session, true, resolveMessageIdentityToken);

    expect(nextSignature).not.toBe(previousSignature);
  });

  test("getAgentChatWindowRowsKey changes when assistant duration mutates in place", () => {
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
    const previousSignature = getAgentChatWindowRowsKey(session, true, resolveMessageIdentityToken);

    const assistantMessage = messages[0];
    if (!assistantMessage || assistantMessage.meta?.kind !== "assistant") {
      throw new Error("Expected assistant message metadata");
    }

    assistantMessage.meta.durationMs = 2_400;

    const nextSignature = getAgentChatWindowRowsKey(session, true, resolveMessageIdentityToken);
    expect(nextSignature).not.toBe(previousSignature);
  });

  test("buildAgentChatWindowRows omits reasoning rows when showThinkingMessages is false", () => {
    const session = buildSession({
      messages: [
        buildMessage("user", "Question", { id: "user-1" }),
        buildMessage("thinking", "Reasoning", { id: "thinking-1" }),
        buildMessage("assistant", "Answer", { id: "assistant-1" }),
      ],
      pendingQuestions: [],
    });

    const visibleRows = buildAgentChatWindowRows(session, { showThinkingMessages: true });
    const hiddenRows = buildAgentChatWindowRows(session, { showThinkingMessages: false });

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

  test("getAgentChatWindowRowsKey changes when showThinkingMessages flips", () => {
    const session = buildSession({
      messages: [
        buildMessage("thinking", "Reasoning", { id: "thinking-1" }),
        buildMessage("assistant", "Answer", { id: "assistant-1" }),
      ],
    });
    const resolveMessageIdentityToken = createMessageIdentityResolver();

    const visibleSignature = getAgentChatWindowRowsKey(session, true, resolveMessageIdentityToken);
    const hiddenSignature = getAgentChatWindowRowsKey(session, false, resolveMessageIdentityToken);

    expect(hiddenSignature).not.toBe(visibleSignature);
  });

  test("buildAgentChatWindowRows does not append synthetic thinking rows", () => {
    const session = buildSession({
      messages: [],
      draftAssistantText: "",
      pendingQuestions: [],
      status: "running",
    });

    const rows = buildAgentChatWindowRows(session, { showThinkingMessages: true });

    expect(rows).toEqual([]);
  });

  test("buildAgentChatWindowRows skips turn duration rows for non-final assistant messages", () => {
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

    const rows = buildAgentChatWindowRows(session, { showThinkingMessages: true });

    expect(rows.map((row) => row.kind)).toEqual(["message"]);
    expect(rows[0]?.key).toBe("session-1:assistant-live");
  });
});
