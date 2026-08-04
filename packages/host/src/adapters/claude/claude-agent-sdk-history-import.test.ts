import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import {
  filterClaudeHistoryMessages,
  loadClaudeRawHistoryMessages,
  readSubagentAgentIdsByToolUseId,
} from "./claude-agent-sdk-history-import";

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

  test("maps nested subagent transcripts to Agent tool calls in the selected transcript", () => {
    const entriesBySubpath = new Map<string | undefined, SessionStoreEntry[]>([
      [
        "subagents/agent-parent",
        [
          {
            type: "assistant",
            uuid: "parent-agent-tool",
            timestamp: "2026-07-22T20:27:59.000Z",
            sessionId: "session-1",
            parent_tool_use_id: "root-agent-tool",
            message: {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  id: "nested-agent-tool",
                  name: "Agent",
                  input: { description: "Inspect nested behavior" },
                },
              ],
            },
          },
        ],
      ],
      [
        "subagents/agent-child",
        [
          {
            type: "assistant",
            uuid: "child-message",
            timestamp: "2026-07-22T20:28:00.000Z",
            sessionId: "session-1",
            parent_tool_use_id: "nested-agent-tool",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Inspecting." }],
            },
          },
        ],
      ],
    ]);

    expect(readSubagentAgentIdsByToolUseId(entriesBySubpath, "subagents/agent-parent")).toEqual(
      new Map([["nested-agent-tool", "child"]]),
    );
  });

  test("maps direct subagent transcripts to Agent tool calls in the root transcript", () => {
    const rootEntry = {
      type: "assistant",
      uuid: "root-agent-tool",
      timestamp: "2026-07-22T20:27:59.000Z",
      sessionId: "session-1",
      parent_tool_use_id: null,
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "root-agent-call",
            name: "Agent",
            input: { description: "Inspect behavior" },
          },
        ],
      },
    } as const satisfies SessionStoreEntry;
    const childEntry = {
      type: "assistant",
      uuid: "child-message",
      timestamp: "2026-07-22T20:28:00.000Z",
      sessionId: "session-1",
      parent_tool_use_id: "root-agent-call",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Inspecting." }],
      },
    } as const satisfies SessionStoreEntry;
    const entriesBySubpath = new Map<string | undefined, SessionStoreEntry[]>([
      [undefined, [rootEntry]],
      ["subagents/agent-child", [childEntry]],
    ]);

    expect(readSubagentAgentIdsByToolUseId(entriesBySubpath, undefined)).toEqual(
      new Map([["root-agent-call", "child"]]),
    );
    expect(
      filterClaudeHistoryMessages(entriesBySubpath.get(undefined) ?? []).map((entry) => entry.uuid),
    ).toEqual(["root-agent-tool"]);
  });

  test("propagates missing Claude transcripts as typed history errors", async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), "openducktor-claude-history-"));
    try {
      await expect(
        loadClaudeRawHistoryMessages({
          repoPath: workingDirectory,
          runtimeKind: "claude",
          workingDirectory,
          externalSessionId: "00000000-0000-4000-8000-000000000001",
          runtimePolicy: { kind: "claude" },
        }),
      ).rejects.toMatchObject({
        _tag: "HostOperationError",
        operation: "claude.session.history.import",
      });
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }, 15_000);
});
