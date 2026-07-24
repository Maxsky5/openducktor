import { describe, expect, test } from "bun:test";
import {
  buildSession,
  createSessionsRef,
  createSessionUpdater,
  getSession,
  getSessionMessages,
  listenToAgentSessionEvents,
  type SessionEvent,
  type SessionEventAdapter,
  withMockedToast,
} from "./session-events-test-harness";

describe("agent-orchestrator session transcript events", () => {
  test("records inputReadyAtMs when tool input first becomes meaningful", async () => {
    const originalDateNow = Date.now;
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef = createSessionsRef([buildSession({ role: "planner" })]);

    const updateSession = createSessionUpdater(sessionsRef);

    try {
      await listenToAgentSessionEvents({
        adapter,
        repoPath: "/tmp/repo",
        externalSessionId: "session-1",
        sessionsRef,
        updateSession,
        resolveTurnDurationMs: () => undefined,
        clearTurnDuration: () => {},
        refreshTaskData: async () => {},
      });

      const handleEvent = handlers[0];
      if (!handleEvent) {
        throw new Error("Expected session event handler to be registered");
      }

      Date.now = () => Date.parse("2026-02-22T08:00:05.000Z");
      handleEvent({
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:05.000Z",
        part: {
          kind: "tool",
          messageId: "tool-msg-1",
          partId: "part-1",
          callId: "call-1",
          tool: "odt_set_spec",
          toolType: "generic" as const,
          status: "pending",
          input: {},
          output: "",
          error: "",
        },
      });

      const queuedMessage = getSessionMessages(sessionsRef).find(
        (message) => message.meta?.kind === "tool" && message.meta.callId === "call-1",
      );
      if (queuedMessage?.meta?.kind !== "tool") {
        throw new Error("Expected queued tool message");
      }
      expect(queuedMessage.meta.inputReadyAtMs).toBeUndefined();

      Date.now = () => Date.parse("2026-02-22T08:00:10.000Z");
      handleEvent({
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:10.000Z",
        part: {
          kind: "tool",
          messageId: "tool-msg-1",
          partId: "part-1",
          callId: "call-1",
          tool: "odt_set_spec",
          toolType: "generic" as const,
          status: "pending",
          input: {
            taskId: "fairnest-123",
            markdown: "# Plan",
          },
          output: "",
          error: "",
        },
      });

      const inputReadyMessage = getSessionMessages(sessionsRef).find(
        (message) => message.meta?.kind === "tool" && message.meta.callId === "call-1",
      );
      if (inputReadyMessage?.meta?.kind !== "tool") {
        throw new Error("Expected input-ready tool message");
      }
      expect(inputReadyMessage.meta.inputReadyAtMs).toBe(Date.parse("2026-02-22T08:00:10.000Z"));

      Date.now = () => Date.parse("2026-02-22T08:00:20.000Z");
      handleEvent({
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:20.000Z",
        part: {
          kind: "tool",
          messageId: "tool-msg-1",
          partId: "part-1",
          callId: "call-1",
          tool: "odt_set_spec",
          toolType: "generic" as const,
          status: "completed",
          input: {
            taskId: "fairnest-123",
            markdown: "# Plan",
          },
          output: "ok",
          error: "",
        },
      });

      const completedMessage = getSessionMessages(sessionsRef).find(
        (message) => message.meta?.kind === "tool" && message.meta.callId === "call-1",
      );
      if (completedMessage?.meta?.kind !== "tool") {
        throw new Error("Expected completed tool message");
      }
      expect(completedMessage.meta.inputReadyAtMs).toBe(Date.parse("2026-02-22T08:00:10.000Z"));
    } finally {
      Date.now = originalDateNow;
    }
  });

  test("preserves file edit diffs across later tool updates for the same call", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };
    const sessionsRef = createSessionsRef([buildSession({ status: "running" })]);
    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    const fileDiffs = [
      {
        file: "/tmp/repo/src/auth.ts",
        type: "modified" as const,
        additions: 1,
        deletions: 1,
        diff: "diff --git a/src/auth.ts b/src/auth.ts\n--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1,1 +1,1 @@\n-old\n+new",
      },
    ];

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:20.000Z",
      part: {
        kind: "tool",
        messageId: "tool-msg-1",
        partId: "toolu_edit_1",
        callId: "toolu_edit_1",
        tool: "Edit",
        toolType: "file_edit" as const,
        status: "completed",
        input: { file_path: "/tmp/repo/src/auth.ts" },
        output: "updated",
        fileDiffs,
      },
    });

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:21.000Z",
      part: {
        kind: "tool",
        messageId: "tool-msg-1",
        partId: "toolu_edit_1",
        callId: "toolu_edit_1",
        tool: "Edit",
        toolType: "file_edit" as const,
        status: "error",
        error: "<tool_use_error>File has not been read yet.</tool_use_error>",
      },
    });

    const message = getSessionMessages(sessionsRef).find(
      (entry) => entry.meta?.kind === "tool" && entry.meta.callId === "toolu_edit_1",
    );
    if (message?.meta?.kind !== "tool") {
      throw new Error("Expected Edit tool message");
    }
    expect(message.meta.status).toBe("error");
    expect(message.meta.fileDiffs).toEqual(fileDiffs);
    expect(message.meta.input).toEqual({ file_path: "/tmp/repo/src/auth.ts" });
  });

  test("does not revive an idle session from a terminal tool update", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };
    const sessionsRef = createSessionsRef([buildSession({ status: "running" })]);
    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }
    handleEvent({
      type: "session_idle",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:10.000Z",
    });
    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:11.000Z",
      part: {
        kind: "tool",
        messageId: "tool-msg-1",
        partId: "part-1",
        callId: "call-1",
        tool: "mcp__openducktor__odt_read_task",
        toolType: "workflow" as const,
        status: "completed",
        input: { taskId: "task-1" },
        output: "ok",
      },
    });

    expect(getSession(sessionsRef).status).toBe("idle");
    const toolMessage = getSessionMessages(sessionsRef).find(
      (message) => message.meta?.kind === "tool" && message.meta.callId === "call-1",
    );
    expect(toolMessage?.meta).toMatchObject({
      kind: "tool",
      input: { taskId: "task-1" },
      output: "ok",
      status: "completed",
    });
  });

  test("inserts delayed live tool rows by transcript timestamp instead of arrival order", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };
    const sessionsRef = createSessionsRef([buildSession({ status: "running" })]);
    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      eventBatchWindowMs: 0,
      sessionsRef,
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "assistant-final",
      timestamp: "2026-02-22T08:00:10.000Z",
      message: "Done.",
    });
    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:05.000Z",
      part: {
        kind: "tool",
        messageId: "tool-msg-1",
        partId: "part-1",
        callId: "call-1",
        tool: "Read",
        toolType: "read" as const,
        status: "running",
        input: { file_path: "src/auth.ts" },
      },
    });

    expect(getSessionMessages(sessionsRef).map((message) => message.id)).toEqual([
      "tool:tool-msg-1:call-1",
      "assistant-final",
    ]);

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:11.000Z",
      part: {
        kind: "tool",
        messageId: "tool-msg-1",
        partId: "part-1",
        callId: "call-1",
        tool: "Read",
        toolType: "read" as const,
        status: "completed",
        output: "ok",
      },
    });

    expect(getSessionMessages(sessionsRef).map((message) => message.id)).toEqual([
      "tool:tool-msg-1:call-1",
      "assistant-final",
    ]);
  });

  test("shows a toast when OpenDucktor starts MCP reconnect recovery", async () => {
    await withMockedToast(async ({ toastInfoMock }) => {
      const handlers: Array<(event: SessionEvent) => void> = [];
      const adapter: SessionEventAdapter = {
        subscribeEvents: async (_externalSessionId, handler) => {
          handlers.push(handler);
          return () => {};
        },
        replyApproval: async () => {},
      };
      const sessionsRef = createSessionsRef([buildSession({ role: "build" })]);

      await listenToAgentSessionEvents({
        adapter,
        repoPath: "/tmp/repo",
        externalSessionId: "session-1",
        sessionsRef,
        updateSession: () => null,
        resolveTurnDurationMs: () => undefined,
        clearTurnDuration: () => {},
        refreshTaskData: async () => {},
      });

      const handleEvent = handlers[0];
      if (!handleEvent) {
        throw new Error("Expected session event handler to be registered");
      }

      handleEvent({
        type: "mcp_reconnect_started",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:05.000Z",
        serverName: "openducktor",
        workingDirectory: "/tmp/repo/.openducktor/worktrees/task-1",
        status: "failed",
        errorDetails: "MCP error -32000: Connection closed",
      });

      expect(toastInfoMock).toHaveBeenCalledWith("Reconnecting OpenDucktor MCP", {
        description:
          "OpenDucktor MCP is failed for /tmp/repo/.openducktor/worktrees/task-1. MCP error -32000: Connection closed. OpenDucktor is trying to reconnect.",
      });
      expect(getSessionMessages(sessionsRef)).toEqual([]);
    });
  });

  test("runs completion side effects once for duplicate completed tool events", async () => {
    const cases = [
      {
        name: "workflow mutation tool refresh",
        tool: "odt_set_plan",
        toolType: "workflow" as const,
        output: "ok",
        expectedRefreshTaskDataCalls: 1,
      },
      {
        name: "todo tool refresh",
        tool: "todowrite",
        toolType: "todo" as const,
        output: '{"todos":[]}',
        expectedRefreshTaskDataCalls: 0,
      },
    ] as const;

    await Promise.all(
      cases.map(async (testCase) => {
        const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
        let refreshTaskDataCalls = 0;
        const refreshTaskDataArgs: Array<[string, string | undefined]> = [];

        const adapter: SessionEventAdapter = {
          subscribeEvents: async (_externalSessionId, handler) => {
            handlers.push(
              handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
            );
            return () => {};
          },
          replyApproval: async () => {},
        };

        const sessionsRef = createSessionsRef([buildSession({ role: "build" })]);

        const updateSession = createSessionUpdater(sessionsRef);

        await listenToAgentSessionEvents({
          adapter,
          repoPath: "/tmp/repo",
          externalSessionId: "session-1",
          sessionsRef,
          updateSession,
          resolveTurnDurationMs: () => undefined,
          clearTurnDuration: () => {},
          refreshTaskData: async (repoPath, taskIdOrIds) => {
            refreshTaskDataCalls += 1;
            refreshTaskDataArgs.push([
              repoPath,
              typeof taskIdOrIds === "string" ? taskIdOrIds : undefined,
            ]);
          },
        });

        const handleEvent = handlers[0];
        if (!handleEvent) {
          throw new Error("Expected session event handler to be registered");
        }

        handleEvent({
          type: "assistant_part",
          externalSessionId: "session-1",
          timestamp: "2026-02-22T08:00:05.000Z",
          part: {
            kind: "tool",
            messageId: "tool-msg-dup",
            partId: "part-dup",
            callId: "call-dup",
            tool: testCase.tool,
            toolType: testCase.toolType,
            status: "completed",
            output: testCase.output,
            error: "",
          },
        });

        handleEvent({
          type: "assistant_part",
          externalSessionId: "session-1",
          timestamp: "2026-02-22T08:00:06.000Z",
          part: {
            kind: "tool",
            messageId: "tool-msg-dup",
            partId: "part-dup",
            callId: "call-dup",
            tool: testCase.tool,
            toolType: testCase.toolType,
            status: "completed",
            output: testCase.output,
            error: "",
          },
        });

        await Promise.resolve();

        expect(refreshTaskDataCalls).toBe(testCase.expectedRefreshTaskDataCalls);
        if (testCase.expectedRefreshTaskDataCalls > 0) {
          expect(refreshTaskDataArgs).toEqual([["/tmp/repo", "task-1"]]);
        }
      }),
    );
  });
});
