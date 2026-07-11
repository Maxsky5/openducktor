import { describe, expect, mock, test } from "bun:test";
import {
  bufferedNotificationEvent,
  codexSessionRuntimeRef,
  codexStartSessionInput,
  codexUserMessageInput,
  createDeferred,
  createHarness,
  createRuntimeStreamSubscription,
  flushCodexAdapterWork,
} from "./codex-app-server-adapter.test-harness";
import type { CodexAppServerAdapter, CodexJsonRpcRequest, CodexJsonRpcTransport } from "./index";

const bufferedNotifications = (messages: unknown[]) =>
  messages.map((message) => bufferedNotificationEvent(message));

const observeSessionState = async (
  adapter: CodexAppServerAdapter,
  externalSessionId: string,
): Promise<() => void> => {
  const unsubscribe = await adapter.subscribeEvents(
    codexSessionRuntimeRef(externalSessionId),
    () => {},
  );
  await flushCodexAdapterWork();
  return unsubscribe;
};

describe("CodexAppServerAdapter streaming", () => {
  test("emits transcript events from Codex notifications", async () => {
    const takeBufferedEvents = mock(async (_runtimeId: string) => []);
    const { adapter, transports } = createHarness({ takeBufferedEvents }, { deferTurnStart: true });

    await adapter.startSession(codexStartSessionInput());

    const events: unknown[] = [];
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-live"), (event) =>
      events.push(event),
    );
    takeBufferedEvents.mockImplementationOnce(async () => {
      transports.get("runtime-live")?.turnStartDeferred.resolve({ turn: { id: "turn-1" } });
      return bufferedNotifications([
        {
          method: "turn/started",
          params: { threadId: "thread/start-runtime-live", turn: { id: "turn-1" } },
        },
        {
          method: "item/completed",
          params: {
            threadId: "thread/start-runtime-live",
            turnId: "turn-1",
            completedAtMs: 1_777_766_400_500,
            item: {
              type: "userMessage",
              id: "user-1",
              content: [{ type: "text", text: "Hello Codex" }],
            },
          },
        },
        {
          method: "item/agentMessage/delta",
          params: {
            threadId: "thread/start-runtime-live",
            turnId: "turn-1",
            itemId: "agent-1",
            occurred_at_ms: 1_777_766_401_500,
            delta: "Hi",
          },
        },
        {
          method: "thread/status/changed",
          params: {
            threadId: "thread/start-runtime-live",
            status: "thinking",
          },
        },
        {
          method: "item/started",
          params: {
            threadId: "thread/start-runtime-live",
            turnId: "turn-1",
            startedAtMs: 1_777_766_401_000,
            item: {
              type: "commandExecution",
              id: "cmd-1",
              command: "bun test",
              cwd: "/repo",
              status: "inProgress",
              commandActions: [],
            },
          },
        },
        {
          method: "thread/tokenUsage/updated",
          params: {
            threadId: "thread/start-runtime-live",
            turnId: "turn-1",
            tokenUsage: {
              total: { totalTokens: 42_000 },
              last: { totalTokens: 1_000 },
              modelContextWindow: 200_000,
            },
          },
        },
        {
          method: "item/started",
          params: {
            threadId: "thread/start-runtime-live",
            turnId: "turn-1",
            startedAtMs: 1_777_766_401_750,
            item: {
              type: "contextCompaction",
              id: "compact-live",
            },
          },
        },
        {
          method: "item/completed",
          params: {
            threadId: "thread/start-runtime-live",
            turnId: "turn-1",
            completedAtMs: 1_777_766_401_800,
            item: {
              type: "contextCompaction",
              id: "compact-live",
            },
          },
        },
        {
          method: "turn/plan/updated",
          params: {
            threadId: "thread/start-runtime-live",
            turnId: "turn-1",
            explanation: "Working through the implementation.",
            plan: [
              { step: "Inspect Codex todo events", status: "completed" },
              { step: "Wire session todos", status: "in_progress" },
              { step: "Verify behavior", status: "pending" },
            ],
          },
        },
        {
          method: "item/completed",
          params: {
            threadId: "thread/start-runtime-live",
            turnId: "turn-1",
            completedAtMs: 1_777_766_402_000,
            item: {
              type: "mcpToolCall",
              id: "mcp-1",
              server: "openducktor",
              tool: "odt_read_task",
              status: "completed",
              arguments: { taskId: "task-1" },
              result: { content: [{ type: "text", text: "task ok" }] },
            },
          },
        },
        {
          method: "item/completed",
          params: {
            threadId: "thread/start-runtime-live",
            turnId: "turn-1",
            completedAtMs: 1_777_766_402_500,
            item: {
              type: "commandExecution",
              id: "cmd-1",
              command: "bun test",
              cwd: "/repo",
              status: "failed",
              commandActions: [],
              aggregatedOutput: "test failed",
              error: "exit code 1",
            },
          },
        },
        {
          method: "item/completed",
          params: {
            threadId: "thread/start-runtime-live",
            turnId: "turn-1",
            completedAtMs: 1_777_766_403_000,
            item: { type: "agentMessage", id: "agent-1", text: "Hi there" },
          },
        },
        {
          method: "turn/completed",
          params: {
            threadId: "thread/start-runtime-live",
            turn: {
              id: "turn-1",
              status: "completed",
              startedAt: 1_777_766_401.8,
              completedAt: 1_777_766_403,
              durationMs: 1_200,
            },
          },
        },
      ]);
    });

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Hello Codex" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "user_message",
        messageId: "user-1",
        message: "Hello Codex",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "assistant_delta",
        channel: "text",
        messageId: "agent-1",
        delta: "Hi",
        timestamp: new Date(1_777_766_401_500).toISOString(),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_status",
        timestamp: "2026-05-03T00:00:01.800Z",
        status: { type: "busy", message: null },
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "assistant_message",
        messageId: "agent-1",
        message: "Hi there",
        totalTokens: 1_000,
        contextWindow: 200_000,
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_compaction_started",
        externalSessionId: "thread/start-runtime-live",
        timestamp: expect.any(String),
        messageId: "compact-live",
        message: "Session compaction started.",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_compacted",
        externalSessionId: "thread/start-runtime-live",
        timestamp: expect.any(String),
        messageId: "compact-live",
        message: "Session compacted.",
      }),
    );
    expect(
      events.filter((event) => (event as { type?: string }).type === "session_compacted"),
    ).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "tool",
          partId: "cmd-1",
          tool: "bash",
          status: "running",
          input: { command: "bun test", cwd: "/repo" },
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_todos_updated",
        todos: [
          expect.objectContaining({
            id: "codex-todo:0",
            content: "Inspect Codex todo events",
            status: "completed",
          }),
          expect.objectContaining({
            id: "codex-todo:1",
            content: "Wire session todos",
            status: "in_progress",
          }),
          expect.objectContaining({
            id: "codex-todo:2",
            content: "Verify behavior",
            status: "pending",
          }),
        ],
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "tool",
          messageId: "turn-1",
          partId: "turn-1-update-plan-1",
          callId: "turn-1-update-plan-1",
          tool: "update_plan",
          toolType: "todo",
          title: "update_plan",
          displayLabel: "todo",
          status: "completed",
          input: {
            explanation: "Working through the implementation.",
            todos: [
              { step: "Inspect Codex todo events", status: "completed" },
              { step: "Wire session todos", status: "in_progress" },
              { step: "Verify behavior", status: "pending" },
            ],
          },
          output: "Plan updated",
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "step",
          messageId: "turn-1",
          totalTokens: 1_000,
          contextWindow: 200_000,
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "tool",
          partId: "mcp-1",
          tool: "odt_read_task",
          toolType: "workflow",
          title: "read_task",
          status: "completed",
          input: { taskId: "task-1" },
          output: expect.stringContaining("task ok"),
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "tool",
          partId: "cmd-1",
          tool: "bash",
          toolType: "bash",
          status: "error",
          startedAtMs: 1_777_766_401_000,
          endedAtMs: 1_777_766_402_500,
          error: "exit code 1",
        }),
      }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: "session_idle" }));
    expect(events).not.toContainEqual(expect.objectContaining({ message: "thinking" }));
    expect(
      events.filter((event) => (event as { type?: string }).type === "user_message"),
    ).toHaveLength(1);
  });

  test("streams native Codex tool calls with hydration-compatible names", async () => {
    const patch =
      "*** Begin Patch\n*** Update File: /repo/src/app.ts\n@@\n-old\n+new\n*** End Patch\n";
    const takeBufferedEvents = mock(async (_runtimeId: string) => []);
    const { adapter, transports } = createHarness({ takeBufferedEvents }, { deferTurnStart: true });

    await adapter.startSession(codexStartSessionInput());

    const events: unknown[] = [];
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-live"), (event) =>
      events.push(event),
    );
    takeBufferedEvents.mockImplementationOnce(async () => {
      transports.get("runtime-live")?.turnStartDeferred.resolve({ turn: { id: "turn-tools" } });
      return bufferedNotifications([
        {
          method: "turn/started",
          params: { threadId: "thread/start-runtime-live", turn: { id: "turn-tools" } },
        },
        {
          method: "item/completed",
          params: {
            threadId: "thread/start-runtime-live",
            turnId: "turn-tools",
            completedAtMs: 1_777_766_410_000,
            item: {
              type: "dynamicToolCall",
              id: "call-search",
              namespace: "functions",
              tool: "exec_command",
              status: "completed",
              arguments: { cmd: "rg foo src", workdir: "/repo" },
              contentItems: [{ type: "outputText", text: "src/app.ts:foo" }],
            },
          },
        },
        {
          method: "item/completed",
          params: {
            threadId: "thread/start-runtime-live",
            turnId: "turn-tools",
            completedAtMs: 1_777_766_411_000,
            item: {
              type: "dynamicToolCall",
              id: "call-patch",
              namespace: "functions",
              tool: "apply_patch",
              status: "completed",
              input: patch,
              contentItems: [{ type: "outputText", text: "ok" }],
            },
          },
        },
        {
          method: "item/completed",
          params: {
            threadId: "thread/start-runtime-live",
            turnId: "turn-tools",
            completedAtMs: 1_777_766_412_000,
            item: {
              type: "webSearch",
              id: "call-web",
              query: "Codex App Server",
              output: "web result",
            },
          },
        },
        {
          method: "item/completed",
          params: {
            threadId: "thread/start-runtime-live",
            turnId: "turn-tools",
            completedAtMs: 1_777_766_413_000,
            item: {
              type: "dynamicToolCall",
              id: "call-image",
              namespace: "image_gen",
              tool: "imagegen",
              status: "completed",
              arguments: { prompt: "duck" },
              contentItems: [{ type: "outputText", text: "image result" }],
            },
          },
        },
        {
          method: "item/completed",
          params: {
            threadId: "thread/start-runtime-live",
            turnId: "turn-tools",
            completedAtMs: 1_777_766_414_000,
            item: {
              type: "dynamicToolCall",
              id: "call-parallel",
              namespace: "multi_tool_use",
              tool: "parallel",
              status: "completed",
              arguments: { tool_uses: [] },
              contentItems: [{ type: "outputText", text: "[]" }],
            },
          },
        },
        {
          method: "turn/completed",
          params: {
            threadId: "thread/start-runtime-live",
            turn: { id: "turn-tools", completedAt: 1_777_766_415 },
          },
        },
      ]);
    });

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Use tools" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    const toolParts = events
      .filter(
        (event): event is { type: "assistant_part"; part: { kind: string; tool?: string } } =>
          (event as { type?: string }).type === "assistant_part",
      )
      .map((event) => event.part)
      .filter((part) => part.kind === "tool");

    expect(toolParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "exec_command",
          toolType: "search",
          input: expect.objectContaining({ command: "rg foo src", query: "foo", path: "src" }),
        }),
        expect.objectContaining({
          tool: "apply_patch",
          toolType: "file_edit",
          input: { patch },
          output: "--- a/repo/src/app.ts\n+++ b/repo/src/app.ts\n@@\n-old\n+new",
        }),
        expect.objectContaining({
          tool: "webSearch",
          toolType: "web",
          input: { query: "Codex App Server" },
          output: "web result",
          preview: "Codex App Server",
        }),
        expect.objectContaining({ tool: "image_gen.imagegen", input: { prompt: "duck" } }),
        expect.objectContaining({ tool: "multi_tool_use.parallel", input: { tool_uses: [] } }),
      ]),
    );
  });

  test("preserves turn model when item notifications reveal the turn id before turn started", async () => {
    const takeBufferedEvents = mock(async (_runtimeId: string) => []);
    const { adapter, transports } = createHarness({ takeBufferedEvents }, { deferTurnStart: true });

    await adapter.startSession(codexStartSessionInput());
    adapter.updateSessionModel({
      ...codexSessionRuntimeRef("thread/start-runtime-live"),
      externalSessionId: "thread/start-runtime-live",
      model: { providerId: "openai", modelId: "gpt-5", variant: "high" },
    });

    const events: unknown[] = [];
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-live"), (event) =>
      events.push(event),
    );
    takeBufferedEvents.mockImplementationOnce(async () => {
      setTimeout(() => {
        transports.get("runtime-live")?.turnStartDeferred.resolve({
          turn: { id: "turn-notification-first", status: "completed" },
        });
      }, 0);
      return bufferedNotifications([
        {
          method: "item/completed",
          params: {
            threadId: "thread/start-runtime-live",
            turnId: "turn-notification-first",
            completedAtMs: 1_777_766_420_000,
            item: {
              type: "agentMessage",
              id: "agent-notification-first",
              phase: "final_answer",
              text: "Done with low reasoning.",
            },
          },
        },
        {
          method: "turn/started",
          params: {
            threadId: "thread/start-runtime-live",
            turn: { id: "turn-notification-first" },
          },
        },
        {
          method: "turn/completed",
          params: {
            threadId: "thread/start-runtime-live",
            turn: {
              id: "turn-notification-first",
              status: "completed",
              completedAt: 1_777_766_421,
              durationMs: 1_000,
            },
          },
        },
      ]);
    });

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Use shallow reasoning" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    const assistantMessage = events.find(
      (event) =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "assistant_message",
    );
    expect(assistantMessage).toMatchObject({
      type: "assistant_message",
      message: "Done with low reasoning.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
  });

  test.each([
    ["missing", undefined, "is missing durationMs."],
    ["fractional", 1.5, "has invalid durationMs."],
    ["out-of-range", Number.MAX_SAFE_INTEGER, "has invalid durationMs."],
  ])("rejects %s final live Codex turn duration", async (_case, durationMs, expectedError) => {
    const takeBufferedEvents = mock(async (_runtimeId: string) => []);
    const { adapter, transports } = createHarness({ takeBufferedEvents }, { deferTurnStart: true });

    await adapter.startSession(codexStartSessionInput());
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-live"), () => {});
    takeBufferedEvents.mockImplementationOnce(async () => {
      transports.get("runtime-live")?.turnStartDeferred.resolve({ turn: { id: "turn-1" } });
      return bufferedNotifications([
        {
          method: "item/completed",
          params: {
            threadId: "thread/start-runtime-live",
            turnId: "turn-1",
            completedAtMs: 1_777_766_403_000,
            item: { type: "agentMessage", id: "agent-1", text: "Hi there" },
          },
        },
        {
          method: "turn/completed",
          params: {
            threadId: "thread/start-runtime-live",
            turn: {
              id: "turn-1",
              status: "completed",
              completedAt: 1_777_766_403,
              ...(durationMs === undefined ? {} : { durationMs }),
            },
          },
        },
      ]);
    });

    await expect(
      adapter.sendUserMessage(
        codexUserMessageInput({
          externalSessionId: "thread/start-runtime-live",
          parts: [{ kind: "text", text: "Hello Codex" }],
          model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
        }),
      ),
    ).rejects.toThrow(`Completed Codex turn with a final assistant message ${expectedError}`);
  });

  test("uses active turn model for completed user messages without turn id", async () => {
    const takeBufferedEvents = mock(async (_runtimeId: string) => []);
    const { adapter, transports } = createHarness({ takeBufferedEvents }, { deferTurnStart: true });

    await adapter.startSession(codexStartSessionInput());

    const events: unknown[] = [];
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-live"), (event) =>
      events.push(event),
    );
    takeBufferedEvents.mockImplementationOnce(async () => {
      adapter.updateSessionModel({
        ...codexSessionRuntimeRef("thread/start-runtime-live"),
        externalSessionId: "thread/start-runtime-live",
        model: { providerId: "openai", modelId: "gpt-5", variant: "high" },
      });
      setTimeout(() => {
        transports.get("runtime-live")?.turnStartDeferred.resolve({
          turn: { id: "turn-without-item-id", status: "completed" },
        });
      }, 0);
      return bufferedNotifications([
        {
          method: "item/completed",
          params: {
            threadId: "thread/start-runtime-live",
            completedAtMs: 1_777_766_430_000,
            item: {
              type: "userMessage",
              id: "user-without-turn-id",
              content: [{ type: "text", text: "Use the original turn model" }],
            },
          },
        },
      ]);
    });

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Use the original turn model" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    const userMessage = events.find(
      (event) =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "user_message",
    );
    expect(userMessage).toMatchObject({
      type: "user_message",
      message: "Use the original turn model",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
  });

  test("ignores notifications for other Codex threads", async () => {
    const takeBufferedEvents = mock(async (_runtimeId: string) =>
      bufferedNotifications([
        {
          method: "item/completed",
          params: {
            threadId: "other-thread",
            turnId: "turn-foreign",
            item: { type: "agentMessage", id: "agent-foreign", text: "Wrong session" },
          },
        },
      ]),
    );
    const { adapter, transports } = createHarness({ takeBufferedEvents }, { deferTurnStart: true });

    await adapter.startSession(codexStartSessionInput());
    const events: unknown[] = [];
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-live"), (event) =>
      events.push(event),
    );
    transports.get("runtime-live")?.turnStartDeferred.resolve({
      turn: { id: "turn-1", status: "completed" },
    });

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Hello Codex" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    expect(events).not.toContainEqual(
      expect.objectContaining({ messageId: "agent-foreign", message: "Wrong session" }),
    );
  });

  test("rejects subagent reference sends before emitting an accepted user message", async () => {
    const { adapter, transports } = createHarness();

    await adapter.startSession(codexStartSessionInput());
    const events: unknown[] = [];
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-live"), (event) =>
      events.push(event),
    );

    await expect(
      adapter.sendUserMessage(
        codexUserMessageInput({
          externalSessionId: "thread/start-runtime-live",
          parts: [
            {
              kind: "subagent_reference",
              subagent: {
                id: "reviewer",
                name: "reviewer",
                label: "Reviewer",
              },
            },
          ],
        }),
      ),
    ).rejects.toThrow("Codex app-server does not support 'subagent_reference' user message parts.");

    expect(events).not.toContainEqual(expect.objectContaining({ type: "user_message" }));
    expect(transports.get("runtime-live")?.calls.some((call) => call.method === "turn/start")).toBe(
      false,
    );
  });

  test("rejects subagent reference sends before initializing a missing local session", async () => {
    const { adapter, transports, requireRepoRuntime } = createHarness();

    await expect(
      adapter.sendUserMessage(
        codexUserMessageInput({
          externalSessionId: "thread/start-runtime-live",
          parts: [
            {
              kind: "subagent_reference",
              subagent: {
                id: "reviewer",
                name: "reviewer",
                label: "Reviewer",
              },
            },
          ],
        }),
      ),
    ).rejects.toThrow("Codex app-server does not support 'subagent_reference' user message parts.");

    expect(requireRepoRuntime).not.toHaveBeenCalled();
    expect(transports.size).toBe(0);
  });

  test("ignores threadless global Codex notifications while replaying buffered session events", async () => {
    let resolveTurnStart: (() => void) | null = null;
    const takeBufferedEvents = mock(async (_runtimeId: string) => {
      resolveTurnStart?.();
      return bufferedNotifications([
        {
          method: "fs/changed",
          params: {
            paths: ["/repo/src/file.ts"],
          },
        },
      ]);
    });
    const { adapter, transports } = createHarness({ takeBufferedEvents }, { deferTurnStart: true });
    resolveTurnStart = () => {
      transports.get("runtime-live")?.turnStartDeferred.resolve({
        turn: { id: "turn-1", status: "completed" },
      });
    };

    await adapter.startSession(codexStartSessionInput());

    await expect(
      adapter.sendUserMessage(
        codexUserMessageInput({
          externalSessionId: "thread/start-runtime-live",
          parts: [{ kind: "text", text: "Hello Codex" }],
          model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
        }),
      ),
    ).resolves.toMatchObject({ type: "user_message", message: "Hello Codex" });
  });

  test("rejects thread-scoped buffered notifications without a thread id", async () => {
    let resolveTurnStart: (() => void) | null = null;
    const takeBufferedEvents = mock(async (_runtimeId: string) => {
      resolveTurnStart?.();
      return bufferedNotifications([
        {
          method: "item/completed",
          params: {
            turnId: "turn-1",
            item: { type: "agentMessage", id: "agent-unscoped", text: "Wrong session" },
          },
        },
      ]);
    });
    const { adapter, transports } = createHarness({ takeBufferedEvents }, { deferTurnStart: true });
    resolveTurnStart = () => {
      transports.get("runtime-live")?.turnStartDeferred.resolve({
        turn: { id: "turn-1", status: "completed" },
      });
    };

    await adapter.startSession(codexStartSessionInput());

    await expect(
      adapter.sendUserMessage(
        codexUserMessageInput({
          externalSessionId: "thread/start-runtime-live",
          parts: [{ kind: "text", text: "Hello Codex" }],
          model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
        }),
      ),
    ).rejects.toThrow("missing params.threadId");
  });

  test("rejects timestamped Codex lifecycle notifications without runtime timestamps", async () => {
    let resolveTurnStart: (() => void) | null = null;
    const takeBufferedEvents = mock(async (_runtimeId: string) => {
      resolveTurnStart?.();
      return bufferedNotifications([
        {
          method: "item/completed",
          params: {
            threadId: "thread/start-runtime-live",
            turnId: "turn-1",
            item: { type: "agentMessage", id: "agent-missing-time", text: "Wrong time" },
          },
        },
      ]);
    });
    const { adapter, transports } = createHarness({ takeBufferedEvents }, { deferTurnStart: true });
    resolveTurnStart = () => {
      transports.get("runtime-live")?.turnStartDeferred.resolve({
        turn: { id: "turn-1", status: "completed" },
      });
    };

    await adapter.startSession(codexStartSessionInput());

    await expect(
      adapter.sendUserMessage(
        codexUserMessageInput({
          externalSessionId: "thread/start-runtime-live",
          parts: [{ kind: "text", text: "Hello Codex" }],
          model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
        }),
      ),
    ).rejects.toThrow("missing its runtime lifecycle timestamp");
  });

  test("settles a Codex turn from a terminal turn/start response", async () => {
    const takeBufferedEvents = mock(async (_runtimeId: string) => []);
    const { adapter, transports } = createHarness({ takeBufferedEvents }, { deferTurnStart: true });

    await adapter.startSession(codexStartSessionInput());
    transports.get("runtime-live")?.turnStartDeferred.resolve({
      turn: { id: "turn-1", status: "completed" },
    });

    await expect(
      adapter.sendUserMessage(
        codexUserMessageInput({
          externalSessionId: "thread/start-runtime-live",
          parts: [{ kind: "text", text: "Hello Codex" }],
          model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
        }),
      ),
    ).resolves.toMatchObject({
      type: "user_message",
      externalSessionId: "thread/start-runtime-live",
      message: "Hello Codex",
    });

    await expect(
      adapter.readSessionRuntimeSnapshot({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread/start-runtime-live",
      }),
    ).resolves.toMatchObject({ classification: "idle" });
  });

  test("keeps the active turn open when a different turn completes", async () => {
    const takeBufferedEvents = mock(async (_runtimeId: string) =>
      bufferedNotifications([
        {
          method: "turn/started",
          params: {
            threadId: "thread/start-runtime-live",
            turn: { id: "turn-active" },
          },
        },
        {
          method: "turn/completed",
          params: {
            threadId: "thread/start-runtime-live",
            turn: { id: "turn-other", status: "completed" },
          },
        },
      ]),
    );
    const { adapter, transports } = createHarness({ takeBufferedEvents }, { deferTurnStart: true });

    await adapter.startSession(codexStartSessionInput());
    transports.get("runtime-live")?.turnStartDeferred.resolve({
      turn: { id: "turn-active", status: "running" },
    });

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Start now" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );
    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Also inspect failing tests" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    expect(transports.get("runtime-live")?.calls).toContainEqual({
      method: "turn/steer",
      params: {
        threadId: "thread/start-runtime-live",
        input: [{ type: "text", text: "Also inspect failing tests" }],
        expectedTurnId: "turn-active",
      },
    });
  });

  test("settles the active turn when runtime status changes to idle before turn completion", async () => {
    const { subscribeEvents, emitNotification } = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({ subscribeEvents }, { deferTurnStart: true });

    await adapter.startSession(codexStartSessionInput());
    const events: Array<{ type?: string }> = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );
    await flushCodexAdapterWork();

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Start now" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );
    transports.get("runtime-live")?.turnStartDeferred.resolve({
      turn: { id: "turn-live", status: "running" },
    });
    await flushCodexAdapterWork();

    emitNotification({
      method: "thread/status/changed",
      params: {
        threadId: "thread/start-runtime-live",
        status: { type: "idle" },
      },
    });
    await flushCodexAdapterWork();

    await expect(
      adapter.readSessionRuntimeSnapshot({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread/start-runtime-live",
      }),
    ).resolves.toMatchObject({ classification: "idle" });
    expect(events.some((event) => event.type === "session_idle")).toBe(true);

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Continue after idle" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    const runtimeCalls = transports.get("runtime-live")?.calls ?? [];
    expect(runtimeCalls.filter((call) => call.method === "turn/steer")).toEqual([]);
    expect(runtimeCalls.filter((call) => call.method === "turn/start")).toHaveLength(2);
    unsubscribe();
  });

  test("waits for turn completion timing before flushing a final assistant message", async () => {
    const { subscribeEvents, emitNotification } = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({ subscribeEvents }, { deferTurnStart: true });

    await adapter.startSession(codexStartSessionInput());
    const events: Array<{ type?: string; message?: string; totalTokens?: number }> = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );
    await flushCodexAdapterWork();

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Start now" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );
    transports.get("runtime-live")?.turnStartDeferred.resolve({
      turn: { id: "turn-live", status: "running" },
    });
    await flushCodexAdapterWork();

    emitNotification({
      method: "item/completed",
      params: {
        threadId: "thread/start-runtime-live",
        turnId: "turn-live",
        completedAtMs: 1_777_766_419_650,
        item: {
          type: "agentMessage",
          id: "agent-idle-final",
          phase: "final_answer",
          text: "Done before idle.",
        },
      },
    });
    emitNotification({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread/start-runtime-live",
        turnId: "turn-live",
        tokenUsage: {
          total: { totalTokens: 12_345 },
          last: { totalTokens: 321 },
          modelContextWindow: 200_000,
        },
      },
    });
    emitNotification({
      method: "thread/status/changed",
      params: {
        threadId: "thread/start-runtime-live",
        status: { type: "idle" },
      },
    });
    await flushCodexAdapterWork();

    expect(events.some((event) => event.type === "assistant_message")).toBe(false);
    expect(events.some((event) => event.type === "session_idle")).toBe(false);

    emitNotification({
      method: "turn/completed",
      params: {
        threadId: "thread/start-runtime-live",
        turn: {
          id: "turn-live",
          status: "completed",
          completedAt: 1_777_766_420,
          durationMs: 1_200,
        },
      },
    });
    await flushCodexAdapterWork();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_status",
        timestamp: "2026-05-03T00:00:18.450Z",
        status: { type: "busy", message: null },
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "assistant_message",
        message: "Done before idle.",
        totalTokens: 321,
      }),
    );
    const assistantMessageIndex = events.findIndex((event) => event.type === "assistant_message");
    const sessionIdleIndex = events.findLastIndex((event) => event.type === "session_idle");
    expect(assistantMessageIndex).toBeGreaterThanOrEqual(0);
    expect(sessionIdleIndex).toBeGreaterThan(assistantMessageIndex);
    unsubscribe();
  });

  test("late old turn completion does not clear a newer active turn", async () => {
    const { subscribeEvents, emitNotification } = createRuntimeStreamSubscription();
    const firstTurnStart = createDeferred<unknown>();
    const secondTurnStart = createDeferred<unknown>();
    const pendingTurnStarts = [firstTurnStart, secondTurnStart];
    const calls: CodexJsonRpcRequest[] = [];
    const transport: CodexJsonRpcTransport = {
      request: mock(async <Response>(request: CodexJsonRpcRequest): Promise<Response> => {
        calls.push(request);
        if (request.method === "initialize") {
          return {} as Response;
        }
        if (request.method === "model/list") {
          return {
            data: [
              {
                id: "gpt-5",
                model: "gpt-5",
                displayName: "GPT-5",
                hidden: false,
                supportedReasoningEfforts: [
                  { reasoningEffort: "medium", description: "Balanced reasoning" },
                ],
                defaultReasoningEffort: {
                  reasoningEffort: "medium",
                  description: "Balanced reasoning",
                },
                inputModalities: ["text"],
                supportsPersonality: true,
                isDefault: true,
              },
            ],
            nextCursor: null,
          } as Response;
        }
        if (request.method === "thread/start") {
          return {
            thread: {
              id: "thread/start-runtime-live",
              cwd: "/repo",
              createdAt: 1_778_112_000,
              status: { type: "active", activeFlags: [] },
              turns: [],
            },
            startedAt: "2026-05-07T00:00:00.000Z",
          } as Response;
        }
        if (request.method === "thread/name/set") {
          return {} as Response;
        }
        if (request.method === "thread/loaded/list") {
          return { data: ["thread/start-runtime-live"], nextCursor: null } as Response;
        }
        if (request.method === "thread/list") {
          return {
            data: [
              {
                id: "thread/start-runtime-live",
                cwd: "/repo",
                createdAt: 1_778_112_000,
                status: { type: "active", activeFlags: [] },
              },
            ],
            nextCursor: null,
            backwardsCursor: null,
          } as Response;
        }
        if (request.method === "thread/read") {
          return {
            thread: {
              id: "thread/start-runtime-live",
              cwd: "/repo",
              createdAt: 1_778_112_000,
              status: { type: "active", activeFlags: [] },
              turns: [],
            },
          } as Response;
        }
        if (request.method === "turn/start") {
          const deferred = pendingTurnStarts.shift();
          if (!deferred) {
            throw new Error("Unexpected extra turn/start request.");
          }
          return (await deferred.promise) as Response;
        }
        if (request.method === "turn/steer") {
          return { turnId: "turn-steered" } as Response;
        }
        throw new Error(`Unexpected method '${request.method}'.`);
      }),
    };
    const { adapter } = createHarness({
      subscribeEvents,
      transportFactory: () => transport,
    });

    await adapter.startSession(codexStartSessionInput());
    const unsubscribe = await observeSessionState(adapter, "thread/start-runtime-live");

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Start first turn" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );
    emitNotification({
      method: "turn/started",
      params: {
        threadId: "thread/start-runtime-live",
        turn: { id: "turn-old" },
      },
    });
    emitNotification({
      method: "thread/status/changed",
      params: {
        threadId: "thread/start-runtime-live",
        status: { type: "idle" },
      },
    });
    await flushCodexAdapterWork();

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Start replacement turn" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );
    emitNotification({
      method: "turn/started",
      params: {
        threadId: "thread/start-runtime-live",
        turn: { id: "turn-new" },
      },
    });
    await flushCodexAdapterWork();

    firstTurnStart.resolve({ turn: { id: "turn-old", status: "completed" } });
    await flushCodexAdapterWork();

    await expect(
      adapter.readSessionRuntimeSnapshot({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread/start-runtime-live",
      }),
    ).resolves.toMatchObject({ classification: "running" });

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Steer replacement turn" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    expect(calls.filter((call) => call.method === "turn/start")).toHaveLength(2);
    expect(calls).toContainEqual({
      method: "turn/steer",
      params: {
        threadId: "thread/start-runtime-live",
        input: [{ type: "text", text: "Steer replacement turn" }],
        expectedTurnId: "turn-new",
      },
    });
    unsubscribe();
  });

  test("does not settle the active turn from a stale buffered idle status", async () => {
    const staleReceivedAt = new Date(Date.now() - 60_000).toISOString();
    const takeBufferedEvents = mock(async (_runtimeId: string) => []);
    takeBufferedEvents.mockImplementationOnce(async () => [
      bufferedNotificationEvent(
        {
          method: "thread/status/changed",
          params: {
            threadId: "thread/start-runtime-live",
            status: { type: "idle" },
            timestampMs: Date.now() + 60_000,
          },
        },
        "runtime-live",
        staleReceivedAt,
      ),
    ]);
    const { adapter, transports } = createHarness({ takeBufferedEvents }, { deferTurnStart: true });

    await adapter.startSession(codexStartSessionInput());
    const unsubscribe = await observeSessionState(adapter, "thread/start-runtime-live");

    const firstMessage = adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Start now" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );
    await flushCodexAdapterWork();
    transports.get("runtime-live")?.turnStartDeferred.resolve({
      turn: { id: "turn-live", status: "running" },
    });
    await firstMessage;
    await flushCodexAdapterWork();

    await expect(
      adapter.readSessionRuntimeSnapshot({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread/start-runtime-live",
      }),
    ).resolves.toMatchObject({ classification: "running" });

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Keep steering" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    const runtimeCalls = transports.get("runtime-live")?.calls ?? [];
    expect(runtimeCalls.filter((call) => call.method === "turn/start")).toHaveLength(1);
    expect(runtimeCalls).toContainEqual({
      method: "turn/steer",
      params: {
        threadId: "thread/start-runtime-live",
        input: [{ type: "text", text: "Keep steering" }],
        expectedTurnId: "turn-live",
      },
    });
    unsubscribe();
  });

  test("does not settle the active turn from idle status before the turn id is bound", async () => {
    const { subscribeEvents, emitNotification } = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({ subscribeEvents }, { deferTurnStart: true });

    await adapter.startSession(codexStartSessionInput());
    const unsubscribe = await observeSessionState(adapter, "thread/start-runtime-live");

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Start now" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    emitNotification({
      method: "thread/status/changed",
      params: {
        threadId: "thread/start-runtime-live",
        status: { type: "idle" },
      },
    });
    await flushCodexAdapterWork();

    transports.get("runtime-live")?.turnStartDeferred.resolve({
      turn: { id: "turn-live", status: "running" },
    });
    await flushCodexAdapterWork();

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Keep steering" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    const runtimeCalls = transports.get("runtime-live")?.calls ?? [];
    expect(runtimeCalls.filter((call) => call.method === "turn/start")).toHaveLength(1);
    expect(runtimeCalls).toContainEqual({
      method: "turn/steer",
      params: {
        threadId: "thread/start-runtime-live",
        input: [{ type: "text", text: "Keep steering" }],
        expectedTurnId: "turn-live",
      },
    });
    unsubscribe();
  });

  test("rejects malformed receivedAt values before idle status processing", async () => {
    const takeBufferedEvents = mock(async (_runtimeId: string) => []);
    takeBufferedEvents.mockImplementationOnce(async () => [
      bufferedNotificationEvent(
        {
          method: "thread/status/changed",
          params: {
            threadId: "thread/start-runtime-live",
            status: { type: "idle" },
          },
        },
        "runtime-live",
        "not-a-timestamp",
      ),
    ]);
    const { adapter, transports } = createHarness({ takeBufferedEvents }, { deferTurnStart: true });

    await adapter.startSession(codexStartSessionInput());
    const sendUserMessageError = adapter
      .sendUserMessage(
        codexUserMessageInput({
          externalSessionId: "thread/start-runtime-live",
          parts: [{ kind: "text", text: "Start now" }],
          model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
        }),
      )
      .then(
        () => null,
        (error: unknown) => error,
      );
    await flushCodexAdapterWork();
    transports.get("runtime-live")?.turnStartDeferred.resolve({
      turn: { id: "turn-live", status: "running" },
    });

    expect(await sendUserMessageError).toEqual(
      expect.objectContaining({
        message:
          "Codex app-server notification has an unparsable receivedAt timestamp 'not-a-timestamp'.",
      }),
    );
  });

  test("emits accepted queued Codex user messages into the runtime transcript stream", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "notification"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const { adapter, transports } = createHarness({ subscribeEvents }, { deferTurnStart: true });

    await adapter.startSession(codexStartSessionInput());

    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Start now" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );
    transports.get("runtime-live")?.turnStartDeferred.resolve({
      turn: { id: "turn-active", status: "running" },
    });
    await flushCodexAdapterWork();

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Also inspect failing tests" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    const userMessages = events.filter(
      (event): event is { type: "user_message"; message: string } =>
        (event as { type?: string }).type === "user_message",
    );
    expect(userMessages.map((event) => event.message)).toEqual([
      "Start now",
      "Also inspect failing tests",
    ]);
    expect(transports.get("runtime-live")?.calls).toContainEqual({
      method: "turn/steer",
      params: {
        threadId: "thread/start-runtime-live",
        input: [{ type: "text", text: "Also inspect failing tests" }],
        expectedTurnId: "turn-active",
      },
    });

    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      receivedAt: new Date().toISOString(),
      message: {
        method: "item/completed",
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-active",
          item: {
            id: "codex-user-queued-confirmed",
            type: "userMessage",
            content: [{ type: "text", text: "Also inspect failing tests" }],
          },
        },
      },
    });
    await flushCodexAdapterWork();
    const userMessagesAfterNativeEcho = events.filter(
      (event): event is { type: "user_message"; message: string } =>
        (event as { type?: string }).type === "user_message",
    );
    expect(userMessagesAfterNativeEcho.map((event) => event.message)).toEqual([
      "Start now",
      "Also inspect failing tests",
    ]);
    unsubscribe();
  });

  test("does not duplicate streamed user message completions after synthetic echo", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "notification"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const { adapter } = createHarness({ subscribeEvents });

    await adapter.startSession(codexStartSessionInput());

    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Hello streamed Codex" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      receivedAt: new Date().toISOString(),
      message: {
        method: "item/completed",
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-1",
          item: {
            id: "codex-user-confirmed",
            type: "userMessage",
            content: [{ type: "text", text: "Hello   streamed\nCodex" }],
          },
        },
      },
    });
    await Promise.resolve();

    const userMessages = events.filter(
      (event) => (event as { type?: string }).type === "user_message",
    );
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]).toEqual(expect.objectContaining({ message: "Hello streamed Codex" }));
    expect(userMessages).not.toContainEqual(
      expect.objectContaining({ messageId: "codex-user-confirmed" }),
    );
    unsubscribe();
  });

  test("does not duplicate structured streamed user message completions after synthetic echo", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "notification"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const { adapter } = createHarness({ subscribeEvents });

    await adapter.startSession(codexStartSessionInput());

    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [
          { kind: "text", text: "Inspect" },
          {
            kind: "file_reference",
            file: { id: "file-1", path: "/repo/src/app.ts", name: "app.ts", kind: "code" },
          },
        ],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      receivedAt: new Date().toISOString(),
      message: {
        method: "item/completed",
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-1",
          item: {
            id: "codex-structured-user-confirmed",
            type: "userMessage",
            content: [
              { type: "text", text: "Inspect" },
              { type: "mention", name: "app.ts", path: "/repo/src/app.ts" },
            ],
          },
        },
      },
    });
    await Promise.resolve();

    const userMessages = events.filter(
      (event) => (event as { type?: string }).type === "user_message",
    );
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]).toEqual(
      expect.objectContaining({
        parts: expect.arrayContaining([
          expect.objectContaining({
            kind: "file_reference",
            file: expect.objectContaining({ name: "app.ts" }),
          }),
        ]),
      }),
    );
    expect(userMessages).not.toContainEqual(
      expect.objectContaining({ messageId: "codex-structured-user-confirmed" }),
    );
    unsubscribe();
  });

  test("does not duplicate streamed skill reference user message completions after synthetic echo", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "notification"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const { adapter } = createHarness({ subscribeEvents });

    await adapter.startSession(codexStartSessionInput());

    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [
          { kind: "text", text: "Tell me the purpose of " },
          {
            kind: "skill_mention",
            skill: {
              id: "/skills/address-pr-comments/SKILL.md",
              name: "address-pr-comments",
              path: "/skills/address-pr-comments/SKILL.md",
            },
          },
        ],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      receivedAt: new Date().toISOString(),
      message: {
        method: "item/completed",
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-1",
          item: {
            id: "codex-skill-user-confirmed",
            type: "userMessage",
            content: [
              { type: "text", text: "Tell me the purpose of " },
              { type: "text", text: "$address-pr-comments" },
              {
                type: "skill",
                name: "address-pr-comments",
                path: "/skills/address-pr-comments/SKILL.md",
              },
            ],
          },
        },
      },
    });
    await Promise.resolve();

    const userMessages = events.filter(
      (event) => (event as { type?: string }).type === "user_message",
    );
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]).toEqual(
      expect.objectContaining({
        message: "Tell me the purpose of $address-pr-comments",
        parts: expect.arrayContaining([
          expect.objectContaining({
            kind: "skill_mention",
            skill: expect.objectContaining({ name: "address-pr-comments" }),
          }),
        ]),
      }),
    );
    expect(userMessages).not.toContainEqual(
      expect.objectContaining({ messageId: "codex-skill-user-confirmed" }),
    );
    unsubscribe();
  });

  test("emits sent image attachments with staged paths", async () => {
    const subscribeEvents = mock(() => () => {});
    const { adapter } = createHarness({ subscribeEvents });

    await adapter.startSession(codexStartSessionInput());

    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [
          { kind: "text", text: "Inspect this screenshot" },
          {
            kind: "attachment",
            attachment: {
              id: "attachment-1",
              kind: "image",
              name: "Screenshot 2026-05-20 at 21.01.45.png",
              path: "/tmp/openducktor-local-attachments/staged-screenshot.png",
              mime: "image/png",
            },
          },
        ],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "user_message",
        parts: expect.arrayContaining([
          expect.objectContaining({
            kind: "attachment",
            attachment: expect.objectContaining({
              kind: "image",
              name: "Screenshot 2026-05-20 at 21.01.45.png",
              path: "/tmp/openducktor-local-attachments/staged-screenshot.png",
            }),
          }),
        ]),
      }),
    );
    unsubscribe();
  });

  test("replays streamed events that arrive before UI subscription", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "notification"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const { adapter } = createHarness({ subscribeEvents });

    const unsubscribeExistingSessionListener = await observeSessionState(adapter, "thread-saved");
    unsubscribeExistingSessionListener();

    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      receivedAt: new Date().toISOString(),
      message: {
        method: "item/agentMessage/delta",
        params: {
          threadId: "thread-saved",
          turnId: "turn-live",
          itemId: "agent-live",
          delta: "buffered text",
        },
      },
    });
    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      receivedAt: new Date().toISOString(),
      message: {
        method: "item/started",
        params: {
          threadId: "thread-saved",
          turnId: "turn-live",
          startedAtMs: 1_777_766_440_000,
          item: {
            type: "contextCompaction",
            id: "compact-live",
          },
        },
      },
    });
    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      receivedAt: new Date().toISOString(),
      message: {
        method: "item/completed",
        params: {
          threadId: "thread-saved",
          turnId: "turn-live",
          completedAtMs: 1_777_766_441_000,
          item: {
            type: "contextCompaction",
            id: "compact-live",
          },
        },
      },
    });
    await Promise.resolve();

    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread-saved"),
      (event) => events.push(event),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "assistant_delta",
        messageId: "agent-live",
        delta: "buffered text",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_compaction_started",
        externalSessionId: "thread-saved",
        timestamp: expect.any(String),
        messageId: "compact-live",
        message: "Session compaction started.",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_compacted",
        externalSessionId: "thread-saved",
        timestamp: expect.any(String),
        messageId: "compact-live",
        message: "Session compacted.",
      }),
    );
    unsubscribe();
  });

  test("routes live context compaction lifecycle items", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "notification"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const { adapter } = createHarness({ subscribeEvents });
    const events: unknown[] = [];

    await observeSessionState(adapter, "thread-saved");
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread-saved"),
      (event) => events.push(event),
    );

    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      receivedAt: new Date().toISOString(),
      message: {
        method: "item/started",
        params: {
          threadId: "thread-saved",
          turnId: "turn-live",
          startedAtMs: 1_777_766_450_000,
          item: {
            type: "contextCompaction",
            id: "compact-live",
          },
        },
      },
    });
    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      receivedAt: new Date().toISOString(),
      message: {
        method: "item/completed",
        params: {
          threadId: "thread-saved",
          turnId: "turn-live",
          completedAtMs: 1_777_766_451_000,
          item: {
            type: "contextCompaction",
            id: "compact-live",
          },
        },
      },
    });
    await Promise.resolve();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_compaction_started",
        externalSessionId: "thread-saved",
        timestamp: expect.any(String),
        messageId: "compact-live",
        message: "Session compaction started.",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_compacted",
        externalSessionId: "thread-saved",
        timestamp: expect.any(String),
        messageId: "compact-live",
        message: "Session compacted.",
      }),
    );
    unsubscribe();
  });

  test("terminalizes orphaned spawns at model and turn lifecycle boundaries", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "notification"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const { adapter } = createHarness({ subscribeEvents });
    const events: unknown[] = [];

    const setupUnsubscribe = await observeSessionState(adapter, "thread-saved");
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread-saved"),
      (event) => events.push(event),
    );

    try {
      streamListeners[0]?.({
        runtimeId: "runtime-live",
        kind: "notification",
        receivedAt: new Date().toISOString(),
        message: {
          method: "item/started",
          params: {
            threadId: "thread-saved",
            turnId: "turn-live",
            startedAtMs: 1_777_766_452_000,
            item: {
              type: "collabAgentToolCall",
              id: "spawn-live",
              tool: "spawnAgent",
              status: "inProgress",
              senderThreadId: "thread-saved",
              receiverThreadIds: [],
              prompt: "Review this change",
              agentsStates: {},
            },
          },
        },
      });
      await flushCodexAdapterWork();

      expect(events).toContainEqual(
        expect.objectContaining({
          type: "assistant_part",
          externalSessionId: "thread-saved",
          part: expect.objectContaining({
            kind: "subagent",
            correlationKey: "codex-subagent:thread-saved:spawn-live",
            status: "running",
            prompt: "Review this change",
          }),
        }),
      );

      streamListeners[0]?.({
        runtimeId: "runtime-live",
        kind: "notification",
        receivedAt: new Date().toISOString(),
        message: {
          method: "item/completed",
          params: {
            threadId: "thread-saved",
            turnId: "turn-live",
            completedAtMs: 1_777_766_452_021,
            item: {
              type: "agentMessage",
              id: "retry-message",
              text: "The first spawn failed validation. Retrying now.",
            },
          },
        },
      });
      await flushCodexAdapterWork();

      expect(events).toContainEqual(
        expect.objectContaining({
          type: "assistant_part",
          externalSessionId: "thread-saved",
          part: expect.objectContaining({
            kind: "subagent",
            correlationKey: "codex-subagent:thread-saved:spawn-live",
            status: "error",
          }),
        }),
      );

      streamListeners[0]?.({
        runtimeId: "runtime-live",
        kind: "notification",
        receivedAt: new Date().toISOString(),
        message: {
          method: "item/started",
          params: {
            threadId: "thread-saved",
            turnId: "turn-without-followup",
            startedAtMs: 1_777_766_453_000,
            item: {
              type: "collabAgentToolCall",
              id: "spawn-without-followup",
              tool: "spawnAgent",
              status: "inProgress",
              senderThreadId: "thread-saved",
              receiverThreadIds: [],
              prompt: "Review another change",
              agentsStates: {},
            },
          },
        },
      });
      streamListeners[0]?.({
        runtimeId: "runtime-live",
        kind: "notification",
        receivedAt: new Date().toISOString(),
        message: {
          method: "turn/completed",
          params: {
            threadId: "thread-saved",
            turn: {
              id: "turn-without-followup",
              status: "failed",
              completedAt: 1_777_766_454,
            },
          },
        },
      });
      await flushCodexAdapterWork();

      expect(events).toContainEqual(
        expect.objectContaining({
          type: "assistant_part",
          externalSessionId: "thread-saved",
          part: expect.objectContaining({
            kind: "subagent",
            correlationKey: "codex-subagent:thread-saved:spawn-without-followup",
            status: "error",
          }),
        }),
      );

      streamListeners[0]?.({
        runtimeId: "runtime-live",
        kind: "notification",
        receivedAt: new Date().toISOString(),
        message: {
          method: "item/started",
          params: {
            threadId: "thread-saved",
            turnId: "turn-settled-by-idle",
            startedAtMs: 1_777_766_455_000,
            item: {
              type: "collabAgentToolCall",
              id: "spawn-settled-by-idle",
              tool: "spawnAgent",
              status: "inProgress",
              senderThreadId: "thread-saved",
              receiverThreadIds: [],
              prompt: "Review a third change",
              agentsStates: {},
            },
          },
        },
      });
      streamListeners[0]?.({
        runtimeId: "runtime-live",
        kind: "notification",
        receivedAt: new Date().toISOString(),
        message: {
          method: "thread/status/changed",
          params: {
            threadId: "thread-saved",
            status: { type: "idle" },
          },
        },
      });
      await flushCodexAdapterWork();

      expect(events).toContainEqual(
        expect.objectContaining({
          type: "assistant_part",
          externalSessionId: "thread-saved",
          part: expect.objectContaining({
            kind: "subagent",
            correlationKey: "codex-subagent:thread-saved:spawn-settled-by-idle",
            status: "error",
          }),
        }),
      );
    } finally {
      unsubscribe();
      setupUnsubscribe();
    }
  });

  test("maps completed update_plan dynamic tool calls into live session todos", async () => {
    const takeBufferedEvents = mock(async (_runtimeId: string) => []);
    const { adapter, transports } = createHarness({ takeBufferedEvents }, { deferTurnStart: true });

    await adapter.startSession(codexStartSessionInput());

    const events: unknown[] = [];
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-live"), (event) =>
      events.push(event),
    );
    takeBufferedEvents.mockImplementationOnce(async () => {
      transports.get("runtime-live")?.turnStartDeferred.resolve({ turn: { id: "turn-todos" } });
      return bufferedNotifications([
        {
          method: "turn/started",
          params: { threadId: "thread/start-runtime-live", turn: { id: "turn-todos" } },
        },
        {
          method: "item/completed",
          params: {
            threadId: "thread/start-runtime-live",
            turnId: "turn-todos",
            completedAtMs: 1_777_766_460_000,
            item: {
              type: "dynamicToolCall",
              id: "todo-call-1",
              namespace: "functions",
              tool: "update_plan",
              status: "completed",
              success: true,
              arguments: {
                plan: [
                  { step: "Implement Codex todos", status: "completed" },
                  { step: "Verify Codex todos", status: "in_progress" },
                ],
              },
              contentItems: [{ type: "text", text: "Plan updated" }],
            },
          },
        },
      ]);
    });

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Update todos" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_todos_updated",
        todos: [
          expect.objectContaining({ content: "Implement Codex todos", status: "completed" }),
          expect.objectContaining({ content: "Verify Codex todos", status: "in_progress" }),
        ],
      }),
    );
    await expect(
      adapter.loadSessionTodos({
        ...codexSessionRuntimeRef("thread/start-runtime-live"),
        externalSessionId: "thread/start-runtime-live",
      }),
    ).resolves.toEqual([
      expect.objectContaining({ content: "Implement Codex todos", status: "completed" }),
      expect.objectContaining({ content: "Verify Codex todos", status: "in_progress" }),
    ]);
  });
});
