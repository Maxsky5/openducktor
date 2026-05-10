import { describe, expect, test } from "bun:test";
import { createHarness, makeRuntimeSummary } from "./codex-app-server-adapter.test-harness";
import {
  CodexAppServerAdapter,
  type CodexJsonRpcRequest,
  type CodexJsonRpcTransport,
} from "./index";

describe("CodexAppServerAdapter history hydration", () => {
  test("hydrates Codex history and diff from App Server reads", async () => {
    const { adapter, transports } = createHarness();

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    const history = await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread/start-runtime-ensure",
    });

    expect(history).toEqual([
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
            input: expect.objectContaining({ patch: expect.stringContaining("@@") }),
            output: expect.stringContaining("@@"),
            metadata: expect.objectContaining({
              changes: expect.arrayContaining([
                expect.objectContaining({ path: "/repo/src/app.ts" }),
              ]),
            }),
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
            tool: "websearch",
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
            status: "error",
            error: "task missing",
            output: expect.stringContaining("task missing"),
          }),
        ],
      }),
      expect.objectContaining({
        messageId: "msg-1",
        role: "assistant",
        timestamp: "2026-05-07T00:00:31.000Z",
        text: "Hello from history",
        parts: [expect.objectContaining({ kind: "step", phase: "finish", reason: "stop" })],
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
      transports.get("runtime-ensure")?.calls.some((call) => call.method === "thread/turns/list"),
    ).toBe(true);
    await expect(
      adapter.loadSessionDiff({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread/start-runtime-ensure",
      }),
    ).resolves.toEqual([
      { file: "src/app.ts", type: "modified", additions: 1, deletions: 0, diff: "@@" },
    ]);
  });

  test("hydrates search command metadata and hides contextual user fragments from thread reads", async () => {
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-search"], nextCursor: null } as Response;
        }
        if (request.method === "thread/list") {
          return {
            data: [{ id: "thread-search", cwd: "/repo", createdAt: 1, status: { type: "idle" } }],
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
    const adapter = new CodexAppServerAdapter({
      repoRuntimeResolver: {
        ensureRepoRuntime: async () => makeRuntimeSummary("runtime-ensure"),
        requireRepoRuntime: async () => makeRuntimeSummary("runtime-live"),
      },
      transportFactory: () => transport,
      drainServerRequests: async () => [],
      respondServerRequest: async () => {},
    });

    const history = await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-search",
    });

    expect(history).toEqual([
      expect.objectContaining({
        messageId: "search-1",
        role: "assistant",
        parts: [
          expect.objectContaining({
            kind: "tool",
            tool: "search",
            preview: "foo in src",
            input: expect.objectContaining({ query: "foo", path: "src" }),
            output: "src/app.ts:foo",
          }),
        ],
      }),
    ]);
  });

  test("hydrates documented thread-read tool item shapes", async () => {
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-contract"], nextCursor: null } as Response;
        }
        if (request.method === "thread/list") {
          return {
            data: [{ id: "thread-contract", cwd: "/repo", createdAt: 1, status: { type: "idle" } }],
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
    const adapter = new CodexAppServerAdapter({
      repoRuntimeResolver: {
        ensureRepoRuntime: async () => makeRuntimeSummary("runtime-ensure"),
        requireRepoRuntime: async () => makeRuntimeSummary("runtime-live"),
      },
      transportFactory: () => transport,
      drainServerRequests: async () => [],
      respondServerRequest: async () => {},
    });

    const history = await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-contract",
    });

    expect(history).toHaveLength(4);
    expect(history[0]).toEqual(
      expect.objectContaining({
        messageId: "cmd-array",
        parts: [
          expect.objectContaining({
            kind: "tool",
            tool: "bash",
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

  test("hydrates command action read find and bash tools from thread reads", async () => {
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
    const adapter = new CodexAppServerAdapter({
      repoRuntimeResolver: {
        ensureRepoRuntime: async () => makeRuntimeSummary("runtime-ensure"),
        requireRepoRuntime: async () => makeRuntimeSummary("runtime-live"),
      },
      transportFactory: () => transport,
      drainServerRequests: async () => [],
      respondServerRequest: async () => {},
    });

    const history = await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-command-actions",
    });

    expect(history).toContainEqual(
      expect.objectContaining({
        messageId: "cmd-read-action",
        parts: [
          expect.objectContaining({
            kind: "tool",
            tool: "read",
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

  test("returns empty history without loading an absent Codex thread", async () => {
    const calls: CodexJsonRpcRequest[] = [];
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        calls.push(request);
        if (request.method === "thread/loaded/list") {
          return { data: [], nextCursor: null } as Response;
        }
        if (request.method !== "thread/list") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        return {
          data: [{ id: "other-thread", cwd: "/repo", createdAt: 1, status: { type: "idle" } }],
          nextCursor: null,
        } as Response;
      },
    };
    const adapter = new CodexAppServerAdapter({
      repoRuntimeResolver: {
        ensureRepoRuntime: async () => makeRuntimeSummary("runtime-ensure"),
        requireRepoRuntime: async () => makeRuntimeSummary("runtime-live"),
      },
      transportFactory: () => transport,
      drainServerRequests: async () => [],
      respondServerRequest: async () => {},
    });

    await expect(
      adapter.loadSessionHistory({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "missing-thread",
      }),
    ).resolves.toEqual([]);

    expect(calls).toEqual([
      { method: "thread/loaded/list", params: { cursor: null, limit: 100 } },
      { method: "thread/list", params: { cursor: null, limit: 100 } },
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
            data: [{ id: "thread-todos", cwd: "/repo", createdAt: 1, status: { type: "idle" } }],
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
    const adapter = new CodexAppServerAdapter({
      repoRuntimeResolver: {
        ensureRepoRuntime: async () => makeRuntimeSummary("runtime-ensure"),
        requireRepoRuntime: async () => makeRuntimeSummary("runtime-live"),
      },
      transportFactory: () => transport,
      drainServerRequests: async () => [],
      respondServerRequest: async () => {},
    });

    await expect(
      adapter.loadSessionTodos({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-todos",
      }),
    ).resolves.toEqual([
      expect.objectContaining({ content: "Inspect docs", status: "completed" }),
      expect.objectContaining({ content: "Wire todos", status: "in_progress" }),
    ]);
  });

  test("hydrates only the selected final Codex agent message as finished", async () => {
    const transport: CodexJsonRpcTransport = {
      async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-final-message"], nextCursor: null } as Response;
        }
        if (request.method === "thread/list") {
          return {
            data: [
              { id: "thread-final-message", cwd: "/repo", createdAt: 1, status: { type: "idle" } },
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
    const adapter = new CodexAppServerAdapter({
      repoRuntimeResolver: {
        ensureRepoRuntime: async () => makeRuntimeSummary("runtime-ensure"),
        requireRepoRuntime: async () => makeRuntimeSummary("runtime-live"),
      },
      transportFactory: () => transport,
      drainServerRequests: async () => [],
      respondServerRequest: async () => {},
    });

    const history = await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-final-message",
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
              { id: "thread-plan-todos", cwd: "/repo", createdAt: 1, status: { type: "idle" } },
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
    const adapter = new CodexAppServerAdapter({
      repoRuntimeResolver: {
        ensureRepoRuntime: async () => makeRuntimeSummary("runtime-ensure"),
        requireRepoRuntime: async () => makeRuntimeSummary("runtime-live"),
      },
      transportFactory: () => transport,
      drainServerRequests: async () => [],
      respondServerRequest: async () => {},
    });

    await expect(
      adapter.loadSessionTodos({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-plan-todos",
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
    const adapter = new CodexAppServerAdapter({
      repoRuntimeResolver: {
        ensureRepoRuntime: async () => makeRuntimeSummary("runtime-ensure"),
        requireRepoRuntime: async () => makeRuntimeSummary("runtime-live"),
      },
      transportFactory: () => transport,
      drainServerRequests: async () => [],
      respondServerRequest: async () => {},
    });

    await expect(
      adapter.loadSessionTodos({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-plan-text-todos",
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
              { id: "thread-named-todos", cwd: "/repo", createdAt: 1, status: { type: "idle" } },
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
    const adapter = new CodexAppServerAdapter({
      repoRuntimeResolver: {
        ensureRepoRuntime: async () => makeRuntimeSummary("runtime-ensure"),
        requireRepoRuntime: async () => makeRuntimeSummary("runtime-live"),
      },
      transportFactory: () => transport,
      drainServerRequests: async () => [],
      respondServerRequest: async () => {},
    });

    await expect(
      adapter.loadSessionTodos({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-named-todos",
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
              { id: "thread-json-todos", cwd: "/repo", createdAt: 1, status: { type: "idle" } },
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
    const adapter = new CodexAppServerAdapter({
      repoRuntimeResolver: {
        ensureRepoRuntime: async () => makeRuntimeSummary("runtime-ensure"),
        requireRepoRuntime: async () => makeRuntimeSummary("runtime-live"),
      },
      transportFactory: () => transport,
      drainServerRequests: async () => [],
      respondServerRequest: async () => {},
    });

    await expect(
      adapter.loadSessionTodos({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-json-todos",
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
              { id: "thread-bad-todos", cwd: "/repo", createdAt: 1, status: { type: "idle" } },
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
    const adapter = new CodexAppServerAdapter({
      repoRuntimeResolver: {
        ensureRepoRuntime: async () => makeRuntimeSummary("runtime-ensure"),
        requireRepoRuntime: async () => makeRuntimeSummary("runtime-live"),
      },
      transportFactory: () => transport,
      drainServerRequests: async () => [],
      respondServerRequest: async () => {},
    });

    await expect(
      adapter.loadSessionTodos({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-bad-todos",
      }),
    ).resolves.toEqual([]);
  });
});
