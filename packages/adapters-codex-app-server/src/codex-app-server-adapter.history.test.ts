import { describe, expect, mock, test } from "bun:test";
import {
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD,
  type CodexAppServerThread,
  type CodexAppServerTurn,
} from "@openducktor/contracts";
import type { AgentEvent } from "@openducktor/core";
import {
  createAdapterWithTransport,
  codexSessionRef,
  codexSessionRuntimeRef,
  codexStartSessionInput,
  codexUserMessageInput,
  codexThreadStartResultFixture,
  codexThreadFixture,
  codexTurnFixture,
  createDeferred,
  createHarness,
  createRuntimeStreamSubscription,
  defaultCodexEffectivePolicy,
  flushCodexAdapterWork,
  RecordingTransport,
  requestThreadId,
  waitForEvent,
} from "./codex-app-server-adapter.test-harness";
import {
  CodexQuestionHistory,
  type CodexJsonRpcRequest,
  type CodexJsonRpcTransport,
  type CodexLiveSessionMutation,
} from "./index";
import { encodeCodexAsyncQuestionReplies } from "./codex-async-questions";
import {
  codexRpcRequestError,
  EMPTY_ROLLOUT_MESSAGE,
  NESTED_EMPTY_ROLLOUT_MESSAGE,
} from "./test-fixtures/codex-rpc-error";
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

const backgroundQuestionThread = (): PaginatedThreadFixture => ({
  id: "thread-idle",
  cwd: "/repo",
  turns: [
    {
      id: "turn-question",
      status: "completed",
      items: [
        codexAgentMessageItemFixture({
          id: "history-question",
          text: "Which environment should I use?",
          delivery: "async",
          questions: [
            {
              title: "Which environment should I use?",
              options: ["Staging", "Production"],
            },
          ],
        }),
      ],
    },
  ],
});

const historyErrorTransport = (
  method: "thread/read" | "thread/turns/list",
  error: Error,
  threadId = "thread/start-runtime-live",
): CodexJsonRpcTransport => {
  const base = new RecordingTransport("runtime-live", false);
  return {
    request: async (request) => {
      if (request.method === method) throw error;
      if (request.method === "thread/read") {
        return paginatedThreadReadResponse({ id: threadId, cwd: "/repo", turns: [] });
      }
      return base.request(request);
    },
  };
};

