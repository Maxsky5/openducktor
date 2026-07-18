import { describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@openducktor/core";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import {
  applyClaudeSessionModel,
  consumeClaudeSession,
  flushQueuedClaudeUserMessage,
  sendClaudeUserMessage,
} from "./claude-agent-sdk-session-io";
import {
  claudeQueryWithMessages,
  createClaudeSession,
  openClaudeQueryWithMessages,
  waitForTimers,
} from "./claude-agent-sdk-session-io.test-support";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";
import { emitClaudeMirroredFileEditToolResult } from "./claude-agent-sdk-transcript-mirror-events";
import { createClaudeTranscriptMirrorStore } from "./claude-agent-sdk-transcript-mirror-store";
import type { ClaudeSession } from "./claude-agent-sdk-types";

describe("sendClaudeUserMessage", () => {
  test("uses Claude SDK message timestamps for live transcript events", async () => {
    const events: AgentEvent[] = [];
    const session = createClaudeSession({
      query: claudeQueryWithMessages([
        claudeSdkMessageFixture({
          type: "assistant",
          uuid: "assistant-1",
          session_id: "session-1",
          timestamp: "2026-06-25T20:00:10.000Z",
          message: {
            role: "assistant",
            model: "claude-sonnet-4-6",
            stop_reason: "end_turn",
            content: [{ type: "text", text: "Done." }],
          },
        }),
      ]),
    });
    const closed = { value: false };

    await consumeClaudeSession({
      session,
      now: () => "2026-06-25T20:01:00.000Z",
      emit: (_session, event) => events.push(event),
      sessionStore: {
        get: (externalSessionId) =>
          !closed.value && externalSessionId === session.externalSessionId ? session : undefined,
        close: () => {
          closed.value = true;
        },
      },
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "assistant_message",
        messageId: "assistant-1",
        timestamp: "2026-06-25T20:00:10.000Z",
      }),
    );
  });

  test("emits current context usage from the Claude SDK control API after result messages", async () => {
    const events: AgentEvent[] = [];
    const closed = { value: false };
    const getContextUsage = mock(async () => {
      await Promise.resolve();
      if (closed.value) {
        throw new Error("Query was closed before context usage was read.");
      }
      return {
        totalTokens: 42_000,
        maxTokens: 1_000_000,
      };
    });
    const session = createClaudeSession({
      query: Object.assign(
        claudeQueryWithMessages([
          claudeSdkMessageFixture({
            type: "result",
            subtype: "success",
            uuid: "result-1",
            session_id: "session-1",
            timestamp: "2026-06-25T20:00:10.000Z",
            is_error: false,
            result: "Done.",
            stop_reason: "end_turn",
            terminal_reason: "completed",
            usage: {
              input_tokens: 1_600_000,
              output_tokens: 74_127,
            },
          }),
        ]),
        { getContextUsage },
      ),
    });

    await consumeClaudeSession({
      session,
      now: () => "2026-06-25T20:01:00.000Z",
      emit: (_session, event) => events.push(event),
      sessionStore: {
        get: (externalSessionId) =>
          !closed.value && externalSessionId === session.externalSessionId ? session : undefined,
        close: () => {
          closed.value = true;
          session.query.close();
        },
      },
    });
    await waitForTimers();

    expect(getContextUsage).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({
      type: "session_context_updated",
      externalSessionId: "session-1",
      timestamp: "2026-06-25T20:00:10.000Z",
      totalTokens: 42_000,
      contextWindow: 1_000_000,
    });
    const assistantMessage = events.find((event) => event.type === "assistant_message");
    expect(assistantMessage).toEqual(
      expect.not.objectContaining({
        totalTokens: 1_674_127,
      }),
    );
  });

  test("does not emit a terminal session error when live context usage refresh fails", async () => {
    const events: AgentEvent[] = [];
    const warn = console.warn;
    const warnMock = mock(() => {});
    console.warn = warnMock;
    const getContextUsage = mock(async () => {
      throw new Error("context unavailable");
    });
    const session = createClaudeSession({
      query: Object.assign(
        claudeQueryWithMessages([
          claudeSdkMessageFixture({
            type: "result",
            subtype: "success",
            uuid: "result-1",
            session_id: "session-1",
            timestamp: "2026-06-25T20:00:10.000Z",
            is_error: false,
            result: "Done.",
            stop_reason: "end_turn",
            terminal_reason: "completed",
          }),
        ]),
        { getContextUsage },
      ),
    });
    const closed = { value: false };

    try {
      await consumeClaudeSession({
        session,
        now: () => "2026-06-25T20:01:00.000Z",
        emit: (_session, event) => events.push(event),
        sessionStore: {
          get: (externalSessionId) =>
            !closed.value && externalSessionId === session.externalSessionId ? session : undefined,
          close: () => {
            closed.value = true;
            session.query.close();
          },
        },
      });
      await waitForTimers();
    } finally {
      console.warn = warn;
    }

    expect(getContextUsage).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledWith(
      "Failed to refresh Claude context usage for session 'session-1': context unavailable",
    );
    expect(events).toContainEqual({
      type: "session_context_error",
      externalSessionId: "session-1",
      timestamp: "2026-06-25T20:00:10.000Z",
      message: "context unavailable",
    });
    expect(events.some((event) => event.type === "session_error")).toBe(false);
    expect(events.some((event) => event.type === "session_finished")).toBe(true);
  });

  test("refreshes current context usage while a live assistant message is still streaming", async () => {
    const events: AgentEvent[] = [];
    const getContextUsage = mock(async () => ({
      totalTokens: 95_000,
      maxTokens: 200_000,
    }));
    const { query, release } = openClaudeQueryWithMessages([
      claudeSdkMessageFixture({
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        timestamp: "2026-06-25T20:00:10.000Z",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          stop_reason: null,
          content: [{ type: "text", text: "Working..." }],
        },
      }),
    ]);
    const session = createClaudeSession({
      query: Object.assign(query, { getContextUsage }),
    });
    const closed = { value: false };

    const consumePromise = consumeClaudeSession({
      session,
      now: () => "2026-06-25T20:01:00.000Z",
      emit: (_session, event) => events.push(event),
      sessionStore: {
        get: (externalSessionId) =>
          !closed.value && externalSessionId === session.externalSessionId ? session : undefined,
        close: () => {
          closed.value = true;
        },
      },
    });

    await waitForTimers();

    expect(getContextUsage).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({
      type: "session_context_updated",
      externalSessionId: "session-1",
      timestamp: "2026-06-25T20:00:10.000Z",
      totalTokens: 95_000,
      contextWindow: 200_000,
    });
    expect(events.some((event) => event.type === "session_finished")).toBe(false);

    release();
    await consumePromise;
  });

  test("does not refresh context usage for tool-use continuation results", async () => {
    const events: AgentEvent[] = [];
    const getContextUsage = mock(async () => ({
      totalTokens: 42_000,
      maxTokens: 1_000_000,
    }));
    const session = createClaudeSession({
      query: Object.assign(
        claudeQueryWithMessages([
          claudeSdkMessageFixture({
            type: "result",
            subtype: "success",
            uuid: "result-1",
            session_id: "session-1",
            timestamp: "2026-06-25T20:00:10.000Z",
            is_error: false,
            stop_reason: "tool_use",
            terminal_reason: "tool_use",
            usage: {
              input_tokens: 20_000,
              output_tokens: 1_000,
            },
          }),
        ]),
        { getContextUsage },
      ),
    });
    const closed = { value: false };

    await consumeClaudeSession({
      session,
      now: () => "2026-06-25T20:01:00.000Z",
      emit: (_session, event) => events.push(event),
      sessionStore: {
        get: (externalSessionId) =>
          !closed.value && externalSessionId === session.externalSessionId ? session : undefined,
        close: () => {
          closed.value = true;
        },
      },
    });

    expect(getContextUsage).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === "session_context_updated")).toBe(false);
  });
});

