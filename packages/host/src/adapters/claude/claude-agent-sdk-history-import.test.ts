import { describe, expect, test } from "bun:test";
import type { SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import { filterClaudeHistoryMessages } from "./claude-agent-sdk-history-import";

describe("Claude SDK history import", () => {
  test("excludes meta peer queue entries using their paired SDK attachment", () => {
    const peerPrompt =
      '<agent-message from="Explore">Read-only exploration complete.</agent-message>';
    const compactQueueEntry = {
      type: "queue-operation",
      operation: "enqueue",
      timestamp: "2026-07-22T20:28:00.000Z",
      sessionId: "session-1",
      content: "/compact",
    } as const satisfies SessionStoreEntry;
    const entries: SessionStoreEntry[] = [
      {
        type: "queue-operation",
        operation: "enqueue",
        timestamp: "2026-07-22T20:27:59.026Z",
        sessionId: "session-1",
        content: peerPrompt,
      },
      {
        type: "attachment",
        uuid: "peer-attachment-1",
        timestamp: "2026-07-22T20:27:59.026Z",
        sessionId: "session-1",
        attachment: {
          type: "queued_command",
          prompt: peerPrompt,
          commandMode: "prompt",
          origin: {
            kind: "peer",
            from: "Explore",
            senderTaskId: "task-1",
            name: "Explore",
            body: "Read-only exploration complete.",
          },
          timestamp: "2026-07-22T20:27:59.026Z",
          isMeta: true,
        },
      },
      compactQueueEntry,
    ];

    expect(filterClaudeHistoryMessages(entries)).toEqual([compactQueueEntry]);
  });
});
