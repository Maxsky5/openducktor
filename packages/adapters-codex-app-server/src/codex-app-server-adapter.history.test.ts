import { describe, expect, test } from "bun:test";
import {
  bufferedNotificationEvent,
  createAdapterWithTransport,
  createDeferred,
  createHarness,
  defaultCodexEffectivePolicy,
  flushCodexAdapterWork,
} from "./codex-app-server-adapter.test-harness";
import type { CodexJsonRpcRequest, CodexJsonRpcTransport } from "./index";

const restoredTokenUsageNotification = (threadId: string, turnId = "turn-1") => ({
  method: "thread/tokenUsage/updated",
  params: {
    threadId,
    turnId,
    tokenUsage: {
      total: { totalTokens: 42_000 },
      last: { totalTokens: 1_000 },
      modelContextWindow: 200_000,
    },
  },
});

describe("CodexAppServerAdapter history loading", () => {
  test("marks hydrated item timestamps approximate when Codex only reports a turn boundary", async () => {
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        if (request.method === "thread/read") {
          return {
            thread: {
              id: "child-thread",
              cwd: "/repo",
              createdAt: 1_783_715_580,
              status: { type: "idle" },
              turns: [
                {
                  id: "child-turn",
                  startedAt: 1_783_715_581,
                  completedAt: null,
                  durationMs: null,
                  status: "inProgress",
                  items: [
                    {
                      id: "child-user",
                      type: "userMessage",
                      content: [{ type: "text", text: "Inspect the repository" }],
                    },
                    {
                      id: "child-commentary",
                      type: "agentMessage",
                      phase: "commentary",
                      text: "I’m checking the repository now.",
                    },
                    {
                      id: "child-command",
                      type: "commandExecution",
                      command: "pwd",
                      cwd: "/repo",
                      processId: null,
                      source: "model",
                      status: "completed",
                      commandActions: [{ type: "unknown", command: "pwd" }],
                      aggregatedOutput: "/repo",
                      exitCode: 0,
                      durationMs: 12,
                    },
                    {
                      id: "child-tool",
                      type: "mcpToolCall",
                      server: "semble",
                      tool: "search",
                      status: "completed",
                      arguments: { query: "architecture" },
                      appContext: null,
                      pluginId: null,
                      result: { content: [{ type: "text", text: "result" }] },
                      error: null,
                      durationMs: 107,
                    },
                  ],
                },
              ],
            },
          } as Response;
        }
        if (request.method === "thread/turns/list") {
          return { data: [], nextCursor: null } as Response;
        }
        throw new Error(`Unexpected method '${request.method}'.`);
      },
    };
    const adapter = createAdapterWithTransport(transport);

    const history = await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "child-thread",
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });
    const byId = new Map(history.map((message) => [message.messageId, message]));
    const hasApproximateTimestamp = (messageId: string): boolean | undefined =>
      (byId.get(messageId) as { timestampIsApproximate?: boolean } | undefined)
        ?.timestampIsApproximate;

    expect(byId.get("child-user")?.timestamp).toBe("2026-07-10T20:33:01.000Z");
    expect(hasApproximateTimestamp("child-user")).toBeUndefined();
    expect(byId.get("child-commentary")?.timestamp).toBe("2026-07-10T20:33:01.000Z");
    expect(hasApproximateTimestamp("child-commentary")).toBe(true);
    expect(byId.get("child-command")?.timestamp).toBe("2026-07-10T20:33:01.000Z");
    expect(hasApproximateTimestamp("child-command")).toBe(true);
    expect(byId.get("child-tool")?.timestamp).toBe("2026-07-10T20:33:01.000Z");
    expect(hasApproximateTimestamp("child-tool")).toBe(true);
    expect(
      (
        byId.get("child-command")?.parts[0] as
          | { startedAtMs?: number; endedAtMs?: number }
          | undefined
      )?.startedAtMs,
    ).toBeUndefined();
    expect(
      (byId.get("child-tool")?.parts[0] as { startedAtMs?: number; endedAtMs?: number } | undefined)
        ?.endedAtMs,
    ).toBeUndefined();
  });

  test("preserves inherited Codex history and inserts the exact subagent fork boundary", async () => {
    const calls: CodexJsonRpcRequest[] = [];
    const childTurns = [
      {
        id: "parent-turn",
        startedAt: 10,
        completedAt: 20,
        status: "interrupted",
        items: [
          {
            id: "parent-user",
            type: "userMessage",
            content: [{ type: "text", text: "Parent prompt" }],
          },
          {
            id: "parent-spawn",
            type: "subAgentActivity",
            agentThreadId: "child-thread",
            agentPath: "/root/child",
            kind: "started",
          },
          {
            id: "parent-answer",
            type: "agentMessage",
            phase: "commentary",
            text: "Parent answer",
          },
        ],
      },
      {
        id: "parent-final-turn",
        startedAt: 21,
        completedAt: 24,
        status: "completed",
        items: [
          {
            id: "parent-final-answer",
            type: "agentMessage",
            phase: "final_answer",
            text: "Parent final answer",
          },
        ],
      },
      {
        id: "child-turn",
        startedAt: 30,
        completedAt: 40,
        status: "completed",
        items: [
          {
            id: "child-user",
            type: "userMessage",
            content: [{ type: "text", text: "Child task" }],
          },
          {
            id: "child-answer",
            type: "agentMessage",
            phase: "final_answer",
            text: "Child result",
          },
        ],
      },
    ];
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        calls.push(request);
        if (request.method === "thread/read") {
          const params = request.params as { threadId?: string };
          if (params.threadId === "parent-thread") {
            return {
              thread: {
                id: "parent-thread",
                cwd: "/repo",
                createdAt: 1,
                status: { type: "idle" },
                turns: childTurns.slice(0, 2),
              },
            } as Response;
          }
          return {
            thread: {
              id: "child-thread",
              cwd: "/repo",
              createdAt: 25,
              status: { type: "idle" },
              forkedFromId: "parent-thread",
              parentThreadId: "parent-thread",
              turns: childTurns,
            },
          } as Response;
        }
        if (request.method === "thread/turns/list") {
          const params = request.params as {
            threadId: string;
            itemsView: string;
          };
          if (params.threadId === "parent-thread") {
            return {
              data: [
                { id: "parent-turn", status: "completed", items: [] },
                { id: "parent-final-turn", status: "completed", items: [] },
              ],
              nextCursor: null,
            } as Response;
          }
          return { data: childTurns, nextCursor: null } as Response;
        }
        throw new Error(`Unexpected method '${request.method}'.`);
      },
    };
    let shouldReturnParentUsage = true;
    const adapter = createAdapterWithTransport(transport, {
      takeBufferedEvents: async () => {
        if (!shouldReturnParentUsage) {
          return [];
        }
        shouldReturnParentUsage = false;
        return [
          bufferedNotificationEvent(
            restoredTokenUsageNotification("parent-thread", "parent-final-turn"),
          ),
        ];
      },
    });

    await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "parent-thread",
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });

    const history = await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "child-thread",
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });

    expect(history.map((message) => message.messageId)).toEqual([
      "parent-user",
      "codex-subagent:parent-thread:child-thread",
      "parent-answer",
      "parent-final-answer",
      "codex-fork-boundary:child-thread:child-turn",
      "child-user",
      "child-answer",
    ]);
    expect(history[4]).toEqual({
      messageId: "codex-fork-boundary:child-thread:child-turn",
      role: "system",
      timestamp: "1970-01-01T00:00:30.000Z",
      text: "Session forked here",
      notice: {
        tone: "info",
        reason: "session_forked",
        title: "Session forked here",
        parentExternalSessionId: "parent-thread",
      },
      parts: [],
    });
    expect(history.find((message) => message.messageId === "parent-final-answer")).toMatchObject({
      totalTokens: 1_000,
      contextWindow: 200_000,
      parts: [
        expect.objectContaining({
          kind: "step",
          phase: "finish",
          totalTokens: 1_000,
          contextWindow: 200_000,
        }),
      ],
    });
    expect(
      calls.some(
        (call) =>
          call.method === "thread/turns/list" &&
          (call.params as { threadId?: string; itemsView?: string }).threadId === "parent-thread" &&
          (call.params as { itemsView?: string }).itemsView === "summary",
      ),
    ).toBe(true);
  });

  test("loads Codex history and diff from App Server reads", async () => {
    const { adapter, takeBufferedEvents, transports } = createHarness();

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    takeBufferedEvents.mockImplementation(async () => [
      bufferedNotificationEvent(restoredTokenUsageNotification("thread/start-runtime-live")),
    ]);

    const history = await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread/start-runtime-live",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });

    expect(history).toEqual([
      {
        messageId: "codex-system-prompt:thread/start-runtime-live",
        role: "system",
        timestamp: "2026-05-07T00:00:00.000Z",
        text: "System prompt:\n\nUse the repo rules.",
        parts: [],
      },
      expect.objectContaining({
        messageId: "user-history-1",
        role: "user",
        timestamp: "2026-05-07T00:00:01.000Z",
        text: "Hello Codex",
      }),
      expect.objectContaining({
        messageId: "reason-1",
        role: "assistant",
        parts: [expect.objectContaining({ kind: "reasoning", text: "Thinking" })],
      }),
      expect.objectContaining({
        messageId: "cmd-read-1",
        role: "assistant",
        parts: [
          expect.objectContaining({
            kind: "tool",
            tool: "read",
            toolType: "read",
            title: "Read",
            preview: "/repo/src/app.ts",
            input: expect.objectContaining({ path: "/repo/src/app.ts" }),
            output: "export const app = true;",
          }),
        ],
      }),
      expect.objectContaining({
        messageId: "cmd-bash-1",
        role: "assistant",
        parts: [
          expect.objectContaining({
            kind: "tool",
            tool: "bash",
            toolType: "bash",
            title: "Bash",
            preview: "bun test",
            input: expect.objectContaining({ command: "bun test" }),
            output: "1 pass",
          }),
        ],
      }),
      expect.objectContaining({
        messageId: "file-change-1",
        role: "assistant",
        parts: [
          expect.objectContaining({
            kind: "tool",
            tool: "apply_patch",
            toolType: "file_edit",
            input: expect.objectContaining({ patch: expect.stringContaining("@@") }),
            output: expect.stringContaining("@@"),
            fileDiffs: [
              {
                file: "/repo/src/app.ts",
                type: "modified",
                additions: 1,
                deletions: 1,
                diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n-old\n+new\n",
              },
            ],
          }),
        ],
      }),
      expect.objectContaining({
        messageId: "file-change-failed-1",
        role: "assistant",
        parts: [
          expect.objectContaining({
            kind: "tool",
            tool: "apply_patch",
            toolType: "file_edit",
            status: "error",
            error: "patch failed",
            output: expect.stringContaining("broken"),
            input: expect.objectContaining({ patch: expect.stringContaining("broken") }),
          }),
        ],
      }),
      expect.objectContaining({
        messageId: "dynamic-tool-1",
        role: "assistant",
        parts: [
          expect.objectContaining({
            kind: "tool",
            tool: "codex.read",
            input: { path: "/repo/README.md" },
            output: expect.stringContaining("README"),
          }),
        ],
      }),
      expect.objectContaining({
        messageId: "web-search-1",
        role: "assistant",
        parts: [
          expect.objectContaining({
            kind: "tool",
            tool: "webSearch",
            toolType: "web",
            input: { query: "OpenDucktor Codex runtime" },
            output: expect.stringContaining("search results"),
          }),
        ],
      }),
      expect.objectContaining({
        messageId: "tool-1",
        role: "assistant",
        parts: [
          expect.objectContaining({
            kind: "tool",
            tool: "odt_read_task",
            toolType: "workflow",
            title: "read_task",
            input: { taskId: "task-1" },
            output: expect.stringContaining("ok"),
          }),
        ],
      }),
      expect.objectContaining({
        messageId: "tool-failed-1",
        role: "assistant",
        parts: [
          expect.objectContaining({
            kind: "tool",
            tool: "odt_read_task",
            toolType: "workflow",
            status: "error",
            error: "task missing",
          }),
        ],
      }),
      expect.objectContaining({
        messageId: "msg-1",
        role: "assistant",
        timestamp: "2026-05-07T00:00:31.000Z",
        text: "Hello from history",
        totalTokens: 1_000,
        contextWindow: 200_000,
        parts: [
          expect.objectContaining({
            kind: "step",
            phase: "finish",
            reason: "stop",
            totalTokens: 1_000,
            contextWindow: 200_000,
          }),
        ],
      }),
      expect.objectContaining({
        messageId: "msg-commentary-1",
        role: "assistant",
        timestamp: "2026-05-07T00:00:31.000Z",
        text: "Later commentary",
        parts: [],
      }),
    ]);
    expect(
      transports.get("runtime-live")?.calls.some((call) => call.method === "thread/turns/list"),
    ).toBe(true);
    await expect(
      adapter.loadSessionDiff({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread/start-runtime-live",
      }),
    ).resolves.toEqual([
      {
        file: "src/app.ts",
        type: "modified",
        additions: 1,
        deletions: 0,
        diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n",
      },
    ]);
  });

  test("keeps the runtime-owned system prompt after observing a live session ref", async () => {
    const { adapter } = createHarness();

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    const unsubscribe = await adapter.subscribeEvents(
      {
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread/start-runtime-live",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      },
      () => {},
    );

    const history = await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread/start-runtime-live",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });

    expect(history[0]).toEqual({
      messageId: "codex-system-prompt:thread/start-runtime-live",
      role: "system",
      timestamp: "2026-05-07T00:00:00.000Z",
      text: "System prompt:\n\nUse the repo rules.",
      parts: [],
    });
    unsubscribe();
  });

  test("projects supplied prompt context for cold persisted history reads", async () => {
    const { adapter } = createHarness();

    const history = await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-saved",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPromptContext: {
        startedAt: "2026-05-07T00:00:00.000Z",
        systemPrompt: "Use the hydrated task context.",
      },
    });

    expect(history[0]).toEqual({
      messageId: "codex-system-prompt:thread-saved",
      role: "system",
      timestamp: "2026-05-07T00:00:00.000Z",
      text: "System prompt:\n\nUse the hydrated task context.",
      parts: [],
    });
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageId: "user-history-1",
          role: "user",
          text: "Hello Codex",
        }),
      ]),
    );
  });

  test("loads search command metadata and hides contextual user fragments from thread reads", async () => {
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-search"], nextCursor: null } as Response;
        }
        if (request.method === "thread/list") {
          return {
            data: [{ id: "thread-search", cwd: "/repo", createdAt: 1, status: { type: "active" } }],
            nextCursor: null,
          } as Response;
        }
        if (request.method === "thread/turns/list") {
          return { data: [], nextCursor: null } as Response;
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        const includeTurns = (request.params as { includeTurns?: boolean }).includeTurns;
        if (includeTurns === false) {
          return { thread: { id: "thread-search", cwd: "/repo", createdAt: 1 } } as Response;
        }
        return {
          thread: {
            id: "thread-search",
            cwd: "/repo",
            createdAt: 1,
            turns: [
              {
                id: "turn-search",
                startedAt: 1,
                completedAt: 2,
                status: "completed",
                items: [
                  {
                    id: "context-1",
                    type: "userMessage",
                    role: "user",
                    content: [
                      {
                        type: "text",
                        text: "<environment_context>\nsecret repo context\n</environment_context>",
                      },
                    ],
                  },
                  {
                    id: "search-1",
                    type: "commandExecution",
                    command: "rg foo src",
                    cwd: "/repo",
                    status: "completed",
                    commandActions: [{ type: "search", command: "rg foo src" }],
                    aggregatedOutput: "src/app.ts:foo",
                  },
                ],
              },
            ],
          },
        } as Response;
      },
    };
    const adapter = createAdapterWithTransport(transport);

    const history = await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-search",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });

    expect(history).toEqual([
      expect.objectContaining({
        messageId: "search-1",
        role: "assistant",
        parts: [
          expect.objectContaining({
            kind: "tool",
            tool: "search",
            toolType: "search",
            preview: "foo in src",
            input: expect.objectContaining({ query: "foo", path: "src" }),
            output: "src/app.ts:foo",
          }),
        ],
      }),
    ]);
  });

  test("loads persisted Codex skill marker text into user display parts", async () => {
    const calls: CodexJsonRpcRequest[] = [];
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        calls.push(request);
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-skill"], nextCursor: null } as Response;
        }
        if (request.method === "thread/list") {
          return {
            data: [{ id: "thread-skill", cwd: "/repo", createdAt: 1, status: { type: "active" } }],
            nextCursor: null,
          } as Response;
        }
        if (request.method === "thread/turns/list") {
          return { data: [], nextCursor: null } as Response;
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        const includeTurns = (request.params as { includeTurns?: boolean }).includeTurns;
        if (includeTurns === false) {
          return { thread: { id: "thread-skill", cwd: "/repo", createdAt: 1 } } as Response;
        }
        return {
          thread: {
            id: "thread-skill",
            cwd: "/repo",
            createdAt: 1,
            turns: [
              {
                id: "turn-skill",
                startedAt: 1,
                completedAt: 2,
                status: "completed",
                items: [
                  {
                    id: "skill-user-1",
                    type: "userMessage",
                    content: [
                      {
                        type: "text",
                        text: "Tell me the purpose of $create-pr please",
                        text_elements: [
                          {
                            byteRange: { start: 23, end: 33 },
                            placeholder: "$create-pr",
                          },
                        ],
                      },
                      {
                        type: "skill",
                        name: "create-pr",
                        path: "/repo/.codex/skills/create-pr/SKILL.md",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        } as Response;
      },
    };
    const adapter = createAdapterWithTransport(transport);

    const history = await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-skill",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });

    expect(calls.some((call) => call.method === "skills/list")).toBe(false);
    expect(history).toEqual([
      expect.objectContaining({
        messageId: "skill-user-1",
        role: "user",
        text: "Tell me the purpose of $create-pr please",
        displayParts: [
          { kind: "text", text: "Tell me the purpose of " },
          {
            kind: "skill_mention",
            skill: {
              id: "/repo/.codex/skills/create-pr/SKILL.md",
              name: "create-pr",
              path: "/repo/.codex/skills/create-pr/SKILL.md",
            },
            sourceText: {
              value: "$create-pr",
              start: 23,
              end: 33,
            },
          },
          { kind: "text", text: " please" },
        ],
      }),
    ]);
  });

  test("loads idle history through the fast read path before restoring context", async () => {
    const { adapter, takeBufferedEvents, transports } = createHarness();

    takeBufferedEvents.mockImplementation(async () => {
      const didRequestRestoredUsage = transports
        .get("runtime-live")
        ?.calls.some(
          (call) =>
            call.method === "thread/resume" &&
            (call.params as { threadId?: string }).threadId === "thread-idle" &&
            (call.params as { excludeTurns?: boolean }).excludeTurns === false,
        );
      return didRequestRestoredUsage
        ? [bufferedNotificationEvent(restoredTokenUsageNotification("thread-idle"))]
        : [];
    });

    const history = await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-idle",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });

    expect(
      transports
        .get("runtime-live")
        ?.calls.some(
          (call) =>
            call.method === "thread/read" &&
            (call.params as { threadId?: string }).threadId === "thread-idle",
        ),
    ).toBe(true);
    expect(history.find((message) => message.messageId === "msg-1")).toEqual(
      expect.objectContaining({
        role: "assistant",
        text: "Hello from history",
      }),
    );

    await flushCodexAdapterWork();
    expect(transports.get("runtime-live")?.calls).toContainEqual(
      expect.objectContaining({
        method: "thread/resume",
        params: expect.objectContaining({
          threadId: "thread-idle",
          excludeTurns: false,
        }),
      }),
    );
  });

  test("does not block unloaded idle history on restored context replay", async () => {
    const calls: CodexJsonRpcRequest[] = [];
    const resume = createDeferred<unknown>();
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        calls.push(request);
        if (request.method === "thread/read") {
          return {
            thread: {
              id: "thread-unloaded-idle",
              cwd: "/repo",
              status: { type: "idle" },
              turns: [
                {
                  id: "turn-1",
                  status: "completed",
                  items: [
                    {
                      id: "msg-1",
                      type: "agentMessage",
                      phase: "final_answer",
                      text: "Hydrated from thread/read",
                    },
                  ],
                },
              ],
            },
          } as Response;
        }
        if (request.method === "thread/turns/list") {
          return { data: [], nextCursor: null } as Response;
        }
        if (request.method === "thread/loaded/list") {
          return { data: [], nextCursor: null } as Response;
        }
        if (request.method === "thread/list") {
          return {
            data: [
              {
                id: "thread-unloaded-idle",
                cwd: "/repo",
                createdAt: 1,
                preview: "Unloaded idle thread",
                status: { type: "idle" },
              },
            ],
            nextCursor: null,
          } as Response;
        }
        if (request.method === "thread/resume") {
          return resume.promise as Promise<Response>;
        }
        throw new Error(`Unexpected method '${request.method}'.`);
      },
    };
    const adapter = createAdapterWithTransport(transport, {
      takeBufferedEvents: async () =>
        calls.some((call) => call.method === "thread/resume")
          ? [bufferedNotificationEvent(restoredTokenUsageNotification("thread-unloaded-idle"))]
          : [],
    });

    const history = await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-unloaded-idle",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });

    expect(history.find((message) => message.messageId === "msg-1")).toEqual(
      expect.objectContaining({
        text: "Hydrated from thread/read",
      }),
    );
    await flushCodexAdapterWork();
    const methods = calls.map((call) => call.method);
    expect(methods.indexOf("thread/read")).toBeLessThan(methods.indexOf("thread/resume"));
    resume.resolve({
      thread: {
        id: "thread-unloaded-idle",
        cwd: "/repo",
        createdAt: 1_778_112_000,
        status: { type: "idle" },
        turns: [],
      },
      startedAt: "2026-05-07T00:00:00.000Z",
    });
    await flushCodexAdapterWork();
  });

  test("loads paginated stored history when the thread is absent from inventory", async () => {
    const calls: CodexJsonRpcRequest[] = [];
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        calls.push(request);
        if (request.method === "thread/loaded/list") {
          return { data: [], nextCursor: null } as Response;
        }
        if (request.method === "thread/list") {
          return {
            data: [],
            nextCursor: null,
          } as Response;
        }
        if (request.method === "thread/resume") {
          throw new Error("Stored Codex history must be read without resuming the thread.");
        }
        if (request.method === "thread/read") {
          return {
            thread: {
              id: "thread-unloaded",
              cwd: "/repo",
              status: { type: "idle" },
              turns: [
                {
                  id: "turn-1",
                  status: "completed",
                  items: [
                    {
                      id: "msg-1",
                      type: "agentMessage",
                      phase: "final_answer",
                      text: "Partial from thread/read",
                    },
                  ],
                },
              ],
            },
          } as Response;
        }
        if (request.method === "thread/turns/list") {
          return {
            data: [
              {
                id: "turn-1",
                status: "completed",
                items: [
                  {
                    id: "msg-1",
                    type: "agentMessage",
                    phase: "final_answer",
                    text: "Hydrated from paginated history",
                  },
                ],
              },
            ],
            nextCursor: null,
          } as Response;
        }
        throw new Error(`Unexpected method '${request.method}'.`);
      },
    };
    const adapter = createAdapterWithTransport(transport);

    const history = await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-unloaded",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });

    expect(history).toContainEqual(
      expect.objectContaining({
        messageId: "msg-1",
        role: "assistant",
        text: "Hydrated from paginated history",
      }),
    );
    expect(calls.map((call) => call.method).slice(0, 2)).toEqual([
      "thread/read",
      "thread/turns/list",
    ]);
    expect(calls.some((call) => call.method === "thread/resume")).toBe(false);
  });

  test("loads documented thread-read tool item shapes", async () => {
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-contract"], nextCursor: null } as Response;
        }
        if (request.method === "thread/list") {
          return {
            data: [
              { id: "thread-contract", cwd: "/repo", createdAt: 1, status: { type: "active" } },
            ],
            nextCursor: null,
          } as Response;
        }
        if (request.method === "thread/turns/list") {
          return { data: [], nextCursor: null } as Response;
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        const includeTurns = (request.params as { includeTurns?: boolean }).includeTurns;
        if (includeTurns === false) {
          return { thread: { id: "thread-contract", cwd: "/repo", createdAt: 1 } } as Response;
        }
        return {
          thread: {
            id: "thread-contract",
            cwd: "/repo",
            turns: [
              {
                id: "turn-1",
                status: "completed",
                startedAt: 1,
                completedAt: 2,
                items: [
                  {
                    id: "cmd-array",
                    type: "commandExecution",
                    command: ["bun", "test"],
                    cwd: "/repo",
                    status: "completed",
                    aggregatedOutput: "70 pass",
                  },
                  {
                    id: "mcp-json-args",
                    type: "mcpToolCall",
                    server: "openducktor",
                    tool: "odt_read_task",
                    status: "completed",
                    arguments: JSON.stringify({ taskId: "task-1" }),
                    result: { content: [{ type: "text", text: "task ok" }] },
                  },
                  {
                    id: "dynamic-json-args",
                    type: "dynamicToolCall",
                    namespace: "functions",
                    tool: "request_user_input",
                    status: "completed",
                    success: true,
                    arguments: JSON.stringify({
                      requestId: "q1",
                      questions: [{ question: "Choose mode" }],
                    }),
                    contentItems: [{ type: "inputText", text: "selected" }],
                  },
                  {
                    id: "final-content-array",
                    type: "agentMessage",
                    phase: "final_answer",
                    content: [{ type: "output_text", text: "Final from content" }],
                  },
                ],
              },
            ],
          },
        } as Response;
      },
    };
    const adapter = createAdapterWithTransport(transport);

    const history = await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-contract",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });

    expect(history).toHaveLength(4);
    expect(history[0]).toEqual(
      expect.objectContaining({
        messageId: "cmd-array",
        parts: [
          expect.objectContaining({
            kind: "tool",
            tool: "bash",
            toolType: "bash",
            input: { command: "bun test", cwd: "/repo" },
            output: "70 pass",
          }),
        ],
      }),
    );
    expect(history[1]).toEqual(
      expect.objectContaining({
        messageId: "mcp-json-args",
        parts: [
          expect.objectContaining({
            kind: "tool",
            tool: "odt_read_task",
            toolType: "workflow",
            input: { taskId: "task-1" },
            output: "task ok",
          }),
        ],
      }),
    );
    expect(history[2]).toEqual(
      expect.objectContaining({
        messageId: "dynamic-json-args",
        parts: [
          expect.objectContaining({
            kind: "tool",
            tool: "request_user_input",
            input: { requestId: "q1", questions: [{ question: "Choose mode" }] },
            output: "selected",
          }),
        ],
      }),
    );
    expect(history[3]).toEqual(
      expect.objectContaining({
        messageId: "final-content-array",
        text: "Final from content",
        durationMs: 1000,
        parts: [expect.objectContaining({ kind: "step", phase: "finish", reason: "stop" })],
      }),
    );
  });

  test("loads command action read find and bash tools from thread reads", async () => {
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-command-actions"], nextCursor: null } as Response;
        }
        if (request.method === "thread/list") {
          return {
            data: [
              {
                id: "thread-command-actions",
                cwd: "/repo",
                createdAt: 1,
                status: { type: "active" },
              },
            ],
            nextCursor: null,
          } as Response;
        }
        if (request.method === "thread/turns/list") {
          return { data: [], nextCursor: null } as Response;
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        const includeTurns = (request.params as { includeTurns?: boolean }).includeTurns;
        if (includeTurns === false) {
          return {
            thread: { id: "thread-command-actions", cwd: "/repo", createdAt: 1 },
          } as Response;
        }
        return {
          thread: {
            id: "thread-command-actions",
            cwd: "/repo",
            turns: [
              {
                id: "turn-1",
                status: "completed",
                startedAt: 1,
                completedAt: 4,
                durationMs: 3000,
                items: [
                  {
                    id: "cmd-read-action",
                    type: "commandExecution",
                    command: ["cat", "src/app.ts"],
                    cwd: "/repo",
                    status: "completed",
                    commandActions: [{ type: "Read", path: "src/app.ts" }],
                    aggregatedOutput: "const app = true;",
                  },
                  {
                    id: "cmd-find-action",
                    type: "commandExecution",
                    command: "find src -name '*.ts'",
                    cwd: "/repo",
                    status: "completed",
                    command_actions: [{ kind: "find", path: "src", pattern: "*.ts" }],
                    aggregated_output: "src/app.ts",
                  },
                  {
                    id: "cmd-bash-action",
                    type: "commandExecution",
                    command: "bun test",
                    cwd: "/repo",
                    status: "completed",
                    commandActions: [{ type: "exec", command: "bun test" }],
                    aggregatedOutput: "1 pass",
                  },
                  {
                    id: "final-action-turn",
                    type: "agentMessage",
                    phase: "final_answer",
                    text: "Done",
                  },
                ],
              },
            ],
          },
        } as Response;
      },
    };
    const adapter = createAdapterWithTransport(transport);

    const history = await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-command-actions",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });

    expect(history).toContainEqual(
      expect.objectContaining({
        messageId: "cmd-read-action",
        parts: [
          expect.objectContaining({
            kind: "tool",
            tool: "read",
            toolType: "read",
            preview: "src/app.ts",
            input: expect.objectContaining({ path: "src/app.ts" }),
            output: "const app = true;",
          }),
        ],
      }),
    );
    expect(history).toContainEqual(
      expect.objectContaining({
        messageId: "cmd-find-action",
        parts: [
          expect.objectContaining({
            kind: "tool",
            tool: "find",
            input: expect.objectContaining({ path: "src", pattern: "*.ts" }),
            output: "src/app.ts",
          }),
        ],
      }),
    );
    expect(history).toContainEqual(
      expect.objectContaining({
        messageId: "cmd-bash-action",
        parts: [
          expect.objectContaining({
            kind: "tool",
            tool: "bash",
            toolType: "bash",
            preview: "bun test",
            input: expect.objectContaining({ command: "bun test" }),
            output: "1 pass",
          }),
        ],
      }),
    );
    expect(history).toContainEqual(
      expect.objectContaining({
        messageId: "final-action-turn",
        durationMs: 3000,
        parts: [expect.objectContaining({ kind: "step", phase: "finish", reason: "stop" })],
      }),
    );
  });

  test("returns empty history when Codex has no stored thread", async () => {
    const calls: CodexJsonRpcRequest[] = [];
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        calls.push(request);
        if (request.method === "thread/loaded/list") {
          return { data: [], nextCursor: null } as Response;
        }
        if (request.method === "thread/list") {
          return { data: [], nextCursor: null } as Response;
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        throw new Error("thread not loaded: missing-thread");
      },
    };
    const adapter = createAdapterWithTransport(transport);

    await expect(
      adapter.loadSessionHistory({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "missing-thread",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      }),
    ).resolves.toEqual([]);

    expect(calls).toEqual([
      { method: "thread/read", params: { threadId: "missing-thread", includeTurns: true } },
    ]);
  });

  test("loads Codex session todos from thread-read update_plan tool calls", async () => {
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-todos"], nextCursor: null } as Response;
        }
        if (request.method === "thread/list") {
          return {
            data: [{ id: "thread-todos", cwd: "/repo", createdAt: 1, status: { type: "active" } }],
            nextCursor: null,
          } as Response;
        }
        if (request.method === "thread/turns/list") {
          return { data: [], nextCursor: null } as Response;
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        const includeTurns = (request.params as { includeTurns?: boolean }).includeTurns;
        if (includeTurns === false) {
          return { thread: { id: "thread-todos", cwd: "/repo", createdAt: 1 } } as Response;
        }
        return {
          thread: {
            id: "thread-todos",
            cwd: "/repo",
            turns: [
              {
                id: "turn-1",
                status: "completed",
                items: [
                  {
                    id: "todo-call-1",
                    type: "dynamicToolCall",
                    namespace: "functions",
                    tool: "update_plan",
                    arguments: {
                      plan: [
                        { step: "Inspect docs", status: "completed" },
                        { step: "Wire todos", status: "inProgress" },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        } as Response;
      },
    };
    const adapter = createAdapterWithTransport(transport);

    await expect(
      adapter.loadSessionTodos({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-todos",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      }),
    ).resolves.toEqual([
      expect.objectContaining({ content: "Inspect docs", status: "completed" }),
      expect.objectContaining({ content: "Wire todos", status: "in_progress" }),
    ]);
  });

  test("reuses todos discovered while loading Codex session history", async () => {
    const calls: CodexJsonRpcRequest[] = [];
    const completedAtMs = Date.parse("2026-05-20T10:00:02.000Z");
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        calls.push(request);
        if (request.method === "thread/loaded/list") {
          return { data: [], nextCursor: null } as Response;
        }
        if (request.method === "thread/list") {
          return {
            data: [
              {
                id: "thread-history-todos",
                cwd: "/repo",
                createdAt: 1,
                status: { type: "active", activeFlags: [] },
              },
            ],
            nextCursor: null,
          } as Response;
        }
        if (request.method === "thread/read") {
          return {
            thread: {
              id: "thread-history-todos",
              cwd: "/repo",
              createdAt: 1,
              status: { type: "idle" },
              turns: [
                {
                  id: "turn-1",
                  status: "completed",
                  items: [
                    {
                      id: "todo-call-1",
                      type: "dynamicToolCall",
                      namespace: "functions",
                      tool: "update_plan",
                      arguments: {
                        plan: [
                          { step: "Load transcript once", status: "completed" },
                          { step: "Reuse todos", status: "inProgress" },
                        ],
                      },
                      durationMs: 25,
                      completedAtMs,
                    },
                  ],
                },
              ],
            },
          } as Response;
        }
        if (request.method === "thread/turns/list") {
          return { data: [], nextCursor: null } as Response;
        }
        throw new Error(`Unexpected method '${request.method}'.`);
      },
    };
    const adapter = createAdapterWithTransport(transport);

    const history = await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-history-todos",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });

    expect(history).toContainEqual(
      expect.objectContaining({
        messageId: "todo-call-1",
        parts: [
          expect.objectContaining({
            kind: "tool",
            startedAtMs: completedAtMs - 25,
            endedAtMs: completedAtMs,
          }),
        ],
      }),
    );
    expect(calls.filter((call) => call.method === "thread/read")).toHaveLength(1);
    expect(calls.some((call) => call.method === "thread/resume")).toBe(false);
    calls.length = 0;

    await expect(
      adapter.loadSessionTodos({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-history-todos",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      }),
    ).resolves.toEqual([
      expect.objectContaining({ content: "Load transcript once", status: "completed" }),
      expect.objectContaining({ content: "Reuse todos", status: "in_progress" }),
    ]);
    expect(calls).toEqual([]);
  });

  test("rejects Codex todo policy mismatches before returning cached todos", async () => {
    const calls: CodexJsonRpcRequest[] = [];
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        calls.push(request);
        if (request.method === "thread/loaded/list") {
          return { data: [], nextCursor: null } as Response;
        }
        if (request.method === "thread/list") {
          return {
            data: [
              {
                id: "thread-history-todos",
                cwd: "/repo",
                createdAt: 1,
                status: { type: "active", activeFlags: [] },
              },
            ],
            nextCursor: null,
          } as Response;
        }
        if (request.method === "thread/read") {
          return {
            thread: {
              id: "thread-history-todos",
              cwd: "/repo",
              createdAt: 1,
              status: { type: "idle" },
              turns: [
                {
                  id: "turn-1",
                  status: "completed",
                  items: [
                    {
                      id: "todo-call-1",
                      type: "dynamicToolCall",
                      namespace: "functions",
                      tool: "update_plan",
                      arguments: { plan: [{ step: "Cached todo", status: "completed" }] },
                    },
                  ],
                },
              ],
            },
          } as Response;
        }
        if (request.method === "thread/turns/list") {
          return { data: [], nextCursor: null } as Response;
        }
        throw new Error(`Unexpected method '${request.method}'.`);
      },
    };
    const adapter = createAdapterWithTransport(transport);

    await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-history-todos",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });
    calls.length = 0;

    await expect(
      adapter.loadSessionTodos({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-history-todos",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy: { kind: "opencode" },
      } as never),
    ).rejects.toThrow(
      "Cannot load Codex session todos with runtime 'codex' and 'opencode' runtime policy.",
    );
    expect(calls).toEqual([]);
  });

  test("reuses empty todos discovered while loading Codex session history", async () => {
    const calls: CodexJsonRpcRequest[] = [];
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        calls.push(request);
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-empty-todos"], nextCursor: null } as Response;
        }
        if (request.method === "thread/list") {
          return {
            data: [
              {
                id: "thread-empty-todos",
                cwd: "/repo",
                createdAt: 1,
                status: { type: "idle" },
              },
            ],
            nextCursor: null,
          } as Response;
        }
        if (request.method === "thread/resume") {
          return {
            thread: {
              id: "thread-empty-todos",
              cwd: "/repo",
              createdAt: 1,
              status: { type: "idle" },
              turns: [],
            },
          } as Response;
        }
        if (request.method === "thread/turns/list") {
          return { data: [], nextCursor: null } as Response;
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        return {
          thread: {
            id: "thread-empty-todos",
            cwd: "/repo",
            turns: [
              {
                id: "turn-1",
                status: "completed",
                items: [],
              },
            ],
          },
        } as Response;
      },
    };
    const adapter = createAdapterWithTransport(transport);

    await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-empty-todos",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });
    calls.length = 0;

    await expect(
      adapter.loadSessionTodos({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-empty-todos",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      }),
    ).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });

  test("loads only the selected final Codex agent message as finished", async () => {
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        if (request.method === "thread/loaded/list") {
          return { data: [], nextCursor: null } as Response;
        }
        if (request.method === "thread/list") {
          return {
            data: [
              {
                id: "thread-final-message",
                cwd: "/repo",
                createdAt: 1,
                status: { type: "active" },
              },
            ],
            nextCursor: null,
          } as Response;
        }
        if (request.method === "thread/turns/list") {
          return { data: [], nextCursor: null } as Response;
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        const includeTurns = (request.params as { includeTurns?: boolean }).includeTurns;
        if (includeTurns === false) {
          return { thread: { id: "thread-final-message", cwd: "/repo", createdAt: 1 } } as Response;
        }
        return {
          thread: {
            id: "thread-final-message",
            cwd: "/repo",
            turns: [
              {
                id: "turn-1",
                status: "completed",
                startedAt: 1,
                completedAt: 2,
                items: [
                  { type: "agentMessage", phase: "commentary", text: "Working" },
                  { type: "agentMessage", phase: "final_answer", text: "Final answer" },
                ],
              },
            ],
          },
        } as Response;
      },
    };
    const adapter = createAdapterWithTransport(transport);

    const history = await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-final-message",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });

    expect(history).toEqual([
      expect.objectContaining({ text: "Working", parts: [] }),
      expect.objectContaining({
        text: "Final answer",
        parts: [expect.objectContaining({ kind: "step", phase: "finish" })],
      }),
    ]);
  });

  test("loads Codex session todos from thread-read plan items", async () => {
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-plan-todos"], nextCursor: null } as Response;
        }
        if (request.method === "thread/list") {
          return {
            data: [
              { id: "thread-plan-todos", cwd: "/repo", createdAt: 1, status: { type: "active" } },
            ],
            nextCursor: null,
          } as Response;
        }
        if (request.method === "thread/turns/list") {
          return { data: [], nextCursor: null } as Response;
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        const includeTurns = (request.params as { includeTurns?: boolean }).includeTurns;
        if (includeTurns === false) {
          return { thread: { id: "thread-plan-todos", cwd: "/repo", createdAt: 1 } } as Response;
        }
        return {
          thread: {
            id: "thread-plan-todos",
            cwd: "/repo",
            turns: [
              {
                id: "turn-1",
                status: "completed",
                items: [
                  {
                    id: "plan-1",
                    type: "plan",
                    plan: [
                      { step: "Inspect", status: "completed" },
                      { step: "Fix hydration", status: "in_progress" },
                    ],
                  },
                ],
              },
            ],
          },
        } as Response;
      },
    };
    const adapter = createAdapterWithTransport(transport);

    await expect(
      adapter.loadSessionTodos({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-plan-todos",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      }),
    ).resolves.toEqual([
      expect.objectContaining({ content: "Inspect", status: "completed" }),
      expect.objectContaining({ content: "Fix hydration", status: "in_progress" }),
    ]);
  });

  test("loads Codex session todos from thread-read plan text checklists", async () => {
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-plan-text-todos"], nextCursor: null } as Response;
        }
        if (request.method === "thread/list") {
          return {
            data: [
              {
                id: "thread-plan-text-todos",
                cwd: "/repo",
                createdAt: 1,
                status: { type: "idle" },
              },
            ],
            nextCursor: null,
          } as Response;
        }
        if (request.method === "thread/turns/list") {
          return { data: [], nextCursor: null } as Response;
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        const includeTurns = (request.params as { includeTurns?: boolean }).includeTurns;
        if (includeTurns === false) {
          return {
            thread: { id: "thread-plan-text-todos", cwd: "/repo", createdAt: 1 },
          } as Response;
        }
        return {
          thread: {
            id: "thread-plan-text-todos",
            cwd: "/repo",
            turns: [
              {
                id: "turn-1",
                status: "completed",
                items: [
                  {
                    id: "plan-text-1",
                    type: "plan",
                    text: [
                      "- [x] First item",
                      "- [ ] Second item",
                      "- in progress: Third item",
                      "- pending: Fourth item",
                      "- pending: Fifth item",
                    ].join("\n"),
                  },
                ],
              },
            ],
          },
        } as Response;
      },
    };
    const adapter = createAdapterWithTransport(transport);

    await expect(
      adapter.loadSessionTodos({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-plan-text-todos",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      }),
    ).resolves.toEqual([
      expect.objectContaining({ content: "First item", status: "completed" }),
      expect.objectContaining({ content: "Second item", status: "pending" }),
      expect.objectContaining({ content: "Third item", status: "in_progress" }),
      expect.objectContaining({ content: "Fourth item", status: "pending" }),
      expect.objectContaining({ content: "Fifth item", status: "pending" }),
    ]);
  });

  test("loads Codex session todos from thread-read named todo tool inputs", async () => {
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-named-todos"], nextCursor: null } as Response;
        }
        if (request.method === "thread/list") {
          return {
            data: [
              { id: "thread-named-todos", cwd: "/repo", createdAt: 1, status: { type: "active" } },
            ],
            nextCursor: null,
          } as Response;
        }
        if (request.method === "thread/turns/list") {
          return { data: [], nextCursor: null } as Response;
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        const includeTurns = (request.params as { includeTurns?: boolean }).includeTurns;
        if (includeTurns === false) {
          return { thread: { id: "thread-named-todos", cwd: "/repo", createdAt: 1 } } as Response;
        }
        return {
          thread: {
            id: "thread-named-todos",
            cwd: "/repo",
            turns: [
              {
                id: "turn-1",
                status: "completed",
                items: [
                  {
                    id: "todo-call-1",
                    type: "dynamicToolCall",
                    namespace: "functions",
                    name: "update_plan",
                    input: JSON.stringify({
                      plan: [
                        { step: "Inspect", status: "completed" },
                        { step: "Fix latest todo", status: "in_progress" },
                      ],
                    }),
                  },
                ],
              },
            ],
          },
        } as Response;
      },
    };
    const adapter = createAdapterWithTransport(transport);

    await expect(
      adapter.loadSessionTodos({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-named-todos",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      }),
    ).resolves.toEqual([
      expect.objectContaining({ content: "Inspect", status: "completed" }),
      expect.objectContaining({ content: "Fix latest todo", status: "in_progress" }),
    ]);
  });

  test("loads Codex session todos from thread-read JSON arguments", async () => {
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-json-todos"], nextCursor: null } as Response;
        }
        if (request.method === "thread/list") {
          return {
            data: [
              { id: "thread-json-todos", cwd: "/repo", createdAt: 1, status: { type: "active" } },
            ],
            nextCursor: null,
          } as Response;
        }
        if (request.method === "thread/turns/list") {
          return { data: [], nextCursor: null } as Response;
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        const includeTurns = (request.params as { includeTurns?: boolean }).includeTurns;
        if (includeTurns === false) {
          return { thread: { id: "thread-json-todos", cwd: "/repo", createdAt: 1 } } as Response;
        }
        return {
          thread: {
            id: "thread-json-todos",
            cwd: "/repo",
            turns: [
              {
                id: "turn-1",
                status: "completed",
                items: [
                  {
                    id: "todo-call-1",
                    type: "dynamicToolCall",
                    namespace: "functions",
                    tool: "update_plan",
                    status: "completed",
                    success: true,
                    arguments: JSON.stringify({
                      plan: [
                        { step: "Map thread/read", status: "completed" },
                        { step: "Hydrate todos", status: "in_progress" },
                      ],
                    }),
                  },
                ],
              },
            ],
          },
        } as Response;
      },
    };
    const adapter = createAdapterWithTransport(transport);

    await expect(
      adapter.loadSessionTodos({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-json-todos",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      }),
    ).resolves.toEqual([
      expect.objectContaining({ content: "Map thread/read", status: "completed" }),
      expect.objectContaining({ content: "Hydrate todos", status: "in_progress" }),
    ]);
  });

  test("ignores failed or incomplete Codex thread-read todo tool calls", async () => {
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-bad-todos"], nextCursor: null } as Response;
        }
        if (request.method === "thread/list") {
          return {
            data: [
              { id: "thread-bad-todos", cwd: "/repo", createdAt: 1, status: { type: "active" } },
            ],
            nextCursor: null,
          } as Response;
        }
        if (request.method === "thread/turns/list") {
          return { data: [], nextCursor: null } as Response;
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        const includeTurns = (request.params as { includeTurns?: boolean }).includeTurns;
        if (includeTurns === false) {
          return { thread: { id: "thread-bad-todos", cwd: "/repo", createdAt: 1 } } as Response;
        }
        return {
          thread: {
            id: "thread-bad-todos",
            cwd: "/repo",
            turns: [
              {
                id: "turn-1",
                status: "completed",
                items: [
                  {
                    id: "todo-call-running",
                    type: "dynamicToolCall",
                    namespace: "functions",
                    tool: "update_plan",
                    status: "running",
                    arguments: { plan: [{ step: "Do not show", status: "in_progress" }] },
                  },
                  {
                    id: "todo-call-failed",
                    type: "dynamicToolCall",
                    namespace: "functions",
                    tool: "todo_write",
                    status: "completed",
                    success: false,
                    arguments: { todo: [{ step: "Also hidden", status: "pending" }] },
                  },
                ],
              },
            ],
          },
        } as Response;
      },
    };
    const adapter = createAdapterWithTransport(transport);

    await expect(
      adapter.loadSessionTodos({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-bad-todos",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      }),
    ).resolves.toEqual([]);
  });
});
