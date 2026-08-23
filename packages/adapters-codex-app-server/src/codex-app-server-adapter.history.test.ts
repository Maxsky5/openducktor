import { describe, expect, test } from "bun:test";
import type { CodexAppServerThread, CodexAppServerTurn } from "@openducktor/contracts";
import {
  createAdapterWithTransport,
  codexThreadStartResultFixture,
  codexThreadFixture,
  codexTurnFixture,
  createHarness,
  defaultCodexEffectivePolicy,
  flushCodexAdapterWork,
  RecordingTransport,
} from "./codex-app-server-adapter.test-harness";
import type { CodexJsonRpcRequest, CodexJsonRpcTransport } from "./index";
import {
  codexAgentMessageItemFixture,
  codexCollabAgentToolCallFixture,
  codexCommandExecutionItemFixture,
  codexDynamicToolCallFixture,
  codexMcpToolCallItemFixture,
  codexSubAgentActivityItemFixture,
  codexUserMessageItemFixture,
} from "./test-fixtures/codex-protocol";

type PaginatedTurnFixture = Pick<CodexAppServerTurn, "id" | "items" | "status"> &
  Partial<CodexAppServerTurn>;

type PaginatedThreadFixture = Pick<CodexAppServerThread, "id"> &
  Partial<Omit<CodexAppServerThread, "turns">> & {
    turns: PaginatedTurnFixture[];
  };

type ThreadListFixture = Pick<CodexAppServerThread, "id" | "status"> &
  Partial<CodexAppServerThread>;

const paginatedThreadReadResponse = (thread: PaginatedThreadFixture) => ({
  thread: {
    ...codexThreadFixture({ id: thread.id, status: { type: "idle" } }),
    ...thread,
    turns: [],
  },
});

const paginatedTurnsListResponse = (thread: PaginatedThreadFixture) => ({
  data: thread.turns.map((turn) => codexTurnFixture(turn)),
  nextCursor: null,
  backwardsCursor: null,
});

const paginatedTurnsResponse = (turns: PaginatedTurnFixture[]) =>
  paginatedTurnsListResponse({ id: "fixture-thread", status: { type: "idle" }, turns });

const paginatedThreadListResponse = (threads: ThreadListFixture[]) => ({
  data: threads.map((thread) => {
    const activeStatus =
      thread.status.type === "active"
        ? {
            ...thread.status,
            activeFlags: thread.status.activeFlags ?? [],
          }
        : thread.status;
    return {
      ...codexThreadFixture({ id: thread.id, status: { type: "idle" } }),
      ...thread,
      status: activeStatus,
    };
  }),
  nextCursor: null,
  backwardsCursor: null,
});

