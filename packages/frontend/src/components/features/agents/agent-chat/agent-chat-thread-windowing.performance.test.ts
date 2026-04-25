import { describe, expect, test } from "bun:test";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { buildMessage, buildQuestionRequest, buildSession } from "./agent-chat-test-fixtures";
import { getAgentChatWindowRowsKey } from "./agent-chat-thread-windowing";

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
    const resolveMessageIdentityToken = createMessageIdentityResolver();

    const baselineSignature = getAgentChatWindowRowsKey(session, true, resolveMessageIdentityToken);
    const updatedSignature = getAgentChatWindowRowsKey(
      updatedSession,
      true,
      resolveMessageIdentityToken,
    );

    expect(updatedSignature).toBe(baselineSignature);
  });
});
