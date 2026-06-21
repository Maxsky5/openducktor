import { describe, expect, test } from "bun:test";
import { buildMessage, buildQuestionRequest, buildSession } from "./agent-chat-test-fixtures";
import { buildAgentChatWindowRowsState } from "./agent-chat-thread-windowing";

describe("agent-chat-thread transcript keys", () => {
  test("stay stable when only pending questions change", () => {
    const session = buildSession({
      messages: [buildMessage("assistant", "Stable transcript", { id: "assistant-1" })],
      pendingQuestions: [],
    });
    const updatedSession = {
      ...session,
      pendingQuestions: [buildQuestionRequest({ requestId: "question-1" })],
    };

    const baselineKeys = buildAgentChatWindowRowsState(session, {
      showThinkingMessages: true,
    }).rows.map((row) => row.key);
    const updatedKeys = buildAgentChatWindowRowsState(updatedSession, {
      showThinkingMessages: true,
    }).rows.map((row) => row.key);

    expect(updatedKeys).toEqual(baselineKeys);
  });

  test("large transcript row derivation projects directly from session messages", () => {
    const messages = Array.from({ length: 240 }, (_, index) => {
      const turnIndex = Math.floor(index / 2);
      if (index % 2 === 0) {
        return buildMessage("user", `Question ${turnIndex}`, { id: `user-${turnIndex}` });
      }

      return buildMessage("assistant", `Answer ${turnIndex}`, { id: `assistant-${turnIndex}` });
    });
    const session = buildSession({
      externalSessionId: "session-large-transcript",
      messages,
    });
    const state = buildAgentChatWindowRowsState(session, { showThinkingMessages: true });

    expect(state.rows.filter((row) => row.kind === "message")).toHaveLength(240);
    expect(state.turns).toHaveLength(120);
  });
});