describe("CodexAppServerAdapter history loading", () => {
  test("keeps a hydrated subagent at its exact thread item position", async () => {
    const thread = {
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
            codexUserMessageItemFixture({
              id: "parent-user",
              content: [{ type: "text", text: "Delegate this work", text_elements: [] }],
            }),
            codexAgentMessageItemFixture({
              id: "parent-delegating",
              phase: "commentary",
              text: "I am delegating this now.",
            }),
            codexCollabAgentToolCallFixture({
              id: "parent-spawn",
              tool: "spawnAgent",
              status: "completed",
              senderThreadId: "parent-thread",
              receiverThreadIds: ["child-thread"],
              prompt: "Inspect the repository",
              agentsStates: {
                "child-thread": { status: "completed", message: "Done" },
              },
            }),
            codexAgentMessageItemFixture({
              id: "parent-waiting",
              phase: "commentary",
              text: "The subagent is running.",
            }),
          ],
        },
      ],
    };
    const transport: CodexJsonRpcTransport = {
      async request(request: CodexJsonRpcRequest) {
        if (request.method === "thread/read") {
          return paginatedThreadReadResponse(thread);
        }
        if (request.method === "thread/turns/list") {
          return paginatedTurnsListResponse(thread);
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
    const thread = {
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
            codexSubAgentActivityItemFixture({
              id: "root-started-sibling",
              agentThreadId: "sibling-thread",
              kind: "started",
            }),
          ],
        },
        {
          id: "child-turn",
          startedAt: 11,
          status: "completed",
          items: [
            codexSubAgentActivityItemFixture({
              id: "child-started-grandchild",
              agentThreadId: "grandchild-thread",
              kind: "started",
            }),
          ],
        },
      ],
    };
    const transport: CodexJsonRpcTransport = {
      async request(request: CodexJsonRpcRequest) {
        if (request.method === "thread/read") {
          return paginatedThreadReadResponse(thread);
        }
        if (request.method === "thread/turns/list") {
          // SAFETY: This test controls the fixture and supplies `{ threadId: string }` used by this case.
          const { threadId } = request.params as { threadId: string };
          if (threadId === "root-thread") {
            return paginatedTurnsResponse([{ id: "root-turn", items: [], status: "completed" }]);
          }
          return paginatedTurnsListResponse(thread);
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

  test("keeps stable paginated item ids while hydrating messages and tools", async () => {
    const turns = [
      {
        id: "child-turn",
        startedAt: 1_783_715_581,
        completedAt: null,
        durationMs: null,
        status: "inProgress",
        items: [
          codexUserMessageItemFixture({
            id: "child-user",
            content: [{ type: "text", text: "Inspect the repository", text_elements: [] }],
          }),
          codexAgentMessageItemFixture({
            id: "child-commentary",
            phase: "commentary",
            text: "I’m checking the repository now.",
          }),
          codexCommandExecutionItemFixture({
            id: "child-command",
            command: "pwd",
            commandActions: [{ type: "unknown", command: "pwd" }],
            aggregatedOutput: "/repo",
            durationMs: 12,
          }),
          codexMcpToolCallItemFixture({
            id: "child-tool",
            server: "semble",
            tool: "search",
            arguments: { query: "architecture" },
            result: {
              content: [{ type: "text", text: "result" }],
              structuredContent: null,
              _meta: null,
            },
            durationMs: 107,
          }),
        ],
      },
    ];
    const transport: CodexJsonRpcTransport = {
      async request(request: CodexJsonRpcRequest) {
        if (request.method === "thread/read") {
          return paginatedThreadReadResponse({
            id: "child-thread",
            cwd: "/repo",
            createdAt: 1_783_715_580,
            status: { type: "idle" },
            turns: [],
          });
        }
        if (request.method === "thread/turns/list") {
          return paginatedTurnsResponse(turns);
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
    // SAFETY: This test controls the fixture and supplies `{ timestampIsApproximate?: boolean } | undefined` used by this case.
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
    // SAFETY: This test controls the fixture and supplies `| { startedAtMs?: number; endedAtMs?: number } | undefined` used by this case.
    expect(
      (
        byId.get("child-command")?.parts[0] as
          | { startedAtMs?: number; endedAtMs?: number }
          | undefined
      )?.startedAtMs,
    ).toBeUndefined();
    // SAFETY: This test controls the fixture and supplies `{ startedAtMs?: number; endedAtMs?: number } | undefined` used by this case.
    expect(
      (byId.get("child-tool")?.parts[0] as { startedAtMs?: number; endedAtMs?: number } | undefined)
        ?.endedAtMs,
    ).toBeUndefined();
  });

  test("loads child history when its fork parent is no longer readable", async () => {
    let parentReadError = "thread not loaded: missing-parent";
    const transport: CodexJsonRpcTransport = {
      async request(request: CodexJsonRpcRequest) {
        if (request.method === "thread/read") {
          return paginatedThreadReadResponse({
            id: "child-thread",
            cwd: "/repo",
            createdAt: 1,
            status: { type: "idle" },
            forkedFromId: "missing-parent",
            parentThreadId: "missing-parent",
            turns: [],
          });
        }
        if (request.method === "thread/turns/list") {
          // SAFETY: This test controls the fixture and supplies `{ threadId: string }` used by this case.
          const params = request.params as { threadId: string };
          if (params.threadId === "missing-parent") {
            throw new Error(parentReadError);
          }
          return paginatedTurnsResponse([
            {
              id: "child-turn",
              startedAt: 2,
              status: "completed",
              items: [codexAgentMessageItemFixture({ id: "child-answer", text: "Child result" })],
            },
          ]);
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
      async request(request: CodexJsonRpcRequest) {
        if (request.method === "thread/read") {
          return paginatedThreadReadResponse({
            id: "child-thread",
            cwd: "/repo",
            createdAt: 10,
            status: { type: "idle" },
            forkedFromId: "missing-parent",
            parentThreadId: "missing-parent",
            turns: [],
          });
        }
        if (request.method === "thread/turns/list") {
          // SAFETY: This test controls the fixture and supplies `{ threadId: string }` used by this case.
          const params = request.params as { threadId: string };
          if (params.threadId === "missing-parent") {
            throw new Error("thread not loaded: missing-parent");
          }
          return paginatedTurnsResponse([
            { id: "inherited-turn", startedAt: 5, status: "completed", items: [] },
            { id: "child-turn", startedAt: 11, status: "completed", items: [] },
          ]);
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
      request: async (request: CodexJsonRpcRequest) => {
        if (request.method === "thread/read") {
          throw new Error(
            "thread is not materialized yet: includeTurns is unavailable before first user message",
          );
        }
        return baseTransport.request(request);
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

  test("loads search command metadata and hides contextual user fragments from paginated history", async () => {
    const thread = {
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
            codexUserMessageItemFixture({
              id: "context-1",
              content: [
                {
                  type: "text",
                  text: "<environment_context>\nsecret repo context\n</environment_context>",
                  text_elements: [],
                },
              ],
            }),
            codexCommandExecutionItemFixture({
              id: "search-1",
              command: "rg foo src",
              commandActions: [
                { type: "search", command: "rg foo src", path: "src", query: "foo" },
              ],
              aggregatedOutput: "src/app.ts:foo",
            }),
          ],
        },
      ],
    };
    const transport: CodexJsonRpcTransport = {
      async request(request: CodexJsonRpcRequest) {
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-search"], nextCursor: null };
        }
        if (request.method === "thread/list") {
          return {
            data: [{ id: "thread-search", cwd: "/repo", createdAt: 1, status: { type: "active" } }],
            nextCursor: null,
          };
        }
        if (request.method === "thread/turns/list") {
          return paginatedTurnsListResponse(thread);
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        return paginatedThreadReadResponse(thread);
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
    const thread = {
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
            codexUserMessageItemFixture({
              id: "skill-user-1",
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
            }),
          ],
        },
      ],
    };
    const transport: CodexJsonRpcTransport = {
      async request(request: CodexJsonRpcRequest) {
        calls.push(request);
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-skill"], nextCursor: null };
        }
        if (request.method === "thread/list") {
          return {
            data: [{ id: "thread-skill", cwd: "/repo", createdAt: 1, status: { type: "active" } }],
            nextCursor: null,
          };
        }
        if (request.method === "thread/turns/list") {
          return paginatedTurnsListResponse(thread);
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        return paginatedThreadReadResponse(thread);
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
    const thread = {
      id: "thread-unloaded-idle",
      cwd: "/repo",
      status: { type: "idle" },
      turns: [
        {
          id: "turn-1",
          status: "completed",
          items: [
            codexAgentMessageItemFixture({
              id: "msg-1",
              phase: "final_answer",
              text: "Hydrated from paginated history",
            }),
          ],
        },
      ],
    };
    const transport: CodexJsonRpcTransport = {
      async request(request: CodexJsonRpcRequest) {
        calls.push(request);
        if (request.method === "thread/read") {
          return paginatedThreadReadResponse(thread);
        }
        if (request.method === "thread/turns/list") {
          return paginatedTurnsListResponse(thread);
        }
        if (request.method === "thread/loaded/list") {
          return { data: [], nextCursor: null };
        }
        if (request.method === "thread/list") {
          return paginatedThreadListResponse([
            {
              id: "thread-unloaded-idle",
              cwd: "/repo",
              createdAt: 1,
              preview: "Unloaded idle thread",
              status: { type: "idle" },
            },
          ]);
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
        text: "Hydrated from paginated history",
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
      async request(request: CodexJsonRpcRequest) {
        calls.push(request);
        if (request.method === "thread/loaded/list") {
          return { data: [], nextCursor: null };
        }
        if (request.method === "thread/list") {
          return paginatedThreadListResponse([]);
        }
        if (request.method === "thread/resume") {
          throw new Error("Stored Codex history must be read without resuming the thread.");
        }
        if (request.method === "thread/read") {
          return paginatedThreadReadResponse({
            id: "thread-unloaded",
            cwd: "/repo",
            status: { type: "idle" },
            turns: [],
          });
        }
        if (request.method === "thread/turns/list") {
          return paginatedTurnsResponse([
            {
              id: "turn-1",
              status: "completed",
              items: [
                codexAgentMessageItemFixture({
                  id: "msg-1",
                  phase: "final_answer",
                  text: "Hydrated from paginated history",
                }),
              ],
            },
          ]);
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

  test("loads documented paginated tool item shapes", async () => {
    const thread = {
      id: "thread-contract",
      cwd: "/repo",
      turns: [
        {
          id: "turn-1",
          status: "completed",
          startedAt: 1,
          completedAt: 2,
          items: [
            codexCommandExecutionItemFixture({
              id: "cmd-array",
              command: "bun test",
              aggregatedOutput: "70 pass",
            }),
            codexMcpToolCallItemFixture({
              id: "mcp-json-args",
              server: "openducktor",
              tool: "odt_read_task",
              arguments: JSON.stringify({ taskId: "task-1" }),
              result: {
                content: [{ type: "text", text: "task ok" }],
                structuredContent: null,
                _meta: null,
              },
            }),
            codexDynamicToolCallFixture({
              id: "dynamic-json-args",
              namespace: "functions",
              tool: "request_user_input",
              arguments: JSON.stringify({
                requestId: "q1",
                questions: [{ question: "Choose mode" }],
              }),
              contentItems: [{ type: "inputText", text: "selected" }],
            }),
            codexAgentMessageItemFixture({
              id: "final-content-array",
              phase: "final_answer",
              text: "Final from content",
            }),
          ],
        },
      ],
    };
    const transport: CodexJsonRpcTransport = {
      async request(request: CodexJsonRpcRequest) {
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-contract"], nextCursor: null };
        }
        if (request.method === "thread/list") {
          return {
            data: [
              { id: "thread-contract", cwd: "/repo", createdAt: 1, status: { type: "active" } },
            ],
            nextCursor: null,
          };
        }
        if (request.method === "thread/turns/list") {
          return paginatedTurnsListResponse(thread);
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        return paginatedThreadReadResponse(thread);
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

  test("loads command action read find and bash tools from paginated history", async () => {
    const thread = {
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
            codexCommandExecutionItemFixture({
              id: "cmd-read-action",
              command: "cat src/app.ts",
              commandActions: [
                { type: "read", command: "cat src/app.ts", name: "app.ts", path: "src/app.ts" },
              ],
              aggregatedOutput: "const app = true;",
            }),
            codexCommandExecutionItemFixture({
              id: "cmd-find-action",
              command: "find src -name '*.ts'",
              commandActions: [
                {
                  type: "search",
                  command: "find src -name '*.ts'",
                  path: "src",
                  query: "*.ts",
                },
              ],
              aggregatedOutput: "src/app.ts",
            }),
            codexCommandExecutionItemFixture({
              id: "cmd-bash-action",
              command: "bun test",
              commandActions: [{ type: "unknown", command: "bun test" }],
              aggregatedOutput: "1 pass",
            }),
            codexAgentMessageItemFixture({
              id: "final-action-turn",
              phase: "final_answer",
              text: "Done",
            }),
          ],
        },
      ],
    };
    const transport: CodexJsonRpcTransport = {
      async request(request: CodexJsonRpcRequest) {
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-command-actions"], nextCursor: null };
        }
        if (request.method === "thread/list") {
          return paginatedThreadListResponse([
            {
              id: "thread-command-actions",
              cwd: "/repo",
              createdAt: 1,
              status: { type: "active" },
            },
          ]);
        }
        if (request.method === "thread/turns/list") {
          return paginatedTurnsListResponse(thread);
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        return paginatedThreadReadResponse(thread);
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
            tool: "search",
            input: expect.objectContaining({ path: "src", query: "*.ts" }),
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
      async request(request: CodexJsonRpcRequest) {
        calls.push(request);
        if (request.method === "thread/loaded/list") {
          return { data: [], nextCursor: null };
        }
        if (request.method === "thread/list") {
          return { data: [], nextCursor: null };
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
      { method: "thread/read", params: { threadId: "missing-thread", includeTurns: false } },
    ]);
  });

  test("loads Codex session todos from paginated update_plan tool calls", async () => {
    const thread = {
      id: "thread-todos",
      cwd: "/repo",
      turns: [
        {
          id: "turn-1",
          status: "completed",
          items: [
            codexDynamicToolCallFixture({
              id: "todo-call-1",
              namespace: "functions",
              tool: "update_plan",
              arguments: {
                plan: [
                  { step: "Inspect docs", status: "completed" },
                  { step: "Wire todos", status: "inProgress" },
                ],
              },
            }),
          ],
        },
      ],
    };
    const transport: CodexJsonRpcTransport = {
      async request(request: CodexJsonRpcRequest) {
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-todos"], nextCursor: null };
        }
        if (request.method === "thread/list") {
          return paginatedThreadListResponse([
            { id: "thread-todos", cwd: "/repo", createdAt: 1, status: { type: "idle" } },
          ]);
        }
        if (request.method === "thread/turns/list") {
          return paginatedTurnsListResponse(thread);
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        return paginatedThreadReadResponse(thread);
      },
    };
    const adapter = createAdapterWithTransport(transport);

    const todos = await adapter.loadSessionTodos({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-todos",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });

    expect(todos).toEqual([
      expect.objectContaining({ content: "Inspect docs", status: "completed" }),
      expect.objectContaining({ content: "Wire todos", status: "in_progress" }),
    ]);
  });

  test("loads todos independently after loading Codex session history", async () => {
    const calls: CodexJsonRpcRequest[] = [];
    const thread = {
      id: "thread-history-todos",
      cwd: "/repo",
      createdAt: 1,
      status: { type: "idle" },
      turns: [
        {
          id: "turn-1",
          status: "completed",
          items: [
            codexDynamicToolCallFixture({
              id: "todo-call-1",
              namespace: "functions",
              tool: "update_plan",
              arguments: {
                plan: [
                  { step: "Load transcript once", status: "completed" },
                  { step: "Reuse todos", status: "inProgress" },
                ],
              },
              durationMs: 25,
            }),
          ],
        },
      ],
    };
    const transport: CodexJsonRpcTransport = {
      async request(request: CodexJsonRpcRequest) {
        calls.push(request);
        if (request.method === "thread/loaded/list") {
          return { data: [], nextCursor: null };
        }
        if (request.method === "thread/list") {
          return paginatedThreadListResponse([
            {
              id: "thread-history-todos",
              cwd: "/repo",
              createdAt: 1,
              status: { type: "idle" },
            },
          ]);
        }
        if (request.method === "thread/read") {
          return paginatedThreadReadResponse(thread);
        }
        if (request.method === "thread/turns/list") {
          return paginatedTurnsListResponse(thread);
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
        parts: [expect.objectContaining({ kind: "tool" })],
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
    const thread = {
      id: "thread-history-todos",
      cwd: "/repo",
      createdAt: 1,
      status: { type: "idle" },
      turns: [
        {
          id: "turn-1",
          status: "completed",
          items: [
            codexDynamicToolCallFixture({
              id: "todo-call-1",
              namespace: "functions",
              tool: "update_plan",
              arguments: { plan: [{ step: "Cached todo", status: "completed" }] },
            }),
          ],
        },
      ],
    };
    const transport: CodexJsonRpcTransport = {
      async request(request: CodexJsonRpcRequest) {
        calls.push(request);
        if (request.method === "thread/loaded/list") {
          return { data: [], nextCursor: null };
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
          };
        }
        if (request.method === "thread/read") {
          return paginatedThreadReadResponse(thread);
        }
        if (request.method === "thread/turns/list") {
          return paginatedTurnsListResponse(thread);
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

    // SAFETY: This test controls the fixture and supplies `never` used by this case.
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
    const thread = {
      id: "thread-empty-todos",
      cwd: "/repo",
      turns: [
        {
          id: "turn-1",
          status: "completed",
          items: [],
        },
      ],
    };
    const transport: CodexJsonRpcTransport = {
      async request(request: CodexJsonRpcRequest) {
        calls.push(request);
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-empty-todos"], nextCursor: null };
        }
        if (request.method === "thread/list") {
          return paginatedThreadListResponse([
            {
              id: "thread-empty-todos",
              cwd: "/repo",
              createdAt: 1,
              status: { type: "idle" },
            },
          ]);
        }
        if (request.method === "thread/resume") {
          return {
            ...codexThreadStartResultFixture("thread-empty-todos", "thread/resume"),
            thread: codexThreadFixture({
              id: "thread-empty-todos",
              createdAt: 1,
              status: { type: "idle" },
            }),
          };
        }
        if (request.method === "thread/turns/list") {
          return paginatedTurnsListResponse(thread);
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        return paginatedThreadReadResponse(thread);
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

    const todos = await adapter.loadSessionTodos({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-empty-todos",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });

    expect(todos).toEqual([]);
    expect(calls.some((call) => call.method === "thread/read")).toBe(true);
  });

  test("loads only the selected final Codex agent message as finished", async () => {
    const thread = {
      id: "thread-final-message",
      cwd: "/repo",
      turns: [
        {
          id: "turn-1",
          status: "completed",
          startedAt: 1,
          completedAt: 2,
          items: [
            codexAgentMessageItemFixture({
              id: "commentary-1",
              phase: "commentary",
              text: "Working",
            }),
            codexAgentMessageItemFixture({
              id: "final-1",
              phase: "final_answer",
              text: "Final answer",
            }),
          ],
        },
      ],
    };
    const transport: CodexJsonRpcTransport = {
      async request(request: CodexJsonRpcRequest) {
        if (request.method === "thread/loaded/list") {
          return { data: [], nextCursor: null };
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
          };
        }
        if (request.method === "thread/turns/list") {
          return paginatedTurnsListResponse(thread);
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        return paginatedThreadReadResponse(thread);
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

  test("loads Codex session todos from paginated plan items", async () => {
    const thread = {
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
              text: "- [x] Inspect\n- in progress: Fix hydration",
            },
          ],
        },
      ],
    };
    const transport: CodexJsonRpcTransport = {
      async request(request: CodexJsonRpcRequest) {
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-plan-todos"], nextCursor: null };
        }
        if (request.method === "thread/list") {
          return paginatedThreadListResponse([
            { id: "thread-plan-todos", cwd: "/repo", createdAt: 1, status: { type: "idle" } },
          ]);
        }
        if (request.method === "thread/turns/list") {
          return paginatedTurnsListResponse(thread);
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        return paginatedThreadReadResponse(thread);
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

  test("loads Codex session todos from paginated plan text checklists", async () => {
    const thread = {
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
    };
    const transport: CodexJsonRpcTransport = {
      async request(request: CodexJsonRpcRequest) {
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-plan-text-todos"], nextCursor: null };
        }
        if (request.method === "thread/list") {
          return paginatedThreadListResponse([
            {
              id: "thread-plan-text-todos",
              cwd: "/repo",
              createdAt: 1,
              status: { type: "idle" },
            },
          ]);
        }
        if (request.method === "thread/turns/list") {
          return paginatedTurnsListResponse(thread);
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        return paginatedThreadReadResponse(thread);
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

  test("loads Codex session todos from paginated named todo tool calls", async () => {
    const thread = {
      id: "thread-named-todos",
      cwd: "/repo",
      turns: [
        {
          id: "turn-1",
          status: "completed",
          items: [
            codexDynamicToolCallFixture({
              id: "todo-call-1",
              namespace: "functions",
              tool: "update_plan",
              arguments: {
                plan: [
                  { step: "Inspect", status: "completed" },
                  { step: "Fix latest todo", status: "in_progress" },
                ],
              },
            }),
          ],
        },
      ],
    };
    const transport: CodexJsonRpcTransport = {
      async request(request: CodexJsonRpcRequest) {
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-named-todos"], nextCursor: null };
        }
        if (request.method === "thread/list") {
          return paginatedThreadListResponse([
            { id: "thread-named-todos", cwd: "/repo", createdAt: 1, status: { type: "idle" } },
          ]);
        }
        if (request.method === "thread/turns/list") {
          return paginatedTurnsListResponse(thread);
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        return paginatedThreadReadResponse(thread);
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

  test("loads Codex session todos from paginated JSON arguments", async () => {
    const thread = {
      id: "thread-json-todos",
      cwd: "/repo",
      turns: [
        {
          id: "turn-1",
          status: "completed",
          items: [
            codexDynamicToolCallFixture({
              id: "todo-call-1",
              namespace: "functions",
              tool: "update_plan",
              arguments: JSON.stringify({
                plan: [
                  { step: "Map paginated history", status: "completed" },
                  { step: "Hydrate todos", status: "in_progress" },
                ],
              }),
            }),
          ],
        },
      ],
    };
    const transport: CodexJsonRpcTransport = {
      async request(request: CodexJsonRpcRequest) {
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-json-todos"], nextCursor: null };
        }
        if (request.method === "thread/list") {
          return paginatedThreadListResponse([
            { id: "thread-json-todos", cwd: "/repo", createdAt: 1, status: { type: "idle" } },
          ]);
        }
        if (request.method === "thread/turns/list") {
          return paginatedTurnsListResponse(thread);
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        return paginatedThreadReadResponse(thread);
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
      expect.objectContaining({ content: "Map paginated history", status: "completed" }),
      expect.objectContaining({ content: "Hydrate todos", status: "in_progress" }),
    ]);
  });

  test("ignores failed or incomplete Codex paginated todo tool calls", async () => {
    const thread = {
      id: "thread-bad-todos",
      cwd: "/repo",
      turns: [
        {
          id: "turn-1",
          status: "completed",
          items: [
            codexDynamicToolCallFixture({
              id: "todo-call-running",
              namespace: "functions",
              tool: "update_plan",
              status: "inProgress",
              success: null,
              arguments: { plan: [{ step: "Do not show", status: "in_progress" }] },
            }),
            codexDynamicToolCallFixture({
              id: "todo-call-failed",
              namespace: "functions",
              tool: "todo_write",
              status: "failed",
              success: false,
              arguments: { todo: [{ step: "Also hidden", status: "pending" }] },
            }),
          ],
        },
      ],
    };
    const transport: CodexJsonRpcTransport = {
      async request(request: CodexJsonRpcRequest) {
        if (request.method === "thread/loaded/list") {
          return { data: ["thread-bad-todos"], nextCursor: null };
        }
        if (request.method === "thread/list") {
          return paginatedThreadListResponse([
            { id: "thread-bad-todos", cwd: "/repo", createdAt: 1, status: { type: "idle" } },
          ]);
        }
        if (request.method === "thread/turns/list") {
          return paginatedTurnsListResponse(thread);
        }
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }
        return paginatedThreadReadResponse(thread);
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