describe("CodexAppServerAdapter history loading", () => {
  test("keeps an answered blocking question when history reloads", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const respondServerRequest = mock(async () => undefined);
    const questionHistory = new CodexQuestionHistory();
    const { adapter } = createHarness({
      questionHistory,
      respondServerRequest,
      subscribeEvents: runtimeStream.subscribeEvents,
    });
    const ref = codexSessionRuntimeRef("thread/start-runtime-live");
    await adapter.startSession(codexStartSessionInput());
    const events: AgentEvent[] = [];
    await adapter.subscribeEvents(ref, (event) => events.push(event));

    runtimeStream.emitServerRequest({
      id: 91,
      method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_TOOL_REQUEST_USER_INPUT,
      params: {
        autoResolutionMs: null,
        isBlocking: true,
        threadId: ref.externalSessionId,
        turnId: "turn-blocking-question",
        itemId: "question-tool-call",
        questions: [
          {
            id: "pizza-size",
            header: "Pizza",
            question: "Which size do you want?",
            isOther: false,
            isSecret: false,
            options: [
              { label: "Small", description: "Small pizza" },
              { label: "Large", description: "Large pizza" },
            ],
          },
        ],
      },
    });
    const question = await waitForEvent(
      events,
      (event): event is Extract<AgentEvent, { type: "question_required" }> =>
        event.type === "question_required",
    );
    await adapter.replyLiveQuestion({
      runtimeId: "runtime-live",
      externalSessionId: ref.externalSessionId,
      requestId: question.requestId,
      answers: [["Large"]],
    });

    const liveHistory = await adapter.loadSessionHistory(ref);
    expect(
      liveHistory.filter(
        (message) => message.messageId === `codex-question-${question.requestInstanceId}`,
      ),
    ).toEqual([
      expect.objectContaining({
        role: "assistant",
        parts: [
          expect.objectContaining({
            kind: "tool",
            status: "completed",
            metadata: expect.objectContaining({
              answers: { "pizza-size": { answers: ["Large"] } },
            }),
          }),
        ],
      }),
    ]);

    const { adapter: reloadedAdapter } = createHarness({ questionHistory });
    const history = await reloadedAdapter.loadSessionHistory(ref);
    expect(history).toContainEqual(
      expect.objectContaining({
        messageId: `codex-question-${question.requestInstanceId}`,
        role: "assistant",
        parts: [
          expect.objectContaining({
            kind: "tool",
            tool: "request_user_input",
            status: "completed",
            metadata: expect.objectContaining({
              rawToolName: "request_user_input",
            }),
            input: {
              questions: [
                expect.objectContaining({
                  header: "Pizza",
                  question: "Which size do you want?",
                }),
              ],
            },
          }),
        ],
      }),
    );
  });

  test("restores an unanswered background question for a resumed session", async () => {
    const thread = backgroundQuestionThread();
    const baseTransport = new RecordingTransport("runtime-live", false);
    const transport: CodexJsonRpcTransport = {
      request: async (request) => {
        if (request.method === "thread/read") return paginatedThreadReadResponse(thread);
        if (request.method === "thread/turns/list") return paginatedTurnsListResponse(thread);
        return baseTransport.request(request);
      },
    };
    const mutations: CodexLiveSessionMutation[] = [];
    const { subscribeEvents } = createRuntimeStreamSubscription();
    const adapter = createAdapterWithTransport(transport, {
      subscribeEvents,
      onLiveSessionMutation: (mutation) => mutations.push(mutation),
    });
    const ref = codexSessionRuntimeRef("thread-idle");
    await adapter.resumeSession(ref);

    const history = await adapter.loadSessionHistory(ref);
    expect(history).toContainEqual(
      expect.objectContaining({
        messageId: "history-question",
        questionRequest: expect.objectContaining({ requestId: "history-question" }),
      }),
    );
    expect(mutations).toContainEqual(
      expect.objectContaining({
        snapshotMode: "delta",
        snapshots: [
          expect.objectContaining({
            pendingQuestions: [
              expect.objectContaining({ requestId: "history-question", blocking: false }),
            ],
          }),
        ],
      }),
    );

    await adapter.replyQuestion({
      ...ref,
      requestId: "history-question",
      answers: [["Staging"]],
    });

    const turnStart = baseTransport.calls.findLast((call) => call.method === "turn/start");
    expect(turnStart?.params).toMatchObject({
      input: [
        {
          type: "text",
          text: encodeCodexAsyncQuestionReplies([
            {
              questionItemId: '["request_user_input_async","history-question",0]',
              question: "Which environment should I use?",
              answer: "Staging",
            },
          ]),
        },
      ],
    });
  });

  test("restores a background question when its reply reattaches the session", async () => {
    const thread = backgroundQuestionThread();
    const baseTransport = new RecordingTransport("runtime-live", false);
    const transport: CodexJsonRpcTransport = {
      request: async (request) => {
        if (request.method === "thread/read") return paginatedThreadReadResponse(thread);
        if (request.method === "thread/turns/list") return paginatedTurnsListResponse(thread);
        return baseTransport.request(request);
      },
    };
    const adapter = createAdapterWithTransport(transport);
    const ref = codexSessionRuntimeRef("thread-idle");

    await adapter.replyQuestion({
      ...ref,
      requestId: "history-question",
      answers: [["Staging"]],
    });

    const turnStart = baseTransport.calls.findLast((call) => call.method === "turn/start");
    expect(turnStart?.params).toMatchObject({
      input: [
        {
          type: "text",
          text: encodeCodexAsyncQuestionReplies([
            {
              questionItemId: '["request_user_input_async","history-question",0]',
              question: "Which environment should I use?",
              answer: "Staging",
            },
          ]),
        },
      ],
    });
  });

  test("validates cold child ancestry with a passive targeted read", async () => {
    const requests: CodexJsonRpcRequest[] = [];
    const adapter = createAdapterWithTransport({
      request: async (request) => {
        requests.push(request);
        return {
          thread: codexThreadFixture({
            id: "child",
            cwd: "/repo",
            status: { type: "idle" },
            parentThreadId: "root",
          }),
        };
      },
    });
    const ref = {
      repoPath: "/repo",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo",
      externalSessionId: "child",
    };
    await expect(adapter.resolveSessionParent(ref)).resolves.toBe("root");
    expect(requests).toEqual([
      { method: "thread/read", params: { threadId: "child", includeTurns: false } },
    ]);
    await expect(
      adapter.resolveSessionParent({ ...ref, workingDirectory: "/other" }),
    ).rejects.toMatchObject({ code: "scope_mismatch" });
  });

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
          const threadId = requestThreadId(request.params);
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

  test("loads child-only fork history with completed subagent activity", async () => {
    const thread = {
      id: "child-thread",
      createdAt: 10,
      historyMode: "paginated",
      forkedFromId: "root-thread",
      parentThreadId: "root-thread",
      turns: [
        {
          id: "child-turn",
          startedAt: 10,
          status: "completed",
          items: [
            codexSubAgentActivityItemFixture({
              id: "child-started-grandchild",
              agentThreadId: "grandchild-thread",
              kind: "started",
            }),
            codexSubAgentActivityItemFixture({
              id: "child-completed-grandchild",
              agentThreadId: "grandchild-thread",
              kind: "completed",
            }),
            codexAgentMessageItemFixture({ id: "child-answer", text: "Review complete." }),
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
          if (requestThreadId(request.params) === "root-thread") {
            return paginatedTurnsResponse([{ id: "root-turn", status: "completed", items: [] }]);
          }
          return paginatedTurnsListResponse(thread);
        }
        throw new Error(`Unexpected method '${request.method}'.`);
      },
    };

    const history = await createAdapterWithTransport(transport).loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "child-thread",
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });

    expect(history.map((message) => message.messageId)).toEqual([
      "codex-fork-boundary:child-thread",
      "codex-subagent:child-thread:grandchild-thread",
      "codex-subagent:child-thread:grandchild-thread",
      "child-answer",
    ]);
    expect(
      history.flatMap((message) => message.parts).filter((part) => part.kind === "subagent"),
    ).toEqual([
      expect.objectContaining({
        correlationKey: "codex-subagent:child-thread:grandchild-thread",
        externalSessionId: "grandchild-thread",
        status: "running",
      }),
      expect.objectContaining({
        correlationKey: "codex-subagent:child-thread:grandchild-thread",
        externalSessionId: "grandchild-thread",
        status: "completed",
      }),
    ]);
    expect(history.at(-1)?.text).toBe("Review complete.");
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
    const hasApproximateTimestamp = (messageId: string): boolean | undefined =>
      byId.get(messageId)?.timestampIsApproximate;

    expect(byId.get("child-user")?.timestamp).toBe("2026-07-10T20:33:01.000Z");
    expect(hasApproximateTimestamp("child-user")).toBeUndefined();
    expect(byId.get("child-commentary")?.timestamp).toBe("2026-07-10T20:33:01.000Z");
    expect(hasApproximateTimestamp("child-commentary")).toBe(true);
    expect(byId.get("child-command")?.timestamp).toBe("2026-07-10T20:33:01.000Z");
    expect(hasApproximateTimestamp("child-command")).toBe(true);
    expect(byId.get("child-tool")?.timestamp).toBe("2026-07-10T20:33:01.000Z");
    expect(hasApproximateTimestamp("child-tool")).toBe(true);
    const childCommandPart = byId.get("child-command")?.parts[0];
    const childToolPart = byId.get("child-tool")?.parts[0];
    if (childCommandPart?.kind !== "tool" || childToolPart?.kind !== "tool") {
      throw new Error("Expected child command and tool history parts.");
    }
    expect(childCommandPart.startedAtMs).toBeUndefined();
    expect(childToolPart.endedAtMs).toBeUndefined();
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
          const params: { threadId: string } = request.params;
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
          const params: { threadId: string } = request.params;
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
      systemPromptContext: {
        startedAt: "2026-05-08T00:00:00.000Z",
        systemPrompt: "Use the supplied display context.",
      },
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

  test("recovers first-turn output after reattachment without reading a pending rollout", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const baseTransport = new RecordingTransport("runtime-live", false);
    const historyRequests: string[] = [];
    const adapter = createAdapterWithTransport(
      {
        request: async (request) => {
          if (["thread/read", "thread/turns/list"].includes(request.method)) {
            historyRequests.push(request.method);
            throw new Error("History must not read the pending first rollout.");
          }
          if (request.method === "turn/start") {
            return { turn: codexTurnFixture({ id: "turn-live", items: [], status: "inProgress" }) };
          }
          return baseTransport.request(request);
        },
      },
      { subscribeEvents: runtimeStream.subscribeEvents },
    );
    const ref = codexSessionRef();
    try {
      await adapter.startSession(codexStartSessionInput());
      const detach = await adapter.subscribeEvents(ref, () => undefined);
      const accepted = await adapter.sendUserMessage(
        codexUserMessageInput({
          parts: [{ kind: "text", text: "Start the first turn." }],
          model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
        }),
      );
      await flushCodexAdapterWork();
      detach();
      for (const delta of ["Reply while ", "the renderer is away"]) {
        runtimeStream.emitNotification({
          method: "item/agentMessage/delta",
          params: {
            threadId: ref.externalSessionId,
            turnId: "turn-live",
            itemId: "message-live",
            delta,
          },
        });
      }
      await flushCodexAdapterWork();
      const events: AgentEvent[] = [];
      const reattach = await adapter.subscribeEvents(ref, (event) => events.push(event));
      const history = await adapter.loadSessionHistory(ref);
      expect(events.filter((event) => event.type === "assistant_delta")).toEqual([]);
      expect(history).toContainEqual(
        expect.objectContaining({
          messageId: accepted.messageId,
          role: "user",
          text: "Start the first turn.",
          state: "read",
        }),
      );
      expect(history).toContainEqual(
        expect.objectContaining({
          messageId: "message-live",
          role: "assistant",
          text: "Reply while the renderer is away",
        }),
      );
      runtimeStream.emitNotification({
        method: "item/completed",
        params: {
          threadId: ref.externalSessionId,
          turnId: "turn-live",
          completedAtMs: 1_777_766_419_650,
          item: codexAgentMessageItemFixture({
            id: "message-live",
            text: "Complete reply",
            phase: "commentary",
          }),
        },
      });
      runtimeStream.emitNotification({
        method: "item/reasoning/summaryTextDelta",
        params: {
          threadId: ref.externalSessionId,
          turnId: "turn-live",
          itemId: "reasoning-live",
          summaryIndex: 0,
          delta: "Check the ",
        },
      });
      runtimeStream.emitNotification({
        method: "item/reasoning/summaryTextDelta",
        params: {
          threadId: ref.externalSessionId,
          turnId: "turn-live",
          itemId: "reasoning-live",
          summaryIndex: 0,
          delta: "repo",
        },
      });
      runtimeStream.emitNotification({
        method: "item/started",
        params: {
          threadId: ref.externalSessionId,
          turnId: "turn-live",
          startedAtMs: 1_777_766_419_650,
          item: codexCommandExecutionItemFixture({
            id: "tool-live",
            command: "git status",
            status: "inProgress",
            exitCode: null,
          }),
        },
      });
      await flushCodexAdapterWork();
      const runningHistory = await adapter.loadSessionHistory(ref);
      expect(runningHistory).toContainEqual(
        expect.objectContaining({
          messageId: "reasoning-live",
          parts: [
            expect.objectContaining({
              kind: "reasoning",
              text: "Check the repo",
              completed: false,
            }),
          ],
        }),
      );
      expect(runningHistory).toContainEqual(
        expect.objectContaining({
          messageId: "tool-live",
          parts: [expect.objectContaining({ kind: "tool", status: "running" })],
        }),
      );
      runtimeStream.emitNotification({
        method: "item/completed",
        params: {
          threadId: ref.externalSessionId,
          turnId: "turn-live",
          completedAtMs: 1_777_766_420_650,
          item: codexCommandExecutionItemFixture({
            id: "tool-live",
            command: "git status",
            aggregatedOutput: "Clean worktree",
          }),
        },
      });
      runtimeStream.emitNotification({
        method: "item/completed",
        params: {
          threadId: ref.externalSessionId,
          turnId: "turn-live",
          completedAtMs: 1_777_766_420_650,
          item: {
            type: "reasoning",
            id: "reasoning-live",
            summary: ["Checked the repo"],
            content: [],
          },
        },
      });
      await flushCodexAdapterWork();
      const updatedHistory = await adapter.loadSessionHistory(ref);
      expect(updatedHistory.filter((message) => message.messageId === "message-live")).toEqual([
        expect.objectContaining({ text: "Complete reply", model: accepted.model, parts: [] }),
      ]);
      expect(updatedHistory.filter((message) => message.messageId === "tool-live")).toEqual([
        expect.objectContaining({
          parts: [
            expect.objectContaining({
              kind: "tool",
              status: "completed",
              output: "Clean worktree",
            }),
          ],
        }),
      ]);
      expect(updatedHistory.filter((message) => message.messageId === "reasoning-live")).toEqual([
        expect.objectContaining({
          parts: [
            expect.objectContaining({
              kind: "reasoning",
              text: "Checked the repo",
              completed: true,
            }),
          ],
        }),
      ]);
      expect(history).toContainEqual(
        expect.objectContaining({
          messageId: "message-live",
          text: "Reply while the renderer is away",
        }),
      );
      const recoveredTool = updatedHistory.find((message) => message.messageId === "tool-live");
      expect(recoveredTool).toBeDefined();
      recoveredTool!.parts.length = 0;
      expect(await adapter.loadSessionHistory(ref)).toContainEqual(
        expect.objectContaining({
          messageId: "tool-live",
          parts: [expect.objectContaining({ status: "completed" })],
        }),
      );
      expect(historyRequests).toEqual([]);
      reattach();
    } finally {
      adapter.releaseRuntime("runtime-live");
    }
  });

  test("uses the initial history and live todos through the first turn without reading disk", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const baseTransport = new RecordingTransport("runtime-live", false);
    const historyRequests: string[] = [];
    const adapter = createAdapterWithTransport(
      {
        request: async (request) => {
          if (["thread/read", "thread/turns/list"].includes(request.method)) {
            historyRequests.push(request.method);
            throw new Error("History must not read the pending first rollout.");
          }
          if (request.method === "turn/start") {
            return { turn: codexTurnFixture({ id: "turn-live", items: [], status: "inProgress" }) };
          }
          return baseTransport.request(request);
        },
      },
      { subscribeEvents: runtimeStream.subscribeEvents },
    );
    const ref = codexSessionRef();
    await adapter.startSession(codexStartSessionInput());
    const events: AgentEvent[] = [];
    const unsubscribe = await adapter.subscribeEvents(ref, (event) => events.push(event));

    const assertInitialHistory = async () => {
      await expect(adapter.loadSessionHistory(ref)).resolves.toEqual([
        expect.objectContaining({
          role: "system",
          text: expect.stringContaining("Use the repo rules."),
        }),
      ]);
    };
    await assertInitialHistory();
    await expect(adapter.loadSessionTodos(ref)).resolves.toEqual([]);
    runtimeStream.emitNotification({
      method: "thread/status/changed",
      params: { threadId: ref.externalSessionId, status: { type: "idle" } },
    });
    await flushCodexAdapterWork();
    await assertInitialHistory();

    await adapter.sendUserMessage(
      codexUserMessageInput({
        parts: [{ kind: "text", text: "Start the first turn." }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );
    await flushCodexAdapterWork();
    runtimeStream.emitNotification({
      method: "turn/started",
      params: {
        threadId: ref.externalSessionId,
        turn: codexTurnFixture({ id: "turn-live", items: [], status: "inProgress" }),
      },
    });
    runtimeStream.emitNotification({
      method: "item/agentMessage/delta",
      params: {
        threadId: ref.externalSessionId,
        turnId: "turn-live",
        itemId: "message-live",
        delta: "Live reply",
      },
    });
    runtimeStream.emitNotification({
      method: "turn/plan/updated",
      params: {
        threadId: ref.externalSessionId,
        turnId: "turn-live",
        explanation: null,
        plan: [{ step: "Use live todo", status: "inProgress" }],
      },
    });
    runtimeStream.emitNotification({
      method: "turn/completed",
      params: {
        threadId: ref.externalSessionId,
        turn: codexTurnFixture({ id: "another-turn", items: [], status: "completed" }),
      },
    });
    await flushCodexAdapterWork();
    const firstTurnHistory = await adapter.loadSessionHistory(ref);
    expect(firstTurnHistory).toContainEqual(
      expect.objectContaining({ role: "assistant", messageId: "message-live", text: "Live reply" }),
    );
    runtimeStream.emitNotification({
      method: "item/completed",
      params: {
        threadId: ref.externalSessionId,
        turnId: "turn-live",
        completedAtMs: 1_777_766_419_650,
        item: codexCollabAgentToolCallFixture({
          id: "spawn-child",
          tool: "spawnAgent",
          status: "completed",
          senderThreadId: ref.externalSessionId,
          receiverThreadIds: ["child-thread"],
          agentsStates: { "child-thread": { status: "running", message: null } },
        }),
      },
    });
    await flushCodexAdapterWork();
    runtimeStream.emitNotification({
      method: "item/agentMessage/delta",
      params: {
        threadId: "child-thread",
        turnId: "child-turn",
        itemId: "child-message",
        delta: "Child progress",
      },
    });
    await flushCodexAdapterWork();
    const parentHistory = await adapter.loadSessionHistory(ref);
    expect(
      parentHistory.some((message) => message.parts.some((part) => part.kind === "subagent")),
    ).toBe(true);
    expect(
      parentHistory.some(
        (message) => message.messageId === "child-message" || message.text === "Child progress",
      ),
    ).toBe(false);
    await expect(adapter.loadSessionTodos(ref)).resolves.toEqual([
      expect.objectContaining({ content: "Use live todo", status: "in_progress" }),
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "assistant_delta", delta: "Live reply" }),
    );
    expect(historyRequests).toEqual([]);
    unsubscribe();
  });

  test.each(["completed", "failed", "interrupted"] as const)(
    "reads persisted history after the first turn is %s",
    async (status) => {
      const runtimeStream = createRuntimeStreamSubscription();
      const { adapter, transports } = createHarness({
        subscribeEvents: runtimeStream.subscribeEvents,
      });
      const ref = codexSessionRef();
      await adapter.startSession(codexStartSessionInput());
      runtimeStream.emitNotification({
        method: "item/agentMessage/delta",
        params: {
          threadId: ref.externalSessionId,
          turnId: "turn-first",
          itemId: "live-first",
          delta: "Live first-turn reply",
        },
      });
      await flushCodexAdapterWork();
      expect(await adapter.loadSessionHistory(ref)).toContainEqual(
        expect.objectContaining({ messageId: "live-first", text: "Live first-turn reply" }),
      );
      runtimeStream.emitNotification({
        method: "turn/completed",
        params: {
          threadId: ref.externalSessionId,
          turn: codexTurnFixture({ id: "turn-first", items: [], status }),
        },
      });
      await flushCodexAdapterWork();

      const history = await adapter.loadSessionHistory(ref);
      expect(history).toContainEqual(
        expect.objectContaining({ role: "assistant", text: "Hello from history" }),
      );
      expect(history.some((message) => message.messageId === "live-first")).toBe(false);
      expect(transports.get("runtime-live")?.calls.map(({ method }) => method)).toContain(
        "thread/turns/list",
      );
    },
  );

  test.each(["thread/read", "thread/turns/list"] as const)(
    "propagates %s failure after the first completed turn",
    async (method) => {
      const failure = codexRpcRequestError(method, -32603, EMPTY_ROLLOUT_MESSAGE);
      const runtimeStream = createRuntimeStreamSubscription();
      const adapter = createAdapterWithTransport(historyErrorTransport(method, failure), {
        subscribeEvents: runtimeStream.subscribeEvents,
      });
      await adapter.startSession(codexStartSessionInput());
      runtimeStream.emitNotification({
        method: "turn/completed",
        params: {
          threadId: "thread/start-runtime-live",
          turn: codexTurnFixture({ id: "turn-first", items: [], status: "completed" }),
        },
      });
      await flushCodexAdapterWork();
      await expect(adapter.loadSessionHistory(codexSessionRef())).rejects.toBe(failure);
    },
  );

  test.each(["thread/read", "thread/turns/list"] as const)(
    "propagates %s failure for a resumed session",
    async (method) => {
      const failure = codexRpcRequestError(method, -32603, NESTED_EMPTY_ROLLOUT_MESSAGE);
      const adapter = createAdapterWithTransport(
        historyErrorTransport(method, failure, "thread-idle"),
      );
      const ref = codexSessionRuntimeRef("thread-idle");
      await adapter.resumeSession(ref);
      await expect(adapter.loadSessionHistory(ref)).rejects.toBe(failure);
      await expect(adapter.loadSessionTodos(ref)).rejects.toBe(failure);
    },
  );

  test("drops the initial history and todo state when its session is released", async () => {
    const failure = codexRpcRequestError("thread/read", -32603, EMPTY_ROLLOUT_MESSAGE);
    const adapter = createAdapterWithTransport(historyErrorTransport("thread/read", failure));
    const ref = codexSessionRef();
    await adapter.startSession(codexStartSessionInput());
    await expect(adapter.loadSessionTodos(ref)).resolves.toEqual([]);
    await adapter.releaseSession(ref);
    await expect(adapter.loadSessionHistory(ref)).rejects.toBe(failure);
    await expect(adapter.loadSessionTodos(ref)).rejects.toBe(failure);
  });

  test("prefers a live todo received during a restored history read", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const baseTransport = new RecordingTransport("runtime-live", false);
    const turnsRequested = createDeferred<void>();
    const pendingTurns = createDeferred<ReturnType<typeof paginatedTurnsListResponse>>();
    const adapter = createAdapterWithTransport(
      {
        request: async (request) => {
          if (request.method === "thread/turns/list") {
            turnsRequested.resolve();
            return pendingTurns.promise;
          }
          return baseTransport.request(request);
        },
      },
      { subscribeEvents: runtimeStream.subscribeEvents },
    );
    const ref = codexSessionRuntimeRef("thread-idle");
    await adapter.resumeSession(ref);
    const todos = adapter.loadSessionTodos(ref);
    await turnsRequested.promise;
    runtimeStream.emitNotification({
      method: "turn/plan/updated",
      params: {
        threadId: ref.externalSessionId,
        turnId: "turn-live",
        explanation: null,
        plan: [{ step: "Use live todo", status: "inProgress" }],
      },
    });
    await flushCodexAdapterWork();
    pendingTurns.resolve(
      paginatedTurnsListResponse({
        id: ref.externalSessionId,
        turns: [
          {
            id: "turn-old",
            status: "completed",
            items: [
              codexDynamicToolCallFixture({
                id: "todo-old",
                namespace: "functions",
                tool: "update_plan",
                arguments: { plan: [{ step: "Old todo", status: "pending" }] },
              }),
            ],
          },
        ],
      }),
    );
    expect(await todos).toEqual([
      expect.objectContaining({ content: "Use live todo", status: "in_progress" }),
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

  test("keeps supplied prompt context after loading session context without changing live state", async () => {
    const transport = new RecordingTransport("runtime-live", false);
    const { adapter, respondServerRequest } = createHarness({
      transportFactory: () => transport,
    });
    const ref = codexSessionRef("thread-idle");
    const input = {
      ...ref,
      systemPromptContext: {
        startedAt: "2026-05-08T00:00:00.000Z",
        systemPrompt: "Use the hydrated task context.",
      },
    };

    try {
      const historyBefore = await adapter.loadSessionHistory(input);
      const systemMessagesBefore = historyBefore.filter((message) => message.role === "system");
      expect(systemMessagesBefore).toEqual([
        {
          messageId: "codex-system-prompt:thread-idle",
          role: "system",
          timestamp: input.systemPromptContext.startedAt,
          text: "System prompt:\n\nUse the hydrated task context.",
          parts: [],
        },
      ]);

      await adapter.loadSessionContextUsage(ref);
      const snapshotsBefore = structuredClone(adapter.listLiveSessionSnapshots("runtime-live"));
      expect(snapshotsBefore.map((snapshot) => snapshot.ref.externalSessionId)).toEqual([
        ref.externalSessionId,
      ]);
      const callsBefore = transport.calls.length;
      const historyAfter = await adapter.loadSessionHistory(input);
      expect(historyAfter.filter((message) => message.role === "system")).toEqual(
        systemMessagesBefore,
      );

      const historyWithoutPrompt = await adapter.loadSessionHistory(ref);
      expect(historyWithoutPrompt.filter((message) => message.role === "system")).toEqual([]);
      const historyWithBlankPrompt = await adapter.loadSessionHistory({
        ...input,
        systemPromptContext: { ...input.systemPromptContext, systemPrompt: " \n " },
      });
      expect(historyWithBlankPrompt.filter((message) => message.role === "system")).toEqual([]);
      expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual(snapshotsBefore);
      expect(transport.calls.slice(callsBefore).map((call) => call.method)).toEqual([
        "thread/read",
        "thread/turns/list",
        "thread/read",
        "thread/turns/list",
        "thread/read",
        "thread/turns/list",
      ]);
      expect(respondServerRequest).not.toHaveBeenCalled();
    } finally {
      adapter.releaseRuntime("runtime-live");
    }
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

  test("rejects history when Codex has no stored thread", async () => {
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
    ).rejects.toThrow();

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
    expect(calls.map((call) => call.method)).toEqual(["thread/read", "thread/turns/list"]);
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

    await expect(
      adapter.loadSessionTodos({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-history-todos",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        // @ts-expect-error -- This test verifies rejection of a runtime policy from another adapter.
        runtimePolicy: { kind: "opencode" },
      }),
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