describe("Claude session I/O mirrored file edits", () => {
  test("enriches live file edit results from the Claude SDK transcript mirror", async () => {
    const events: AgentEvent[] = [];
    const transcriptStore = createClaudeTranscriptMirrorStore();
    transcriptStore.registerSessionDirectory({ dir: "/repo", sessionId: "session-1" });
    const session = createClaudeSession({
      query: claudeQueryWithMessages([
        claudeSdkMessageFixture({
          type: "assistant",
          uuid: "assistant-1",
          session_id: "session-1",
          timestamp: "2026-06-25T20:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "tool-edit-1",
                name: "Edit",
                input: {
                  file_path: "/repo/apps/api/src/lib/auth.ts",
                  old_string:
                    "  socialProviders: {\n    google: {\n      clientId: process.env.AUTH_GOOGLE_ID ?? '',\n      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? '',\n    },\n  },",
                  new_string:
                    "  socialProviders: {\n    google: {\n      clientId: process.env.AUTH_GOOGLE_ID ?? '',\n      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? '',\n    },\n    github: {\n      clientId: process.env.AUTH_GITHUB_ID ?? '',\n      clientSecret: process.env.AUTH_GITHUB_SECRET ?? '',\n    },\n  },",
                },
              },
            ],
            stop_reason: "tool_use",
          },
        }),
        claudeSdkMessageFixture({
          type: "user",
          uuid: "user-1",
          session_id: "session-1",
          parent_tool_use_id: "tool-edit-1",
          timestamp: "2026-06-25T20:00:01.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-edit-1",
                content: "The file /repo/apps/api/src/lib/auth.ts has been updated successfully.",
              },
            ],
          },
        }),
      ]),
    });
    const closed = { value: false };
    await transcriptStore.append({ projectKey: "repo", sessionId: "session-1" }, [
      {
        type: "user",
        uuid: "user-1",
        parent_tool_use_id: "tool-edit-1",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-edit-1",
              content: "The file /repo/apps/api/src/lib/auth.ts has been updated successfully.",
            },
          ],
        },
        toolUseResult: {
          filePath: "/repo/apps/api/src/lib/auth.ts",
          oldString:
            "  socialProviders: {\n    google: {\n      clientId: process.env.AUTH_GOOGLE_ID ?? '',\n      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? '',\n    },\n  },",
          newString:
            "  socialProviders: {\n    google: {\n      clientId: process.env.AUTH_GOOGLE_ID ?? '',\n      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? '',\n    },\n    github: {\n      clientId: process.env.AUTH_GITHUB_ID ?? '',\n      clientSecret: process.env.AUTH_GITHUB_SECRET ?? '',\n    },\n  },",
          originalFile: "",
          structuredPatch: [
            {
              oldStart: 50,
              oldLines: 6,
              newStart: 50,
              newLines: 10,
              lines: [
                "       clientId: process.env.AUTH_GOOGLE_ID ?? '',",
                "       clientSecret: process.env.AUTH_GOOGLE_SECRET ?? '',",
                "     },",
                "+    github: {",
                "+      clientId: process.env.AUTH_GITHUB_ID ?? '',",
                "+      clientSecret: process.env.AUTH_GITHUB_SECRET ?? '',",
                "+    },",
                "   },",
                "   emailAndPassword: {",
                "     enabled: !isProduction",
              ],
            },
          ],
          userModified: false,
          replaceAll: false,
        },
      },
    ]);

    await consumeClaudeSession({
      session,
      transcriptStore,
      now: () => "2026-06-25T20:01:00.000Z",
      emit: (_session, event) => events.push(event),
      sessionStore: {
        get: (externalSessionId) =>
          !closed.value && externalSessionId === session.externalSessionId ? session : undefined,
        close: () => {
          closed.value = true;
        },
      },
    });

    const completedToolEvent = events.find(
      (event) =>
        event.type === "assistant_part" &&
        event.part.kind === "tool" &&
        event.part.status === "completed",
    );
    const fileDiff =
      completedToolEvent?.type === "assistant_part" && completedToolEvent.part.kind === "tool"
        ? completedToolEvent.part.fileDiffs?.[0]
        : undefined;

    expect(fileDiff).toMatchObject({
      file: "/repo/apps/api/src/lib/auth.ts",
      additions: 4,
      deletions: 0,
    });
    expect(fileDiff?.diff).toContain("@@ -50,6 +50,10 @@");
    expect(fileDiff?.diff).toContain("+    github: {");
    expect(fileDiff?.diff).not.toContain("-  socialProviders: {");
  });

  test("updates live file edit results when the Claude SDK mirror entry arrives after the SDK result", () => {
    const events: AgentEvent[] = [];
    const session = createClaudeSession();
    session.toolNamesByCallId.set("tool-edit-1", "Edit");
    session.toolMessageIdsByCallId.set("tool-edit-1", "assistant-1");
    session.toolStartedAtMsByCallId.set("tool-edit-1", Date.parse("2026-06-25T20:00:00.000Z"));
    session.toolInputsByCallId.set("tool-edit-1", {
      file_path: "/repo/apps/api/src/lib/auth.ts",
      old_string:
        "  socialProviders: {\n    google: {\n      clientId: process.env.AUTH_GOOGLE_ID ?? '',\n      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? '',\n    },\n  },",
      new_string:
        "  socialProviders: {\n    google: {\n      clientId: process.env.AUTH_GOOGLE_ID ?? '',\n      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? '',\n    },\n    github: {\n      clientId: process.env.AUTH_GITHUB_ID ?? '',\n      clientSecret: process.env.AUTH_GITHUB_SECRET ?? '',\n    },\n  },",
    });

    emitClaudeMirroredFileEditToolResult({
      session,
      now: () => "2026-06-25T20:01:00.000Z",
      emit: (event) => events.push(event),
      entry: {
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        timestamp: "2026-06-25T20:00:01.000Z",
        parent_tool_use_id: "tool-edit-1",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-edit-1",
              content: "The file /repo/apps/api/src/lib/auth.ts has been updated successfully.",
            },
          ],
        },
        tool_use_result: {
          filePath: "/repo/apps/api/src/lib/auth.ts",
          structuredPatch: [
            {
              oldStart: 50,
              oldLines: 6,
              newStart: 50,
              newLines: 10,
              lines: [
                "       clientId: process.env.AUTH_GOOGLE_ID ?? '',",
                "       clientSecret: process.env.AUTH_GOOGLE_SECRET ?? '',",
                "     },",
                "+    github: {",
                "+      clientId: process.env.AUTH_GITHUB_ID ?? '',",
                "+      clientSecret: process.env.AUTH_GITHUB_SECRET ?? '',",
                "+    },",
                "   },",
              ],
            },
          ],
        },
      },
    });

    const fileDiff =
      events[0]?.type === "assistant_part" && events[0].part.kind === "tool"
        ? events[0].part.fileDiffs?.[0]
        : undefined;

    expect(events).toHaveLength(1);
    expect(fileDiff?.diff).toContain("@@ -50,6 +50,10 @@");
    expect(fileDiff?.diff).toContain("+    github: {");
    expect(fileDiff?.diff).not.toContain("-  socialProviders: {");
  });

  test("does not synthesize live file edit diffs without SDK structured tool result data", () => {
    const events: AgentEvent[] = [];
    const session = createClaudeSession();
    session.toolNamesByCallId.set("tool-edit-1", "Edit");
    session.toolMessageIdsByCallId.set("tool-edit-1", "assistant-1");
    session.toolInputsByCallId.set("tool-edit-1", {
      file_path: "/repo/apps/api/src/lib/auth.ts",
      old_string: "google",
      new_string: "github",
    });

    emitClaudeMirroredFileEditToolResult({
      session,
      now: () => "2026-06-25T20:01:00.000Z",
      emit: (event) => events.push(event),
      entry: {
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        timestamp: "2026-06-25T20:00:01.000Z",
        parent_tool_use_id: "tool-edit-1",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-edit-1",
              content: "The file /repo/apps/api/src/lib/auth.ts has been updated successfully.",
            },
          ],
        },
      },
    });

    expect(events).toEqual([]);
  });
});

