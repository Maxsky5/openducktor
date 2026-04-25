import { describe, expect, test } from "bun:test";
import {
  getSessionMessageAt,
  getSessionMessagesSlice,
} from "@/state/operations/agent-orchestrator/support/messages";
import { findFirstChangedMessageIndex } from "./agent-session-message-diff";
import { createAgentSessionFixture } from "./agent-studio-test-utils";

const createSession = (count: number) =>
  createAgentSessionFixture({
    messages: Array.from({ length: count }, (_, index) => ({
      id: `message-${index}`,
      role: "assistant" as const,
      content: `Message ${index}`,
      timestamp: `2026-02-22T08:${String(index % 60).padStart(2, "0")}:00.000Z`,
      meta: {
        kind: "assistant" as const,
        agentRole: "build" as const,
        isFinal: true,
      },
    })),
  });

describe("findFirstChangedMessageIndex", () => {
  test("returns the final index for tail-only message updates", () => {
    const previousSession = createSession(400);
    const previousMessages = previousSession.messages;
    const lastMessage = getSessionMessageAt(previousSession, 399);
    if (!lastMessage) {
      throw new Error("Expected last message fixture");
    }

    const nextMessages = getSessionMessagesSlice(previousSession, 0);
    nextMessages[399] = {
      ...lastMessage,
      content: "Updated final message",
    };
    const nextSession = {
      ...previousSession,
      messages: nextMessages,
    };

    expect(findFirstChangedMessageIndex(previousMessages, nextSession)).toBe(399);
  });

  test("returns the append point when new messages are added", () => {
    const previousSession = createSession(4);
    const previousMessages = previousSession.messages;
    const nextMessages = [
      ...getSessionMessagesSlice(previousSession, 0),
      {
        id: "message-4",
        role: "assistant" as const,
        content: "Message 4",
        timestamp: "2026-02-22T08:04:00.000Z",
        meta: {
          kind: "assistant" as const,
          agentRole: "build" as const,
          isFinal: true,
        },
      },
    ];
    const nextSession = {
      ...previousSession,
      messages: nextMessages,
    };

    expect(findFirstChangedMessageIndex(previousMessages, nextSession)).toBe(4);
  });
});
