import { describe, expect, test } from "bun:test";
import {
  createAdapterWithTransport,
  createHarness,
  defaultCodexEffectivePolicy,
  flushCodexAdapterWork,
  RecordingTransport,
} from "./codex-app-server-adapter.test-harness";
import type { CodexJsonRpcRequest, CodexJsonRpcTransport } from "./index";

describe("CodexAppServerAdapter history loading", () => {
  test("keeps a hydrated subagent at its exact thread item position", async () => {
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        if (request.method === "thread/read") {
          return {
            thread: {
              id: "parent-thread",
              cwd: "/repo",
              createdAt: 1_783_715_500,
              status: { type: "idle" },
              turns: [
                {
                  id: "parent-turn",
                  startedAt: 1_783_715_500,
                  completedAt: 1_783_715_620,
                  status: "completed",
                  items: [
                    {
                      id: "parent-user",
                      type: "userMessage",
                      content: [{ type: "text", text: "Delegate this work" }],
                    },
                    {
                      id: "parent-delegating",
                      type: "agentMessage",
                      phase: "commentary",
                      text: "I am delegating this now.",
                    },
                    {
                      id: "parent-spawn",
                      type: "collabToolCall",
                      tool: "spawnAgent",
                      status: "completed",
                      senderThreadId: "parent-thread",
                      receiverThreadIds: ["child-thread"],
                      prompt: "Inspect the repository",
                      agentsStates: {
                        "child-thread": { status: "completed", message: "Done" },
                      },
                    },
                    {
                      id: "parent-waiting",
                      type: "agentMessage",
                      phase: "commentary",
                      text: "The subagent is running.",
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
      externalSessionId: "parent-thread",
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });

    expect(history.map((message) => message.messageId)).toEqual([
      "parent-user",
      "parent-delegating",
      "codex-subagent:parent-thread:parent-spawn",
      "parent-waiting",
    ]);
  });

  test("keeps inherited and child-owned subagent activity with their fork owners", async () => {
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        if (request.method === "thread/read") {
          return {
            thread: {
              id: "child-thread",
              cwd: "/repo",
              createdAt: 10,
              status: { type: "idle" },
              forkedFromId: "root-thread",
              parentThreadId: "root-thread",
              turns: [
                {
                  id: "root-turn",
                  startedAt: 5,
                  status: "completed",
                  items: [
                    {
                      id: "root-started-sibling",
                      type: "subAgentActivity",
                      agentThreadId: "sibling-thread",
                      kind: "started",
                    },
                  ],
                },
                {
                  id: "child-turn",
                  startedAt: 11,
                  status: "completed",
                  items: [
                    {
                      id: "child-started-grandchild",
                      type: "subAgentActivity",
                      agentThreadId: "grandchild-thread",
                      kind: "started",
                    },
                  ],
                },
              ],
            },
          } as Response;
        }
        if (request.method === "thread/turns/list") {
          const { threadId } = request.params as { threadId: string };
          if (threadId === "root-thread") {
            return { data: [{ id: "root-turn" }], nextCursor: null } as Response;
          }
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
    const subagentParts = history.flatMap((message) =>
      message.parts.filter((part) => part.kind === "subagent"),
    );

    expect(subagentParts).toEqual([
      expect.objectContaining({
        correlationKey: "codex-subagent:root-thread:sibling-thread",
        externalSessionId: "sibling-thread",
      }),
      expect.objectContaining({
        correlationKey: "codex-subagent:child-thread:grandchild-thread",
        externalSessionId: "grandchild-thread",
      }),
    ]);
    expect(subagentParts).not.toContainEqual(
      expect.objectContaining({
        correlationKey: "codex-subagent:child-thread:sibling-thread",
      }),
    );
  });

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

  test("loads child history when its fork parent is no longer readable", async () => {
    let parentReadError = "thread not loaded: missing-parent";
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        if (request.method === "thread/read") {
          return {
            thread: {
              id: "child-thread",
              cwd: "/repo",
              createdAt: 1,
              status: { type: "idle" },
              forkedFromId: "missing-parent",
              parentThreadId: "missing-parent",
              turns: [
                {
                  id: "child-turn",
                  startedAt: 2,
                  status: "completed",
                  items: [{ id: "child-answer", type: "agentMessage", text: "Child result" }],
                },
              ],
            },
          } as Response;
        }
        if (request.method === "thread/turns/list") {
          const params = request.params as { threadId: string };
          if (params.threadId === "missing-parent") {
            throw new Error(parentReadError);
          }
          return {
            data: [
              {
                id: "child-turn",
                startedAt: 2,
                status: "completed",
                items: [{ id: "child-answer", type: "agentMessage", text: "Child result" }],
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
      externalSessionId: "child-thread",
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });

    expect(history.map((message) => message.messageId)).toEqual(["child-answer"]);

    parentReadError = "parent turn lookup failed";
    await expect(
      adapter.loadSessionHistory({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "child-thread",
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      }),
    ).rejects.toThrow("parent turn lookup failed");
  });

  test("rejects forked history with inherited turns when its parent is no longer readable", async () => {
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        if (request.method === "thread/read") {
          return {
            thread: {
              id: "child-thread",
              cwd: "/repo",
              createdAt: 10,
              status: { type: "idle" },
              forkedFromId: "missing-parent",
              parentThreadId: "missing-parent",
              turns: [
                {
                  id: "inherited-turn",
                  startedAt: 5,
                  status: "completed",
                  items: [{ id: "parent-answer", type: "agentMessage", text: "Parent result" }],
                },
                {
                  id: "child-turn",
                  startedAt: 11,
                  status: "completed",
                  items: [{ id: "child-answer", type: "agentMessage", text: "Child result" }],
                },
              ],
            },
          } as Response;
        }
        if (request.method === "thread/turns/list") {
          const params = request.params as { threadId: string };
          if (params.threadId === "missing-parent") {
            throw new Error("thread not loaded: missing-parent");
          }
          return {
            data: [
              { id: "inherited-turn", startedAt: 5, status: "completed", items: [] },
              { id: "child-turn", startedAt: 11, status: "completed", items: [] },
            ],
            nextCursor: null,
          } as Response;
        }
        throw new Error(`Unexpected method '${request.method}'.`);
      },
    };
    const adapter = createAdapterWithTransport(transport);

    await expect(
      adapter.loadSessionHistory({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "child-thread",
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      }),
    ).rejects.toThrow("thread not loaded: missing-parent");
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

  test("keeps the runtime-owned system prompt before the local thread is materialized", async () => {
    const baseTransport = new RecordingTransport("runtime-live", false);
    const transport: CodexJsonRpcTransport = {
      request: async <Response>(request: CodexJsonRpcRequest): Promise<Response> => {
        if (request.method === "thread/read") {
          throw new Error(
            "thread is not materialized yet: includeTurns is unavailable before first user message",
          );
        }
        return baseTransport.request<Response>(request);
      },
    };
    const adapter = createAdapterWithTransport(transport);

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

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
    ]);
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

  test("does not request context while reading unloaded idle history", async () => {
    const calls: CodexJsonRpcRequest[] = [];
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
        throw new Error(`Unexpected method '${request.method}'.`);
      },
    };
    const adapter = createAdapterWithTransport(transport);

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
    expect(methods).toContain("thread/read");
    expect(methods).not.toContain("thread/resume");
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

  test("loads todos independently after loading Codex session history", async () => {
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
    expect(calls.filter((call) => call.method === "thread/read")).toHaveLength(2);
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

  test("loads empty todos independently after loading Codex session history", async () => {
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
    expect(calls.some((call) => call.method === "thread/read")).toBe(true);
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
