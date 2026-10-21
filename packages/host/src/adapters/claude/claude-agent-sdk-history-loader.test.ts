import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import {
  claudeLiveHistoryContext,
  finalizeClaudeHistory,
  loadClaudeHistory,
} from "./claude-agent-sdk-history-loader";
import { claudeSubagentEventSession } from "./claude-agent-sdk-event-session";
import { createClaudeSession } from "./claude-agent-sdk-session-io.test-support";

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

const withEmptyWorktree = async <Result>(
  run: (workingDirectory: string) => Promise<Result>,
): Promise<Result> => {
  const workingDirectory = await mkdtemp(join(tmpdir(), "openducktor-claude-history-"));
  try {
    return await run(workingDirectory);
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
};

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
        {
          activeBackgroundTaskIds: () => new Set(),
          hasActiveWork: () => false,
          source: "fresh",
          userMessages: [],
        },
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

  test("keeps a fresh accepted user turn visible before Claude creates its transcript", async () => {
    await withEmptyWorktree(async (workingDirectory) => {
      await expect(
        loadClaudeHistory(
          {
            repoPath: "/repo",
            runtimeKind: "claude",
            workingDirectory,
            externalSessionId: "00000000-0000-4000-8000-000000000001",
            runtimePolicy: { kind: "claude" },
          },
          () => "2026-07-17T10:01:01.000Z",
          {
            activeBackgroundTaskIds: () => new Set(),
            hasActiveWork: () => true,
            source: "fresh",
            userMessages: [
              {
                messageId: "user-1",
                text: "Inspect the prompt builder.",
                timestamp: "2026-07-17T10:01:00.000Z",
              },
            ],
          },
        ),
      ).resolves.toEqual([
        {
          messageId: "user-1",
          role: "user",
          timestamp: "2026-07-17T10:01:00.000Z",
          text: "Inspect the prompt builder.",
          displayParts: [{ kind: "text", text: "Inspect the prompt builder." }],
          state: "read",
          parts: [],
        },
      ]);
    });
    // Reads the real transcript store through the Agent SDK, which can outlast the host budget on Windows.
  }, 10_000);

  test("throws for a missing transcript after fresh live work stops", async () => {
    await expect(
      loadClaudeHistory(
        {
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/missing-worktree",
          externalSessionId: "fresh-session",
          runtimePolicy: { kind: "claude" },
        },
        () => "2026-07-17T10:01:01.000Z",
        {
          activeBackgroundTaskIds: () => new Set(),
          hasActiveWork: () => false,
          source: "fresh",
          userMessages: [
            {
              messageId: "user-1",
              text: "Inspect the prompt builder.",
              timestamp: "2026-07-17T10:01:00.000Z",
            },
          ],
        },
      ),
    ).rejects.toMatchObject({ code: "request_failed" });
  });

  test("rechecks fresh work after the transcript read starts", async () => {
    let hasActiveWork = true;
    const history = loadClaudeHistory(
      {
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/missing-worktree",
        externalSessionId: "fresh-session",
        runtimePolicy: { kind: "claude" },
      },
      () => "2026-07-17T10:01:01.000Z",
      {
        activeBackgroundTaskIds: () => new Set(),
        hasActiveWork: () => hasActiveWork,
        source: "fresh",
        userMessages: [
          {
            messageId: "user-1",
            text: "Inspect the prompt builder.",
            timestamp: "2026-07-17T10:01:00.000Z",
          },
        ],
      },
    );

    hasActiveWork = false;

    await expect(history).rejects.toMatchObject({ code: "request_failed" });
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
        {
          activeBackgroundTaskIds: () => new Set(),
          hasActiveWork: () => false,
          source: "persisted",
          userMessages: [],
        },
      ),
    ).rejects.toMatchObject({
      code: "request_failed",
    });
  });
});

describe("claudeLiveHistoryContext", () => {
  const acceptedUserMessage = {
    messageId: "00000000-0000-4000-8000-000000000002",
    parts: [],
    text: "follow-up",
    timestamp: "2026-06-25T20:00:01.000Z",
  };
  const acceptedUserMessages = [acceptedUserMessage];

  test("marks a started session as fresh and lists its accepted turns", () => {
    const context = claudeLiveHistoryContext(
      createClaudeSession({ acceptedUserMessages, pendingUserTurnCount: 1 }),
    );

    expect(context).toEqual({
      activeBackgroundTaskIds: expect.any(Function),
      hasActiveWork: expect.any(Function),
      source: "fresh",
      subagentAgentIdsByToolUseId: expect.any(Map),
      userMessages: [acceptedUserMessage],
    });
    expect(context.hasActiveWork()).toBe(true);
  });

  test("marks a resumed session as persisted and lists its accepted turns", () => {
    const context = claudeLiveHistoryContext(
      createClaudeSession({
        acceptedUserMessages,
        input: {
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo",
          externalSessionId: "session-1",
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        },
      }),
    );

    expect(context).toEqual({
      activeBackgroundTaskIds: expect.any(Function),
      hasActiveWork: expect.any(Function),
      source: "persisted",
      subagentAgentIdsByToolUseId: expect.any(Map),
      userMessages: [acceptedUserMessage],
    });
    expect(context.hasActiveWork()).toBe(false);
  });

  test("reads the current process task set after a snapshot replaces it", () => {
    const session = createClaudeSession({ backgroundToolActiveTaskIds: new Set(["task-1"]) });
    const context = claudeLiveHistoryContext(session);
    expect([...context.activeBackgroundTaskIds()]).toEqual(["task-1"]);
    session.backgroundToolActiveTaskIds = new Set();
    expect(context.activeBackgroundTaskIds().size).toBe(0);
  });

  test("uses current child activity without adding parent turns to child history", () => {
    const session = createClaudeSession({
      acceptedUserMessages,
      backgroundToolActiveTaskIds: new Set(["root-task"]),
    });
    session.subagentTaskIdsByToolUseId.set("agent-call", "agent-1");
    session.subagentTaskIdsByToolUseId.set("sibling-call", "agent-2");
    const child = claudeSubagentEventSession(session, "agent-call");
    const sibling = claudeSubagentEventSession(session, "sibling-call");
    expect(child).not.toBeNull();
    expect(sibling).not.toBeNull();
    if (!child || !sibling) return;
    child.backgroundToolActiveTaskIds = new Set(["child-task"]);
    child.subagentAgentIdsByToolUseId = new Map([["nested-call", "nested-agent"]]);
    sibling.backgroundToolActiveTaskIds = new Set(["sibling-task"]);
    expect([...claudeLiveHistoryContext(session).activeBackgroundTaskIds()]).toEqual([
      "root-task",
      "child-task",
      "sibling-task",
    ]);
    const context = claudeLiveHistoryContext(session, child.externalSessionId);
    expect(context.source).toBe("persisted");
    expect(context.userMessages).toEqual([]);
    expect(context.subagentAgentIdsByToolUseId).toBe(child.subagentAgentIdsByToolUseId);
    expect([...context.activeBackgroundTaskIds()]).toEqual(["child-task"]);
    child.backgroundToolActiveTaskIds.clear();
    expect(context.activeBackgroundTaskIds().size).toBe(0);
  });
});