describe("Claude session I/O model changes", () => {
  test("applies per-message model changes through the Claude SDK query", async () => {
    const setModel = mock(async (_model?: string) => {});
    const pushed: SDKUserMessage[] = [];
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.push = (message) => {
      pushed.push(message);
    };
    const session = createClaudeSession({
      activity: "idle",
      query: { setModel } as unknown as ClaudeSession["query"],
      queue,
    });

    await sendClaudeUserMessage({
      session,
      now: () => "2026-06-25T20:00:00.000Z",
      randomId: () => "message-1",
      emit: () => {},
      messageInput: {
        externalSessionId: "session-1",
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo",
        runtimePolicy: { kind: "claude" },
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        model: {
          providerId: "claude",
          modelId: "claude-opus-4-6",
          runtimeKind: "claude",
        },
        parts: [{ kind: "text", text: "hello" }],
      },
    });

    expect(setModel).toHaveBeenCalledWith("claude-opus-4-6");
    expect(session.model?.modelId).toBe("claude-opus-4-6");
    expect(pushed).toHaveLength(1);
    expect(session.activeSdkUserTurnCount).toBe(1);
    expect(session.acceptedUserMessages).toEqual([
      {
        messageId: "message-1",
        model: {
          providerId: "claude",
          modelId: "claude-opus-4-6",
          runtimeKind: "claude",
        },
        parts: [{ kind: "text", text: "hello" }],
        text: "hello",
        timestamp: "2026-06-25T20:00:00.000Z",
      },
    ]);
  });

  test("applies supported per-message effort changes through Claude flag settings", async () => {
    const setModel = mock(async (_model?: string) => {});
    const applyFlagSettings = mock(async (_settings: unknown) => {});
    const pushed: SDKUserMessage[] = [];
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.push = (message) => {
      pushed.push(message);
    };
    const session = createClaudeSession({
      activity: "idle",
      model: {
        providerId: "claude",
        modelId: "claude-opus-4-6",
        runtimeKind: "claude",
        variant: "high",
      },
      query: {
        applyFlagSettings,
        setModel,
      } as unknown as ClaudeSession["query"],
      queue,
    });

    await sendClaudeUserMessage({
      session,
      now: () => "2026-06-25T20:00:00.000Z",
      randomId: () => "message-1",
      emit: () => {},
      messageInput: {
        externalSessionId: "session-1",
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo",
        runtimePolicy: { kind: "claude" },
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        model: {
          providerId: "claude",
          modelId: "claude-opus-4-6",
          runtimeKind: "claude",
          variant: "xhigh",
        },
        parts: [{ kind: "text", text: "hello" }],
      },
    });

    expect(setModel).not.toHaveBeenCalled();
    expect(applyFlagSettings).toHaveBeenCalledWith({ effortLevel: "xhigh" });
    expect(session.model?.variant).toBe("xhigh");
    expect(pushed).toHaveLength(1);
  });
});

