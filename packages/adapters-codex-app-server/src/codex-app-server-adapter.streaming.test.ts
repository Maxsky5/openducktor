import { describe, expect, mock, test } from "bun:test";
import {
  codexSessionRuntimeRef,
  codexUserMessageInput,
  createHarness,
  flushCodexAdapterWork,
} from "./codex-app-server-adapter.test-harness";
import type { CodexAppServerAdapter } from "./index";

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
    const drainNotifications = mock(async (_runtimeId: string) => [] as unknown[]);
    const { adapter, transports } = createHarness({ drainNotifications }, { deferTurnStart: true });

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    const events: unknown[] = [];
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-live"), (event) =>
      events.push(event),
    );
    drainNotifications.mockImplementationOnce(async () => {
      transports.get("runtime-live")?.turnStartDeferred.resolve({ turn: { id: "turn-1" } });
      return [
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
            turn: { id: "turn-1", status: "completed", completedAt: 1_777_766_403 },
          },
        },
      ];
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
    const drainNotifications = mock(async (_runtimeId: string) => [] as unknown[]);
    const { adapter, transports } = createHarness({ drainNotifications }, { deferTurnStart: true });

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    const events: unknown[] = [];
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-live"), (event) =>
      events.push(event),
    );
    drainNotifications.mockImplementationOnce(async () => {
      transports.get("runtime-live")?.turnStartDeferred.resolve({ turn: { id: "turn-tools" } });
      return [
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
      ];
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
    const drainNotifications = mock(async (_runtimeId: string) => [] as unknown[]);
    const { adapter, transports } = createHarness({ drainNotifications }, { deferTurnStart: true });

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    adapter.updateSessionModel({
      externalSessionId: "thread/start-runtime-live",
      model: { providerId: "openai", modelId: "gpt-5", variant: "high" },
    });

    const events: unknown[] = [];
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-live"), (event) =>
      events.push(event),
    );
    drainNotifications.mockImplementationOnce(async () => {
      setTimeout(() => {
        transports.get("runtime-live")?.turnStartDeferred.resolve({
          turn: { id: "turn-notification-first", status: "completed" },
        });
      }, 0);
      return [
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
            },
          },
        },
      ];
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

  test("uses active turn model for completed user messages without turn id", async () => {
    const drainNotifications = mock(async (_runtimeId: string) => [] as unknown[]);
    const { adapter, transports } = createHarness({ drainNotifications }, { deferTurnStart: true });

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    const events: unknown[] = [];
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-live"), (event) =>
      events.push(event),
    );
    drainNotifications.mockImplementationOnce(async () => {
      adapter.updateSessionModel({
        externalSessionId: "thread/start-runtime-live",
        model: { providerId: "openai", modelId: "gpt-5", variant: "high" },
      });
      setTimeout(() => {
        transports.get("runtime-live")?.turnStartDeferred.resolve({
          turn: { id: "turn-without-item-id", status: "completed" },
        });
      }, 0);
      return [
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
      ];
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
    const drainNotifications = mock(
      async (_runtimeId: string) =>
        [
          {
            method: "item/completed",
            params: {
              threadId: "other-thread",
              turnId: "turn-foreign",
              item: { type: "agentMessage", id: "agent-foreign", text: "Wrong session" },
            },
          },
        ] as unknown[],
    );
    const { adapter, transports } = createHarness({ drainNotifications }, { deferTurnStart: true });

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
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

  test("ignores threadless global Codex notifications while draining a session", async () => {
    let resolveTurnStart: (() => void) | null = null;
    const drainNotifications = mock(async (_runtimeId: string) => {
      resolveTurnStart?.();
      return [
        {
          method: "fs/changed",
          params: {
            paths: ["/repo/src/file.ts"],
          },
        },
      ] as unknown[];
    });
    const { adapter, transports } = createHarness({ drainNotifications }, { deferTurnStart: true });
    resolveTurnStart = () => {
      transports.get("runtime-live")?.turnStartDeferred.resolve({
        turn: { id: "turn-1", status: "completed" },
      });
    };

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

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

  test("rejects thread-scoped drained notifications without a thread id", async () => {
    let resolveTurnStart: (() => void) | null = null;
    const drainNotifications = mock(async (_runtimeId: string) => {
      resolveTurnStart?.();
      return [
        {
          method: "item/completed",
          params: {
            turnId: "turn-1",
            item: { type: "agentMessage", id: "agent-unscoped", text: "Wrong session" },
          },
        },
      ] as unknown[];
    });
    const { adapter, transports } = createHarness({ drainNotifications }, { deferTurnStart: true });
    resolveTurnStart = () => {
      transports.get("runtime-live")?.turnStartDeferred.resolve({
        turn: { id: "turn-1", status: "completed" },
      });
    };

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

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
    const drainNotifications = mock(async (_runtimeId: string) => {
      resolveTurnStart?.();
      return [
        {
          method: "item/completed",
          params: {
            threadId: "thread/start-runtime-live",
            turnId: "turn-1",
            item: { type: "agentMessage", id: "agent-missing-time", text: "Wrong time" },
          },
        },
      ] as unknown[];
    });
    const { adapter, transports } = createHarness({ drainNotifications }, { deferTurnStart: true });
    resolveTurnStart = () => {
      transports.get("runtime-live")?.turnStartDeferred.resolve({
        turn: { id: "turn-1", status: "completed" },
      });
    };

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

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
    const drainNotifications = mock(async (_runtimeId: string) => [] as unknown[]);
    const { adapter, transports } = createHarness({ drainNotifications }, { deferTurnStart: true });

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
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
    const drainNotifications = mock(async (_runtimeId: string) => [
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
    ]);
    const { adapter, transports } = createHarness({ drainNotifications }, { deferTurnStart: true });

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
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

  test("emits accepted queued Codex user messages into the runtime transcript stream", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "notification"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const { adapter, transports } = createHarness({ subscribeEvents }, { deferTurnStart: true });

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

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

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

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

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

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

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

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

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

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

  test("emits live subagent rows from started collab items", async () => {
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
    } finally {
      unsubscribe();
      setupUnsubscribe();
    }
  });

  test("maps completed update_plan dynamic tool calls into live session todos", async () => {
    const drainNotifications = mock(async (_runtimeId: string) => [] as unknown[]);
    const { adapter, transports } = createHarness({ drainNotifications }, { deferTurnStart: true });

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    const events: unknown[] = [];
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-live"), (event) =>
      events.push(event),
    );
    drainNotifications.mockImplementationOnce(async () => {
      transports.get("runtime-live")?.turnStartDeferred.resolve({ turn: { id: "turn-todos" } });
      return [
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
      ];
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
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread/start-runtime-live",
      }),
    ).resolves.toEqual([
      expect.objectContaining({ content: "Implement Codex todos", status: "completed" }),
      expect.objectContaining({ content: "Verify Codex todos", status: "in_progress" }),
    ]);
  });
});
