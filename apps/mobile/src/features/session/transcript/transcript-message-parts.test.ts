import { describe, expect, test } from "bun:test";
import { resolveAgentChatRuntimePresentation } from "@openducktor/frontend-core/sessions/send/agent-chat-runtime-presentation";
import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import { buildMessage } from "@openducktor/frontend-core/test-support/agent-chat-transcript-fixtures";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import {
  LONG_MESSAGE_CHARACTERS,
  MESSAGE_PART_CHARACTERS,
  messageParts,
} from "./transcript-message-parts";
import type { PresentToolCall } from "./transcript-row-type";

const presentToolCall: PresentToolCall = resolveAgentChatRuntimePresentation({
  runtimeDefinitions: [],
  runtimeKind: null,
}).presentToolCall;

const paragraph = (index: number): string =>
  `Paragraph ${index}. ${"The heron poled the ferry across the lake. ".repeat(8)}`;
const novel = (paragraphs: number): string =>
  Array.from({ length: paragraphs }, (_, index) => paragraph(index)).join("\n\n");

const messageRow = (message: AgentChatMessage): AgentChatTranscriptRow => ({
  kind: "message",
  key: `message:${message.id}`,
  message,
});
const answer = (content: string, id = "answer"): AgentChatTranscriptRow =>
  messageRow(
    buildMessage("assistant", content, { id, meta: { kind: "assistant", isFinal: true } }),
  );

describe("messageParts", () => {
  test("splits a long answer into parts that hold all of its text", () => {
    const content = novel(60);
    expect(content.length).toBeGreaterThan(LONG_MESSAGE_CHARACTERS);
    const parts = messageParts(answer(content), presentToolCall);
    expect(parts).not.toBeNull();
    expect(parts?.map((part) => part.chunk.text).join("")).toBe(content);
    expect(
      parts?.slice(0, -1).every((part) => part.chunk.text.length >= MESSAGE_PART_CHARACTERS),
    ).toBe(true);
    // Only the last part ends with the reply footer, so only it holds the message.
    expect(parts?.map((part) => part.message === null)).toEqual(
      parts?.map((_, index) => index < parts.length - 1),
    );
    expect(parts?.[0]?.previous).toBeNull();
    expect(parts?.[1]?.previous).toBe(parts?.[0]?.chunk ?? null);
  });

  test("splits long reasoning into parts that show as reasoning", () => {
    const reasoning = messageRow(
      buildMessage("thinking", novel(60), {
        id: "reasoning",
        meta: { kind: "reasoning", partId: "reasoning-part", completed: true },
      }),
    );
    const parts = messageParts(reasoning, presentToolCall) ?? [];
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.look === "reasoning")).toBe(true);
    expect(messageParts(answer(novel(60)), presentToolCall)?.[0]?.look).toBe("answer");
  });

  test("keeps a short answer, a user message, and a tool row whole", () => {
    expect(messageParts(answer(novel(3)), presentToolCall)).toBeNull();
    const long = novel(60);
    expect(
      messageParts(messageRow(buildMessage("user", long, { id: "user" })), presentToolCall),
    ).toBeNull();
    expect(
      messageParts(
        messageRow(
          buildMessage("tool", long, {
            id: "tool",
            meta: {
              kind: "tool",
              partId: "part",
              callId: "call",
              tool: "bash",
              toolType: "bash",
              status: "completed",
            },
          }),
        ),
        presentToolCall,
      ),
    ).toBeNull();
  });

  test("keeps the parts of earlier text while an answer streams, so only the last one renders", () => {
    const first = messageParts(answer(novel(40), "streamed"), presentToolCall) ?? [];
    const next = messageParts(answer(novel(60), "streamed"), presentToolCall) ?? [];
    expect(next.length).toBeGreaterThan(first.length);
    // The last part of the first text was the end of the answer. It now ends earlier.
    for (let index = 0; index < first.length - 1; index += 1)
      expect(next[index]).toBe(first[index]);
    expect(next[first.length - 1]).not.toBe(first.at(-1));
  });
});