describe("Claude session I/O queued messages", () => {
  test("accepts queued user messages while the Claude SDK session is running", async () => {
    const pushed: SDKUserMessage[] = [];
    const events: AgentEvent[] = [];
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.push = (message) => {
      pushed.push(message);
    };
    const session = createClaudeSession({
      activeSdkUserTurnCount: 1,
      activity: "running",
      sdkState: "running",
      query: {
        applyFlagSettings: mock(async (_settings: unknown) => {}),
        setModel: mock(async (_model?: string) => {}),
      } as unknown as ClaudeSession["query"],
      queue,
    });

    const accepted = await sendClaudeUserMessage({
      session,
      now: () => "2026-06-25T20:00:00.000Z",
      randomId: () => "message-1",
      emit: (_session, event) => events.push(event),
      messageInput: {
        externalSessionId: "session-1",
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo",
        runtimePolicy: { kind: "claude" },
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        parts: [{ kind: "text", text: "continue while running" }],
      },
    });

    expect(accepted.message).toBe("continue while running");
    expect(accepted.state).toBe("queued");
    expect(session.activity).toBe("running");
    expect(session.pendingUserTurnCount).toBe(1);
    expect(session.queuedSdkMessages).toEqual([
      expect.objectContaining({
        type: "user",
        uuid: "message-1",
        session_id: "session-1",
      }),
    ]);
    expect(pushed).toEqual([]);
    expect(events).toEqual([
      expect.objectContaining({
        type: "session_status",
        status: { type: "busy", message: null },
      }),
    ]);
  });

  test("marks the local user turn pending before sending it to the SDK queue", async () => {
    const events: AgentEvent[] = [];
    const queue = new AsyncInputQueue<SDKUserMessage>();
    const messageId = "00000000-0000-4000-8000-000000000001";
    const session = createClaudeSession({
      activity: "idle",
      model: {
        providerId: "claude",
        modelId: "claude-sonnet-4-6",
        runtimeKind: "claude",
        variant: "high",
      },
      query: {
        applyFlagSettings: mock(async (_settings: unknown) => {}),
        setModel: mock(async (_model?: string) => {}),
      } as unknown as ClaudeSession["query"],
      queue,
    });
    queue.push = (message) => {
      expect(message.uuid).toBe(messageId);
      expect(session.acceptedUserMessages).toEqual([
        {
          messageId,
          parts: [{ kind: "text", text: "start work" }],
          text: "start work",
          timestamp: "2026-06-25T20:00:00.000Z",
        },
      ]);
      expect(session.pendingUserTurnCount).toBe(1);
      expect(session.activity).toBe("running");
      expect(session.sdkState).toBe("running");
    };

    await expect(
      sendClaudeUserMessage({
        session,
        now: () => "2026-06-25T20:00:00.000Z",
        randomId: () => messageId,
        emit: (_session, event) => events.push(event),
        messageInput: {
          externalSessionId: "session-1",
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo",
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          parts: [{ kind: "text", text: "start work" }],
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        messageId,
        message: "start work",
      }),
    );
    expect(events).toEqual([
      expect.objectContaining({
        type: "session_status",
        status: { type: "busy", message: null },
      }),
    ]);
  });

  test("flushes the next queued user message after the active SDK turn completes", async () => {
    const events: AgentEvent[] = [];
    const pushed: SDKUserMessage[] = [];
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.push = (message) => {
      pushed.push(message);
    };
    const session = createClaudeSession({
      acceptedUserMessages: [
        {
          messageId: "00000000-0000-4000-8000-000000000002",
          parts: [{ kind: "text", text: "queued" }],
          text: "queued",
          timestamp: "2026-06-25T20:00:01.000Z",
        },
      ],
      activeSdkUserTurnCount: 0,
      activity: "running",
      pendingUserTurnCount: 1,
      queue,
      queuedSdkMessages: [
        {
          type: "user",
          uuid: "00000000-0000-4000-8000-000000000002",
          session_id: "session-1",
          timestamp: "2026-06-25T20:00:01.000Z",
          parent_tool_use_id: null,
          message: {
            role: "user",
            content: [{ type: "text", text: "queued" }],
          },
        },
      ],
      sdkState: "idle",
    });

    await flushQueuedClaudeUserMessage({
      emit: (_session, event) => events.push(event),
      now: () => "2026-06-25T20:00:02.000Z",
      session,
    });

    expect(pushed).toEqual([
      expect.objectContaining({
        type: "user",
        uuid: "00000000-0000-4000-8000-000000000002",
        session_id: "session-1",
      }),
    ]);
    expect(session.activeSdkUserTurnCount).toBe(1);
    expect(session.queuedSdkMessages).toEqual([]);
    expect(session.activity).toBe("running");
    expect(events).toEqual([
      expect.objectContaining({
        type: "user_message",
        externalSessionId: "session-1",
        messageId: "00000000-0000-4000-8000-000000000002",
        state: "read",
      }),
      expect.objectContaining({
        type: "session_status",
        externalSessionId: "session-1",
        status: { type: "busy", message: null },
      }),
    ]);
  });

  test("defers queued message model updates until that queued message is flushed", async () => {
    const events: AgentEvent[] = [];
    const pushed: SDKUserMessage[] = [];
    const setModel = mock(async (_model?: string) => {});
    const applyFlagSettings = mock(async (_settings: unknown) => {});
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.push = (message) => {
      pushed.push(message);
    };
    const session = createClaudeSession({
      activeSdkUserTurnCount: 1,
      activity: "running",
      model: {
        providerId: "claude",
        modelId: "claude-sonnet-4-6",
        runtimeKind: "claude",
        variant: "high",
      },
      query: {
        applyFlagSettings,
        setModel,
      } as unknown as ClaudeSession["query"],
      queue,
      sdkState: "running",
    });

    const accepted = await sendClaudeUserMessage({
      session,
      now: () => "2026-06-25T20:00:00.000Z",
      randomId: () => "00000000-0000-4000-8000-000000000003",
      emit: (_session, event) => events.push(event),
      messageInput: {
        externalSessionId: "session-1",
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo",
        runtimePolicy: { kind: "claude" },
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        model: {
          providerId: "claude",
          modelId: "claude-opus-4-6",
          runtimeKind: "claude",
          variant: "xhigh",
        },
        parts: [{ kind: "text", text: "use opus next" }],
      },
    });

    expect(accepted.state).toBe("queued");
    expect(setModel).not.toHaveBeenCalled();
    expect(applyFlagSettings).not.toHaveBeenCalled();
    expect(session.model?.modelId).toBe("claude-sonnet-4-6");
    expect(session.model?.variant).toBe("high");
    expect(pushed).toEqual([]);

    session.activeSdkUserTurnCount = 0;
    session.sdkState = "idle";
    await flushQueuedClaudeUserMessage({
      emit: (_session, event) => events.push(event),
      now: () => "2026-06-25T20:00:01.000Z",
      session,
    });

    expect(setModel).toHaveBeenCalledWith("claude-opus-4-6");
    expect(applyFlagSettings).toHaveBeenCalledWith({ effortLevel: "xhigh" });
    expect(session.model?.modelId).toBe("claude-opus-4-6");
    expect(session.model?.variant).toBe("xhigh");
    expect(pushed).toEqual([
      expect.objectContaining({
        uuid: "00000000-0000-4000-8000-000000000003",
      }),
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "user_message",
        messageId: "00000000-0000-4000-8000-000000000003",
        state: "read",
      }),
    );
  });

  test("restores model and session state when queued message flushing fails after model update", async () => {
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.push = () => {
      throw new Error("queue unavailable");
    };
    const queuedMessage: SDKUserMessage = {
      type: "user",
      uuid: "00000000-0000-4000-8000-000000000003",
      session_id: "session-1",
      timestamp: "2026-06-25T20:00:00.000Z",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [{ type: "text", text: "use opus next" }],
      },
    };
    const session = createClaudeSession({
      acceptedUserMessages: [
        {
          messageId: "00000000-0000-4000-8000-000000000003",
          model: {
            providerId: "claude",
            modelId: "claude-opus-4-6",
            runtimeKind: "claude",
            variant: "xhigh",
          },
          parts: [{ kind: "text", text: "use opus next" }],
          text: "use opus next",
          timestamp: "2026-06-25T20:00:00.000Z",
        },
      ],
      activity: "running",
      model: {
        providerId: "claude",
        modelId: "claude-sonnet-4-6",
        runtimeKind: "claude",
        variant: "high",
      },
      query: {
        applyFlagSettings: mock(async (_settings: unknown) => {}),
        setModel: mock(async (_model?: string) => {}),
      } as unknown as ClaudeSession["query"],
      queue,
      queuedSdkMessages: [queuedMessage],
      sdkState: "idle",
    });

    await expect(
      flushQueuedClaudeUserMessage({
        emit: () => {},
        now: () => "2026-06-25T20:00:01.000Z",
        session,
      }),
    ).rejects.toThrow("queue unavailable");

    expect(session.queuedSdkMessages).toEqual([queuedMessage]);
    expect(session.activeSdkUserTurnCount).toBe(0);
    expect(session.activity).toBe("running");
    expect(session.sdkState).toBe("idle");
    expect(session.model).toEqual({
      providerId: "claude",
      modelId: "claude-sonnet-4-6",
      runtimeKind: "claude",
      variant: "high",
    });
  });

  test("does not let new sends overtake already queued SDK messages", async () => {
    const pushed: SDKUserMessage[] = [];
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.push = (message) => {
      pushed.push(message);
    };
    const session = createClaudeSession({
      activity: "running",
      pendingUserTurnCount: 1,
      queue,
      queuedSdkMessages: [
        {
          type: "user",
          uuid: "00000000-0000-4000-8000-000000000002",
          session_id: "session-1",
          timestamp: "2026-06-25T20:00:01.000Z",
          parent_tool_use_id: null,
          message: {
            role: "user",
            content: [{ type: "text", text: "first queued" }],
          },
        },
      ],
      sdkState: "idle",
    });

    await sendClaudeUserMessage({
      session,
      now: () => "2026-06-25T20:00:02.000Z",
      randomId: () => "00000000-0000-4000-8000-000000000003",
      emit: () => {},
      messageInput: {
        externalSessionId: "session-1",
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo",
        runtimePolicy: { kind: "claude" },
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        parts: [{ kind: "text", text: "second queued" }],
      },
    });

    expect(pushed).toEqual([]);
    expect(session.queuedSdkMessages.map((message) => message.uuid)).toEqual([
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
    ]);
  });

  test("does not mark user messages accepted when the Claude input queue is closed", async () => {
    const events: AgentEvent[] = [];
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.close();
    const session = createClaudeSession({
      activity: "idle",
      model: {
        providerId: "claude",
        modelId: "claude-sonnet-4-6",
        runtimeKind: "claude",
        variant: "high",
      },
      query: {
        applyFlagSettings: mock(async (_settings: unknown) => {}),
        setModel: mock(async (_model?: string) => {}),
      } as unknown as ClaudeSession["query"],
      queue,
    });

    await expect(
      sendClaudeUserMessage({
        session,
        now: () => "2026-06-25T20:00:00.000Z",
        randomId: () => "message-1",
        emit: (_session, event) => events.push(event),
        messageInput: {
          externalSessionId: "session-1",
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo",
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          model: {
            providerId: "claude",
            modelId: "claude-opus-4-6",
            runtimeKind: "claude",
            variant: "xhigh",
          },
          parts: [{ kind: "text", text: "should not be accepted" }],
        },
      }),
    ).rejects.toThrow("Cannot send input to a closed Claude Agent SDK session.");

    expect(session.acceptedUserMessages).toEqual([]);
    expect(session.pendingUserTurnCount).toBe(0);
    expect(session.activity).toBe("idle");
    expect(session.model).toEqual({
      providerId: "claude",
      modelId: "claude-sonnet-4-6",
      runtimeKind: "claude",
      variant: "high",
    });
    expect(events).toEqual([]);
  });
});

