import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import {
  claudeLiveHistoryContext,
  finalizeClaudeHistory,
  isClaudeSubagentTranscriptComplete,
  loadClaudeHistory,
  reconciledClaudeSubagentStatus,
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
                state: "read",
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
              state: "read",
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
            state: "read",
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
  const queuedMessage: SDKUserMessage = {
    type: "user",
    uuid: "00000000-0000-4000-8000-000000000002",
    session_id: "session-1",
    timestamp: "2026-06-25T20:00:01.000Z",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [{ type: "text", text: "queued follow-up" }],
    },
  };
  const acceptedUserMessage = {
    messageId: "00000000-0000-4000-8000-000000000002",
    parts: [],
    text: "queued follow-up",
    timestamp: "2026-06-25T20:00:01.000Z",
  };
  const acceptedUserMessages = [acceptedUserMessage];

  test("marks a started session as fresh and reports the queued state of accepted turns", () => {
    const context = claudeLiveHistoryContext(
      createClaudeSession({ acceptedUserMessages, queuedSdkMessages: [queuedMessage] }),
    );

    expect(context).toEqual({
      activeBackgroundTaskIds: expect.any(Function),
      hasActiveWork: expect.any(Function),
      source: "fresh",
      userMessages: [{ ...acceptedUserMessage, state: "queued" }],
    });
    expect(context.hasActiveWork()).toBe(true);
  });

  test("marks a resumed session as persisted and reads accepted turns as read", () => {
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
      userMessages: [{ ...acceptedUserMessage, state: "read" }],
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
    const session = createClaudeSession({ acceptedUserMessages });
    session.subagentTaskIdsByToolUseId.set("agent-call", "agent-1");
    const child = claudeSubagentEventSession(session, "agent-call");
    expect(child).not.toBeNull();
    if (!child) return;
    child.backgroundToolActiveTaskIds = new Set(["child-task"]);
    const context = claudeLiveHistoryContext(session, child.externalSessionId);
    expect(context.source).toBe("persisted");
    expect(context.userMessages).toEqual([]);
    expect([...context.activeBackgroundTaskIds()]).toEqual(["child-task"]);
    child.backgroundToolActiveTaskIds.clear();
    expect(context.activeBackgroundTaskIds().size).toBe(0);
  });
});

describe("isClaudeSubagentTranscriptComplete", () => {
  test("accepts only a final assistant message at the end of the SDK transcript", () => {
    expect(
      isClaudeSubagentTranscriptComplete([
        {
          type: "assistant",
          uuid: "assistant-final",
          session_id: "session-1",
          parent_tool_use_id: null,
          parent_agent_id: null,
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Review complete." }],
            stop_reason: "end_turn",
          },
        },
      ]),
    ).toBe(true);
    expect(
      isClaudeSubagentTranscriptComplete([
        {
          type: "assistant",
          uuid: "assistant-tool",
          session_id: "session-1",
          parent_tool_use_id: null,
          parent_agent_id: null,
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Still working." }],
            stop_reason: "tool_use",
          },
        },
      ]),
    ).toBe(false);
    expect(
      isClaudeSubagentTranscriptComplete([
        {
          type: "assistant",
          uuid: "assistant-final",
          session_id: "session-1",
          parent_tool_use_id: null,
          parent_agent_id: null,
          message: {
            role: "assistant",
            content: [{ type: "text", text: "First pass complete." }],
            stop_reason: "end_turn",
          },
        },
        {
          type: "user",
          uuid: "user-resume",
          session_id: "session-1",
          parent_tool_use_id: null,
          parent_agent_id: null,
          message: {
            role: "user",
            content: "Review one more file.",
          },
        },
      ]),
    ).toBe(false);
  });
});

describe("reconciledClaudeSubagentStatus", () => {
  const assistantMessage = (uuid: string, text: string, stopReason: string | null) =>
    ({
      type: "assistant",
      uuid,
      session_id: "session-1",
      parent_tool_use_id: null,
      parent_agent_id: null,
      message: {
        role: "assistant",
        content: [{ type: "text", text }],
        stop_reason: stopReason,
      },
    }) as const;

  test("settles a nested child from its terminal parent without a root notification", () => {
    expect(
      reconciledClaudeSubagentStatus(
        [assistantMessage("parent-final", "Parent complete.", "end_turn")],
        [assistantMessage("child-final", "Child report.", null)],
      ),
    ).toBe("completed");
  });

  test("keeps a nested child running while its parent is not terminal", () => {
    expect(
      reconciledClaudeSubagentStatus(
        [assistantMessage("parent-working", "Parent working.", null)],
        [assistantMessage("child-working", "Child report.", null)],
      ),
    ).toBeNull();
  });

  test("keeps an incomplete background child running after its parent turn ends", () => {
    expect(
      reconciledClaudeSubagentStatus(
        [assistantMessage("parent-final", "Parent complete.", "end_turn")],
        [assistantMessage("child-working", "Child report.", null)],
        "background",
      ),
    ).toBeNull();
  });

  test("completes a background child from its own terminal transcript", () => {
    expect(
      reconciledClaudeSubagentStatus(
        [assistantMessage("parent-final", "Parent complete.", "end_turn")],
        [assistantMessage("child-final", "Child complete.", "end_turn")],
        "background",
      ),
    ).toBe("completed");
  });
});
