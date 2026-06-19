import { describe, expect, mock, test } from "bun:test";
import { handleCodexServerRequest } from "./codex-app-server-server-requests";
import { CodexPendingInputState } from "./codex-pending-input-state";
import type { CodexSessionState } from "./types";

describe("handleCodexServerRequest", () => {
  test("rejects mutating requests when the session role is unknown", async () => {
    const respondServerRequest = mock(async () => {});
    const events: unknown[] = [];
    const session: CodexSessionState = {
      summary: {
        externalSessionId: "thread-unknown-role",
        role: null,
        startedAt: "2026-05-07T00:00:00.000Z",
        status: "running",
      },
      systemPrompt: "Use the repo rules.",
      role: null,
      runtimeId: "runtime-live",
      repoPath: "/repo",
      threadId: "thread-unknown-role",
      workingDirectory: "/repo",
      taskId: "task-1",
    };

    await expect(
      handleCodexServerRequest(
        {
          respondServerRequest,
          pendingInput: new CodexPendingInputState(),
          activeTurnsBySessionId: new Map(),
          bindActiveTurnId: () => false,
          flushQueuedUserMessagesLater: () => {},
          emitSessionEvent: (_externalSessionId, event) => events.push(event),
        },
        session,
        {
          id: 29,
          method: "approval/request",
          params: {
            threadId: "thread-unknown-role",
            turnId: "turn-unknown-role",
            tool: "network",
            url: "https://example.com",
          },
        },
        new Set(),
      ),
    ).resolves.toBe(false);

    expect(respondServerRequest).toHaveBeenCalledWith(
      "runtime-live",
      29,
      expect.objectContaining({
        approved: false,
        outcome: "reject",
        message: expect.stringContaining("session role is unknown"),
      }),
      undefined,
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_error",
        message: expect.stringContaining("session role is unknown"),
      }),
    );
  });

  test("does not call non-mutating unknown-role rejections mutating", async () => {
    const respondServerRequest = mock(async () => {});
    const events: unknown[] = [];
    const session: CodexSessionState = {
      summary: {
        externalSessionId: "thread-unknown-role",
        role: null,
        startedAt: "2026-05-07T00:00:00.000Z",
        status: "running",
      },
      systemPrompt: "Use the repo rules.",
      role: null,
      runtimeId: "runtime-live",
      repoPath: "/repo",
      threadId: "thread-unknown-role",
      workingDirectory: "/repo",
      taskId: "task-1",
    };

    await handleCodexServerRequest(
      {
        respondServerRequest,
        pendingInput: new CodexPendingInputState(),
        activeTurnsBySessionId: new Map(),
        bindActiveTurnId: () => false,
        flushQueuedUserMessagesLater: () => {},
        emitSessionEvent: (_externalSessionId, event) => events.push(event),
      },
      session,
      {
        id: 30,
        method: "status/check",
        params: { threadId: "thread-unknown-role", turnId: "turn-unknown-role" },
      },
      new Set(),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_error",
        message: "Rejected Codex request 'status/check' because the session role is unknown.",
      }),
    );
  });
});