describe("Claude session I/O attachments and invalid updates", () => {
  test("queues structured Claude SDK messages with staged image attachments", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "openducktor-claude-send-"));
    try {
      const imagePath = join(workspace, "screenshot.png");
      await writeFile(imagePath, Buffer.from("png-bytes"));
      const pushed: SDKUserMessage[] = [];
      const queue = new AsyncInputQueue<SDKUserMessage>();
      queue.push = (message) => {
        pushed.push(message);
      };
      const session = createClaudeSession({
        activity: "idle",
        query: {
          applyFlagSettings: mock(async (_settings: unknown) => {}),
          setModel: mock(async (_model?: string) => {}),
        } as unknown as ClaudeSession["query"],
        queue,
      });

      const messageId = "00000000-0000-4000-8000-000000000001";
      const accepted = await sendClaudeUserMessage({
        session,
        now: () => "2026-06-25T20:00:00.000Z",
        randomId: () => messageId,
        emit: () => {},
        messageInput: {
          externalSessionId: "session-1",
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo",
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          parts: [
            { kind: "text", text: "Inspect this" },
            {
              kind: "attachment",
              attachment: {
                id: "attachment-1",
                kind: "image",
                mime: "image/png",
                name: "screenshot.png",
                path: imagePath,
              },
            },
          ],
        },
      });

      expect(accepted).toMatchObject({
        messageId,
        message: "Inspect this",
        parts: [
          { kind: "text", text: "Inspect this" },
          {
            kind: "attachment",
            attachment: {
              id: "attachment-1",
              kind: "image",
              name: "screenshot.png",
              path: imagePath,
            },
          },
        ],
      });
      expect(pushed).toEqual([
        {
          type: "user",
          uuid: messageId,
          session_id: "session-1",
          timestamp: "2026-06-25T20:00:00.000Z",
          parent_tool_use_id: null,
          message: {
            role: "user",
            content: [
              { type: "text", text: "Inspect this" },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: Buffer.from("png-bytes").toString("base64"),
                },
              },
            ],
          },
        },
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  test("rejects unsupported live Claude effort changes without mutating session model", async () => {
    const applyFlagSettings = mock(async (_settings: unknown) => {});
    const session = createClaudeSession({
      model: {
        providerId: "claude",
        modelId: "claude-opus-4-6",
        runtimeKind: "claude",
        variant: "high",
      },
      query: {
        applyFlagSettings,
        setModel: mock(async (_model?: string) => {}),
      } as unknown as ClaudeSession["query"],
    });

    await expect(
      applyClaudeSessionModel(session, {
        providerId: "claude",
        modelId: "claude-opus-4-6",
        runtimeKind: "claude",
        variant: "max",
      }),
    ).rejects.toThrow("Claude Agent SDK live effort updates do not support 'max'.");

    expect(applyFlagSettings).not.toHaveBeenCalled();
    expect(session.model?.variant).toBe("high");
  });

  test("rolls back the SDK model when a combined model and effort update fails", async () => {
    const setModel = mock(async (_model?: string) => {});
    const applyFlagSettings = mock(async (settings: { effortLevel: string | null }) => {
      if (settings.effortLevel === "xhigh") {
        throw new Error("effort update failed");
      }
    });
    const session = createClaudeSession({
      model: {
        providerId: "claude",
        modelId: "claude-sonnet-4-6",
        runtimeKind: "claude",
        variant: "high",
      },
      query: {
        applyFlagSettings,
        setModel,
      } as unknown as ClaudeSession["query"],
    });

    await expect(
      applyClaudeSessionModel(session, {
        providerId: "claude",
        modelId: "claude-opus-4-6",
        runtimeKind: "claude",
        variant: "xhigh",
      }),
    ).rejects.toThrow("effort update failed");

    expect(setModel.mock.calls).toEqual([["claude-opus-4-6"], ["claude-sonnet-4-6"]]);
    expect(applyFlagSettings.mock.calls).toEqual([
      [{ effortLevel: "xhigh" }],
      [{ effortLevel: "high" }],
    ]);
    expect(session.model).toMatchObject({
      modelId: "claude-sonnet-4-6",
      variant: "high",
    });
  });
});
