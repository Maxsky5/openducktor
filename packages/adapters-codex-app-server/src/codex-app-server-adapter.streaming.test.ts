import { describe, expect, mock, test } from "bun:test";
import { createHarness } from "./codex-app-server-adapter.test-harness";

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
    adapter.subscribeEvents("thread/start-runtime-ensure", (event) => events.push(event));
    drainNotifications.mockImplementationOnce(async () => {
      transports.get("runtime-ensure")?.turnStartDeferred.resolve({ turn: { id: "turn-1" } });
      return [
        {
          method: "turn/started",
          params: { threadId: "thread/start-runtime-ensure", turn: { id: "turn-1" } },
        },
        {
          method: "item/completed",
          params: {
            threadId: "thread/start-runtime-ensure",
            turnId: "turn-1",
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
            threadId: "thread/start-runtime-ensure",
            turnId: "turn-1",
            itemId: "agent-1",
            delta: "Hi",
          },
        },
        {
          method: "thread/status/changed",
          params: {
            threadId: "thread/start-runtime-ensure",
            status: "thinking",
          },
        },
        {
          method: "item/started",
          params: {
            threadId: "thread/start-runtime-ensure",
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
            threadId: "thread/start-runtime-ensure",
            turnId: "turn-1",
            tokenUsage: {
              total: { totalTokens: 42_000 },
              last: { totalTokens: 1_000 },
              modelContextWindow: 200_000,
            },
          },
        },
        {
          method: "thread/compacted",
          params: {
            threadId: "thread/start-runtime-ensure",
          },
        },
        {
          method: "turn/plan/updated",
          params: {
            threadId: "thread/start-runtime-ensure",
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
            threadId: "thread/start-runtime-ensure",
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
            threadId: "thread/start-runtime-ensure",
            turnId: "turn-1",
            item: {
              type: "commandExecution",
              id: "cmd-failed-1",
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
            threadId: "thread/start-runtime-ensure",
            turnId: "turn-1",
            item: { type: "agentMessage", id: "agent-1", text: "Hi there" },
          },
        },
        {
          method: "turn/completed",
          params: {
            threadId: "thread/start-runtime-ensure",
            turn: { id: "turn-1", status: "completed" },
          },
        },
      ];
    });

    await adapter.sendUserMessage({
      externalSessionId: "thread/start-runtime-ensure",
      parts: [{ kind: "text", text: "Hello Codex" }],
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

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
    expect(events).toContainEqual({
      type: "session_compacted",
      externalSessionId: "thread/start-runtime-ensure",
      timestamp: expect.any(String),
      message: "Codex compacted the conversation.",
    });
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
          partId: "turn-1-update-plan",
          callId: "turn-1-update-plan",
          tool: "update_plan",
          title: "update_plan",
          status: "completed",
          input: {
            explanation: "Working through the implementation.",
            plan: [
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
          partId: "cmd-failed-1",
          tool: "bash",
          status: "error",
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
    adapter.subscribeEvents("thread/start-runtime-ensure", (event) => events.push(event));
    drainNotifications.mockImplementationOnce(async () => {
      transports.get("runtime-ensure")?.turnStartDeferred.resolve({ turn: { id: "turn-tools" } });
      return [
        {
          method: "turn/started",
          params: { threadId: "thread/start-runtime-ensure", turn: { id: "turn-tools" } },
        },
        {
          method: "item/completed",
          params: {
            threadId: "thread/start-runtime-ensure",
            turnId: "turn-tools",
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
            threadId: "thread/start-runtime-ensure",
            turnId: "turn-tools",
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
            threadId: "thread/start-runtime-ensure",
            turnId: "turn-tools",
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
            threadId: "thread/start-runtime-ensure",
            turnId: "turn-tools",
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
            threadId: "thread/start-runtime-ensure",
            turnId: "turn-tools",
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
          params: { threadId: "thread/start-runtime-ensure", turn: { id: "turn-tools" } },
        },
      ];
    });

    await adapter.sendUserMessage({
      externalSessionId: "thread/start-runtime-ensure",
      parts: [{ kind: "text", text: "Use tools" }],
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

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
          tool: "search",
          input: expect.objectContaining({ command: "rg foo src", query: "foo", path: "src" }),
        }),
        expect.objectContaining({ tool: "apply_patch", input: { patch }, output: patch }),
        expect.objectContaining({
          tool: "websearch",
          input: { query: "Codex App Server" },
          output: "web result",
          preview: "Codex App Server",
        }),
        expect.objectContaining({ tool: "image_gen.imagegen", input: { prompt: "duck" } }),
        expect.objectContaining({ tool: "multi_tool_use.parallel", input: { tool_uses: [] } }),
      ]),
    );
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
    adapter.subscribeEvents("thread/start-runtime-ensure", (event) => events.push(event));
    transports.get("runtime-ensure")?.turnStartDeferred.resolve({
      turn: { id: "turn-1", status: "completed" },
    });

    await adapter.sendUserMessage({
      externalSessionId: "thread/start-runtime-ensure",
      parts: [{ kind: "text", text: "Hello Codex" }],
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    expect(events).not.toContainEqual(
      expect.objectContaining({ messageId: "agent-foreign", message: "Wrong session" }),
    );
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
    transports.get("runtime-ensure")?.turnStartDeferred.resolve({
      turn: { id: "turn-1", status: "completed" },
    });

    await expect(
      adapter.sendUserMessage({
        externalSessionId: "thread/start-runtime-ensure",
        parts: [{ kind: "text", text: "Hello Codex" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    ).resolves.toBeUndefined();

    await expect(
      adapter.readSessionPresence({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread/start-runtime-ensure",
      }),
    ).resolves.toMatchObject({ classification: "idle" });
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
    const unsubscribe = adapter.subscribeEvents("thread/start-runtime-ensure", (event) =>
      events.push(event),
    );

    await adapter.sendUserMessage({
      externalSessionId: "thread/start-runtime-ensure",
      parts: [{ kind: "text", text: "Hello streamed Codex" }],
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    streamListeners[0]?.({
      runtimeId: "runtime-ensure",
      kind: "notification",
      message: {
        method: "item/completed",
        params: {
          threadId: "thread/start-runtime-ensure",
          turnId: "turn-1",
          item: {
            id: "codex-user-confirmed",
            type: "userMessage",
            content: [{ type: "text", text: "Hello streamed Codex" }],
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
    const unsubscribe = adapter.subscribeEvents("thread/start-runtime-ensure", (event) =>
      events.push(event),
    );

    await adapter.sendUserMessage({
      externalSessionId: "thread/start-runtime-ensure",
      parts: [
        { kind: "text", text: "Inspect" },
        {
          kind: "file_reference",
          file: { id: "file-1", path: "/repo/src/app.ts", name: "app.ts", kind: "code" },
        },
      ],
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    streamListeners[0]?.({
      runtimeId: "runtime-ensure",
      kind: "notification",
      message: {
        method: "item/completed",
        params: {
          threadId: "thread/start-runtime-ensure",
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

  test("replays streamed events that arrive before UI subscription", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "notification"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const { adapter } = createHarness({ subscribeEvents });

    await adapter.attachSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      externalSessionId: "thread-saved",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      message: {
        method: "thread/compacted",
        params: {
          threadId: "thread-saved",
          turnId: "turn-live",
        },
      },
    });
    await Promise.resolve();

    const events: unknown[] = [];
    const unsubscribe = adapter.subscribeEvents("thread-saved", (event) => events.push(event));

    expect(events).toContainEqual({
      type: "session_compacted",
      externalSessionId: "thread-saved",
      timestamp: expect.any(String),
      message: "Codex compacted the conversation.",
    });
    unsubscribe();
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
    adapter.subscribeEvents("thread/start-runtime-ensure", (event) => events.push(event));
    drainNotifications.mockImplementationOnce(async () => {
      transports.get("runtime-ensure")?.turnStartDeferred.resolve({ turn: { id: "turn-todos" } });
      return [
        {
          method: "turn/started",
          params: { threadId: "thread/start-runtime-ensure", turn: { id: "turn-todos" } },
        },
        {
          method: "item/completed",
          params: {
            threadId: "thread/start-runtime-ensure",
            turnId: "turn-todos",
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

    await adapter.sendUserMessage({
      externalSessionId: "thread/start-runtime-ensure",
      parts: [{ kind: "text", text: "Update todos" }],
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

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
        externalSessionId: "thread/start-runtime-ensure",
      }),
    ).resolves.toEqual([
      expect.objectContaining({ content: "Implement Codex todos", status: "completed" }),
      expect.objectContaining({ content: "Verify Codex todos", status: "in_progress" }),
    ]);
  });
});
