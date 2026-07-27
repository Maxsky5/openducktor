import { describe, expect, test } from "bun:test";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { finalizeClaudeHistory, loadClaudeHistory } from "./claude-agent-sdk-history-loader";

const latestProjectedMessage: AgentSessionHistoryMessage = {
  messageId: "assistant-2",
  role: "assistant",
  timestamp: "2026-07-17T10:01:02.000Z",
  text: "Second",
  parts: [],
};

const projectedHistory: AgentSessionHistoryMessage[] = [
  {
    messageId: "assistant-1",
    role: "assistant",
    timestamp: "2026-07-17T10:01:01.000Z",
    text: "First",
    parts: [],
  },
  latestProjectedMessage,
];

describe("finalizeClaudeHistory", () => {
  test("prepends the system prompt outside the transcript tail limit", () => {
    expect(
      finalizeClaudeHistory(
        {
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo",
          externalSessionId: "session-1",
          runtimePolicy: { kind: "claude" },
          systemPromptContext: {
            systemPrompt: "Build from the approved plan.",
            startedAt: "2026-07-17T10:01:00.000Z",
          },
          limit: 1,
        },
        projectedHistory,
      ),
    ).toEqual([
      {
        messageId: "claude-system-prompt:session-1",
        role: "system",
        timestamp: "2026-07-17T10:01:00.000Z",
        text: "System prompt:\n\nBuild from the approved plan.",
        parts: [],
      },
      latestProjectedMessage,
    ]);
  });

  test("omits an empty system prompt", () => {
    expect(
      finalizeClaudeHistory(
        {
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo",
          externalSessionId: "session-1",
          runtimePolicy: { kind: "claude" },
          systemPromptContext: {
            systemPrompt: "  ",
            startedAt: "2026-07-17T10:01:00.000Z",
          },
          limit: 1,
        },
        projectedHistory,
      ),
    ).toEqual([latestProjectedMessage]);
  });
});

describe("loadClaudeHistory", () => {
  test("does not import a transcript for a fresh live session without user turns", async () => {
    await expect(
      loadClaudeHistory(
        {
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/missing-worktree",
          externalSessionId: "fresh-session",
          runtimePolicy: { kind: "claude" },
          systemPromptContext: {
            systemPrompt: "Write a spec.",
            startedAt: "2026-07-17T10:01:00.000Z",
          },
        },
        () => "2026-07-17T10:01:01.000Z",
        { source: "fresh", userMessages: [] },
      ),
    ).resolves.toEqual([
      {
        messageId: "claude-system-prompt:fresh-session",
        role: "system",
        timestamp: "2026-07-17T10:01:00.000Z",
        text: "System prompt:\n\nWrite a spec.",
        parts: [],
      },
    ]);
  });

  test("imports persisted history for a resumed live session without new user turns", async () => {
    await expect(
      loadClaudeHistory(
        {
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/missing-worktree",
          externalSessionId: "resumed-session",
          runtimePolicy: { kind: "claude" },
        },
        () => "2026-07-17T10:01:01.000Z",
        { source: "persisted", userMessages: [] },
      ),
    ).rejects.toMatchObject({
      _tag: "HostOperationError",
      operation: "claude.session.history.import",
    });
  });
});
