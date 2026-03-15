import { describe, expect, test } from "bun:test";
import type { Event, OpencodeClient, Part } from "@opencode-ai/sdk/v2";
import type { AgentEvent } from "@openducktor/core";
import { OpencodeSdkAdapter } from "./index";

const flushAsync = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const defaultRuntimeConnection = {
  endpoint: "http://127.0.0.1:12345",
  workingDirectory: "/repo",
} as const;

const DEFAULT_ODT_RUNTIME_TOOL_IDS = [
  "odt_read_task",
  "odt_set_spec",
  "odt_set_plan",
  "odt_build_blocked",
  "odt_build_resumed",
  "odt_build_completed",
  "odt_qa_approved",
  "odt_qa_rejected",
  "openducktor_odt_read_task",
  "openducktor_odt_set_spec",
  "openducktor_odt_set_plan",
  "openducktor_odt_build_blocked",
  "openducktor_odt_build_resumed",
  "openducktor_odt_build_completed",
  "openducktor_odt_qa_approved",
  "openducktor_odt_qa_rejected",
  "functions.openducktor_odt_read_task",
  "functions.openducktor_odt_set_spec",
  "functions.openducktor_odt_set_plan",
  "functions.openducktor_odt_build_blocked",
  "functions.openducktor_odt_build_resumed",
  "functions.openducktor_odt_build_completed",
  "functions.openducktor_odt_qa_approved",
  "functions.openducktor_odt_qa_rejected",
] as const;

type MockSession = {
  createCalls: unknown[];
  promptCalls: unknown[];
  abortCalls: unknown[];
  getCalls: unknown[];
  messagesCalls: unknown[];
  todoCalls: unknown[];
  promptQueue: Array<{ info: { id: string; [key: string]: unknown }; parts: Part[] }>;
  messagesResponse: Array<{
    info: {
      id: string;
      role: "user" | "assistant";
      time: { created: number };
      [key: string]: unknown;
    };
    parts: Part[];
  }>;
  todoResult: TodoMockResult;
};

type MockTool = {
  idsCalls: unknown[];
  listCalls: unknown[];
};

type MockMcp = {
  statusCalls: unknown[];
  connectCalls: unknown[];
};

type MockPermission = {
  replyCalls: unknown[];
};

type MockQuestion = {
  replyCalls: unknown[];
};

type MockEventStream = {
  events: Event[];
};

type TodoMockResult =
  | {
      mode: "success";
      data: unknown;
    }
  | {
      mode: "api_error";
      error: unknown;
      status?: number;
      statusText?: string;
    }
  | {
      mode: "throw";
      error: Error;
    };

type AgentsMockResult =
  | {
      mode: "success";
      data: unknown;
    }
  | {
      mode: "api_error";
      error: unknown;
    }
  | {
      mode: "throw";
      error: Error;
    };

type MakeMockClientInput = {
  sessionId?: string;
  streamEvents?: Event[];
  promptQueue?: Array<{ info: { id: string; [key: string]: unknown }; parts: Part[] }>;
  messagesResponse?: Array<{
    info: {
      id: string;
      role: "user" | "assistant";
      time: { created: number };
      [key: string]: unknown;
    };
    parts: Part[];
  }>;
  todoResult?: TodoMockResult;
  providerResponse?: unknown;
  agentsResponse?: unknown;
  agentsResult?: AgentsMockResult;
  toolIdsResponse?: unknown;
  modelToolsResponse?: unknown;
  mcpStatusResponse?: unknown;
};

const makeMockClient = ({
  sessionId = "session-opencode-1",
  streamEvents = [],
  promptQueue = [],
  messagesResponse = [],
  todoResult = {
    mode: "success",
    data: [],
  },
  providerResponse = {
    providers: [
      {
        id: "openai",
        name: "OpenAI",
        models: {
          "gpt-5": {
            name: "GPT-5",
            limit: {
              context: 400_000,
              output: 32_000,
            },
            variants: {
              high: {},
              low: {},
            },
          },
        },
      },
    ],
    default: {
      openai: "gpt-5",
    },
  },
  agentsResponse = [],
  agentsResult,
  toolIdsResponse = [...DEFAULT_ODT_RUNTIME_TOOL_IDS],
  modelToolsResponse = [],
  mcpStatusResponse = { openducktor: { status: "connected" } },
}: MakeMockClientInput): {
  client: OpencodeClient;
  session: MockSession;
  tool: MockTool;
  mcp: MockMcp;
  permission: MockPermission;
  question: MockQuestion;
  stream: MockEventStream;
} => {
  const session: MockSession = {
    createCalls: [],
    promptCalls: [],
    abortCalls: [],
    getCalls: [],
    messagesCalls: [],
    todoCalls: [],
    promptQueue: [...promptQueue],
    messagesResponse: [...messagesResponse],
    todoResult,
  };
  const permission: MockPermission = {
    replyCalls: [],
  };
  const tool: MockTool = {
    idsCalls: [],
    listCalls: [],
  };
  const mcp: MockMcp = {
    statusCalls: [],
    connectCalls: [],
  };
  const question: MockQuestion = {
    replyCalls: [],
  };
  const stream: MockEventStream = {
    events: [...streamEvents],
  };

  const client = {
    session: {
      create: async (input: unknown) => {
        session.createCalls.push(input);
        return { data: { id: sessionId }, error: undefined };
      },
      promptAsync: async (input: unknown) => {
        session.promptCalls.push(input);
        const queued = session.promptQueue.shift();
        return { data: queued ?? undefined, error: undefined };
      },
      prompt: async (input: unknown) => {
        session.promptCalls.push(input);
        const queued = session.promptQueue.shift();
        if (!queued) {
          return {
            data: {
              info: { id: "assistant-msg" },
              parts: [
                {
                  type: "text",
                  text: "No response",
                  id: "part-1",
                  sessionID: sessionId,
                  messageID: "assistant-msg",
                },
              ],
            },
            error: undefined,
          };
        }
        return { data: queued, error: undefined };
      },
      abort: async (input: unknown) => {
        session.abortCalls.push(input);
        return { data: true, error: undefined };
      },
      get: async (input: unknown) => {
        session.getCalls.push(input);
        return {
          data: {
            id: sessionId,
            role: "assistant",
            time: { created: Date.parse("2026-02-17T12:00:00Z") },
          },
          error: undefined,
        };
      },
      messages: async (input: unknown) => {
        session.messagesCalls.push(input);
        return {
          data: session.messagesResponse,
          error: undefined,
        };
      },
      todo: async (input: unknown) => {
        session.todoCalls.push(input);
        if (session.todoResult.mode === "throw") {
          throw session.todoResult.error;
        }
        if (session.todoResult.mode === "api_error") {
          return {
            data: undefined,
            error: session.todoResult.error,
            response: {
              status: session.todoResult.status ?? 500,
              statusText: session.todoResult.statusText ?? "",
            },
          };
        }
        return {
          data: session.todoResult.data,
          error: undefined,
          response: {
            status: 200,
            statusText: "OK",
          },
        };
      },
    },
    permission: {
      reply: async (input: unknown) => {
        permission.replyCalls.push(input);
        return { data: true, error: undefined };
      },
    },
    question: {
      reply: async (input: unknown) => {
        question.replyCalls.push(input);
        return { data: true, error: undefined };
      },
    },
    config: {
      providers: async () => {
        return {
          data: providerResponse,
          error: undefined,
        };
      },
    },
    app: {
      agents: async () => {
        if (agentsResult?.mode === "throw") {
          throw agentsResult.error;
        }
        return {
          data:
            agentsResult?.mode === "success"
              ? agentsResult.data
              : agentsResult?.mode === "api_error"
                ? undefined
                : agentsResponse,
          error: agentsResult?.mode === "api_error" ? agentsResult.error : undefined,
        };
      },
    },
    tool: {
      ids: async (input: unknown) => {
        tool.idsCalls.push(input);
        return {
          data: toolIdsResponse,
          error: undefined,
        };
      },
      list: async (input: unknown) => {
        tool.listCalls.push(input);
        return {
          data: modelToolsResponse,
          error: undefined,
        };
      },
    },
    mcp: {
      status: async (input: unknown) => {
        mcp.statusCalls.push(input);
        return {
          data: mcpStatusResponse,
          error: undefined,
        };
      },
      connect: async (input: unknown) => {
        mcp.connectCalls.push(input);
        return {
          data: true,
          error: undefined,
        };
      },
    },
    event: {
      subscribe: async () => {
        async function* iterator(): AsyncGenerator<Event> {
          for (const event of stream.events) {
            yield event;
          }
        }
        return { stream: iterator() };
      },
    },
  } as unknown as OpencodeClient;

  return { client, session, tool, mcp, permission, question, stream };
};

const startDefaultSession = async (
  adapter: OpencodeSdkAdapter,
  sessionId = "session-1",
  role: "spec" | "planner" | "build" | "qa" = "spec",
  model?: {
    providerId: string;
    modelId: string;
    variant?: string;
    profileId?: string;
  },
): Promise<void> => {
  const scenario =
    role === "qa"
      ? "qa_review"
      : role === "planner"
        ? "planner_initial"
        : role === "build"
          ? "build_implementation_start"
          : "spec_initial";
  await adapter.startSession({
    sessionId,
    repoPath: "/repo",
    workingDirectory: "/repo",
    taskId: "task-1",
    runtimeKind: "opencode",
    role,
    scenario,
    systemPrompt: "system prompt",
    runtimeConnection: defaultRuntimeConnection,
    ...(model ? { model } : {}),
  });
};

const defaultLoadSessionTodosInput = {
  runtimeConnection: defaultRuntimeConnection,
  externalSessionId: "session-opencode-1",
};

const createLoadSessionTodosHarness = (
  mockInput: MakeMockClientInput,
): {
  adapter: OpencodeSdkAdapter;
  session: MockSession;
  createClientCalls: unknown[];
} => {
  const createClientCalls: unknown[] = [];
  const mock = makeMockClient(mockInput);
  const adapter = new OpencodeSdkAdapter({
    createClient: (input) => {
      createClientCalls.push(input);
      return mock.client;
    },
    now: () => "2026-02-17T12:00:00Z",
  });

  return { adapter, session: mock.session, createClientCalls };
};

describe("OpencodeSdkAdapter", () => {
  test("startSession emits session_started and returns summary", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: unknown[] = [];
    adapter.subscribeEvents("session-1", (event) => events.push(event));

    const summary = await adapter.startSession({
      sessionId: "session-1",
      repoPath: "/repo",
      workingDirectory: "/repo",
      taskId: "task-1",
      runtimeKind: "opencode",
      role: "planner",
      scenario: "planner_initial",
      systemPrompt: "system",
      runtimeConnection: {
        endpoint: "http://127.0.0.1:12000",
        workingDirectory: "/repo",
      },
    });

    expect(summary.sessionId).toBe("session-1");
    expect(summary.externalSessionId).toBe("session-opencode-1");
    expect(summary.role).toBe("planner");
    expect(mock.session.createCalls).toHaveLength(1);
    expect(mock.session.createCalls[0]).toMatchObject({
      directory: "/repo",
      title: "PLANNER task-1",
    });
    const createInput = mock.session.createCalls[0] as {
      permission?: Array<{ permission: string; pattern: string; action: string }>;
    };
    const permissionRules = createInput.permission ?? [];
    const deniedNativeTools = [
      "edit",
      "write",
      "apply_patch",
      "ast_grep_replace",
      "lsp_rename",
    ] as const;
    for (const toolName of deniedNativeTools) {
      expect(permissionRules).toContainEqual({
        permission: toolName,
        pattern: "*",
        action: "deny",
      });
    }
    expect(permissionRules).not.toContainEqual({
      permission: "bash",
      pattern: "*",
      action: "deny",
    });
    expect(permissionRules).toContainEqual({
      permission: "openducktor_odt_*",
      pattern: "*",
      action: "deny",
    });
    expect(permissionRules).toContainEqual({
      permission: "openducktor_odt_read_task",
      pattern: "*",
      action: "allow",
    });
    expect(permissionRules).toContainEqual({
      permission: "openducktor_odt_set_plan",
      pattern: "*",
      action: "allow",
    });
    expect(permissionRules).not.toContainEqual({
      permission: "openducktor_odt_set_spec",
      pattern: "*",
      action: "allow",
    });
    expect(events).toHaveLength(1);
    expect((events[0] as { type: string }).type).toBe("session_started");
  });

  test("sendUserMessage forwards selected model with openducktor role-scoped tools", async () => {
    const mock = makeMockClient({
      promptQueue: [
        {
          info: {
            id: "assistant-1",
            tokens: {
              input: 900,
              output: 200,
            },
          },
          parts: [
            {
              id: "text-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-1",
              type: "text",
              text: "Specification updated.",
            } as Part,
          ],
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "session-1", "spec");

    const events: Array<{ type: string }> = [];
    adapter.subscribeEvents("session-1", (event) => events.push(event as { type: string }));

    await adapter.sendUserMessage({
      sessionId: "session-1",
      content: "Write and persist spec",
      model: {
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "hephaestus",
      },
    });

    expect(mock.session.promptCalls).toHaveLength(1);
    expect(mock.session.promptCalls[0]).toMatchObject({
      sessionID: "session-opencode-1",
      directory: "/repo",
      system: "system prompt",
      model: {
        providerID: "openai",
        modelID: "gpt-5",
      },
      variant: "high",
      agent: "hephaestus",
      tools: {
        edit: false,
        write: false,
        apply_patch: false,
        ast_grep_replace: false,
        lsp_rename: false,
        openducktor_odt_read_task: true,
        openducktor_odt_set_spec: true,
        openducktor_odt_set_plan: false,
        openducktor_odt_build_blocked: false,
        openducktor_odt_build_resumed: false,
        openducktor_odt_build_completed: false,
        openducktor_odt_qa_approved: false,
        openducktor_odt_qa_rejected: false,
      },
      parts: [{ type: "text", text: "Write and persist spec" }],
    });
    expect(mock.tool.idsCalls).toEqual([{ directory: "/repo" }]);
    expect(mock.mcp.statusCalls).toEqual([{ directory: "/repo" }]);
    expect(events.some((event) => event.type === "assistant_message")).toBe(true);
    const assistantMessage = events.find((event) => event.type === "assistant_message");
    expect(assistantMessage).toMatchObject({
      type: "assistant_message",
      messageId: "assistant-1",
      totalTokens: 1_100,
    });
    expect(events.some((event) => event.type === "session_idle")).toBe(true);
  });

  test("sendUserMessage falls back to part messageID when response info.id is absent", async () => {
    const mock = makeMockClient({
      promptQueue: [
        {
          info: {
            tokens: {
              input: 100,
              output: 50,
            },
          },
          parts: [
            {
              id: "text-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-from-part-id",
              type: "text",
              text: "Recovered from part id.",
            } as Part,
          ],
        } as { info: { [key: string]: unknown }; parts: Part[] },
      ],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "session-1", "spec");

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-1", (event) => events.push(event));

    await adapter.sendUserMessage({
      sessionId: "session-1",
      content: "Recover ids",
    });

    const assistantMessage = events.find((event) => event.type === "assistant_message");
    expect(assistantMessage).toMatchObject({
      type: "assistant_message",
      messageId: "assistant-from-part-id",
      message: "Recovered from part id.",
      totalTokens: 150,
    });
  });

  test("updateSessionModel refreshes the adapter session model used for subsequent prompts", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "session-1", "spec");
    adapter.updateSessionModel({
      sessionId: "session-1",
      model: {
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "Hephaestus",
      },
    });

    await adapter.sendUserMessage({
      sessionId: "session-1",
      content: "Continue",
    });

    expect(mock.session.promptCalls).toHaveLength(1);
    expect(mock.session.promptCalls[0]).toMatchObject({
      model: {
        providerID: "openai",
        modelID: "gpt-5",
      },
      variant: "high",
      agent: "Hephaestus",
    });
  });

  test("sendUserMessage caches workflow tool discovery across prompts for the same model", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "session-1", "spec");

    const selectedModel = {
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
    } as const;

    await adapter.sendUserMessage({
      sessionId: "session-1",
      content: "First message",
      model: selectedModel,
    });
    await adapter.sendUserMessage({
      sessionId: "session-1",
      content: "Second message",
      model: selectedModel,
    });

    expect(mock.tool.idsCalls).toEqual([{ directory: "/repo" }]);
    expect(mock.mcp.statusCalls).toEqual([{ directory: "/repo" }]);
    expect(mock.session.promptCalls).toHaveLength(2);
  });

  test("sendUserMessage falls back to the session model for model-scoped tool discovery", async () => {
    const mock = makeMockClient({
      toolIdsResponse: ["bash", "read", "glob"],
      modelToolsResponse: [{ id: "openducktor_odt_read_task" }, { id: "openducktor_odt_set_spec" }],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "session-1", "spec", {
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
    });

    await adapter.sendUserMessage({
      sessionId: "session-1",
      content: "Use the saved model",
    });

    expect(mock.tool.listCalls).toEqual([
      {
        directory: "/repo",
        provider: "openai",
        model: "gpt-5",
      },
    ]);
    expect(mock.session.promptCalls[0]).toMatchObject({
      tools: {
        edit: false,
        write: false,
        apply_patch: false,
        ast_grep_replace: false,
        lsp_rename: false,
        openducktor_odt_read_task: true,
        openducktor_odt_set_spec: true,
      },
    });
  });

  test("loadSessionHistory preserves message model metadata and maps streamed parts", async () => {
    const mock = makeMockClient({
      messagesResponse: [
        {
          info: {
            id: "user-1",
            role: "user",
            agent: "Hephaestus",
            model: {
              providerID: "openai",
              modelID: "gpt-5",
            },
            variant: "high",
            time: { created: Date.parse("2026-02-17T11:59:00Z") },
          },
          parts: [
            {
              id: "text-user-1",
              sessionID: "session-opencode-1",
              messageID: "user-1",
              type: "text",
              text: "Use the selected agent",
              time: { start: Date.now(), end: Date.now() },
            } as Part,
          ],
        },
        {
          info: {
            id: "assistant-1",
            role: "assistant",
            providerID: "openai",
            modelID: "gpt-5",
            agent: "Hephaestus",
            variant: "high",
            tokens: {
              input: 2_000,
              output: 450,
            },
            time: { created: Date.parse("2026-02-17T12:00:00Z") },
          },
          parts: [
            {
              id: "reason-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-1",
              type: "reasoning",
              text: "Reasoning block",
              time: { start: Date.now(), end: Date.now() },
            } as Part,
            {
              id: "text-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-1",
              type: "text",
              text: "Final answer",
              time: { start: Date.now(), end: Date.now() },
            } as Part,
          ],
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const history = await adapter.loadSessionHistory({
      runtimeConnection: defaultRuntimeConnection,
      externalSessionId: "session-opencode-1",
      limit: 100,
    });

    expect(history).toHaveLength(2);
    expect(history[0]?.text).toBe("Use the selected agent");
    expect(history[0]?.model).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      profileId: "Hephaestus",
      variant: "high",
    });
    expect(history[1]?.text).toBe("Final answer");
    expect(history[1]?.totalTokens).toBe(2_450);
    expect(history[1]?.model).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      profileId: "Hephaestus",
      variant: "high",
    });
    expect(history[1]?.parts).toHaveLength(1);
    expect(history[1]?.parts[0]).toMatchObject({
      kind: "reasoning",
      text: "Reasoning block",
    });
  });

  test("maps message.updated events into assistant parts and assistant message", async () => {
    const streamEvents: Event[] = [
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-1",
            role: "assistant",
            sessionID: "session-opencode-1",
            providerID: "openai",
            modelID: "gpt-5",
            agent: "Hephaestus",
            variant: "high",
            tokens: {
              input: 1_200,
              output: 300,
              reasoning: 90,
            },
            time: {
              completed: Date.parse("2026-02-17T12:00:05Z"),
            },
            finish: "stop",
          },
          parts: [
            {
              id: "reason-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-1",
              type: "reasoning",
              text: "Reasoning trace",
              time: { start: Date.now(), end: Date.now() },
            },
            {
              id: "text-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-1",
              type: "text",
              text: "Assistant output",
              time: { start: Date.now(), end: Date.now() },
            },
          ],
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({
      streamEvents,
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-1", (event) => {
      events.push(event);
    });

    await startDefaultSession(adapter, "session-1", "spec");
    await flushAsync();

    const partEvents = events.filter((entry) => entry.type === "assistant_part");
    const messageEvents = events.filter((entry) => entry.type === "assistant_message");

    expect(partEvents.length).toBeGreaterThanOrEqual(2);
    expect(messageEvents).toHaveLength(1);
    expect(messageEvents[0]).toMatchObject({
      type: "assistant_message",
      messageId: "assistant-1",
      message: "Assistant output",
      totalTokens: 1_590,
      model: {
        providerId: "openai",
        modelId: "gpt-5",
        profileId: "Hephaestus",
        variant: "high",
      },
    });
  });

  test("includes step-finish total tokens on assistant part events", async () => {
    const streamEvents: Event[] = [
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-1",
            role: "assistant",
            sessionID: "session-opencode-1",
          },
          parts: [
            {
              id: "step-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-1",
              type: "step-finish",
              reason: "tool-calls",
              tokens: {
                input: 898,
                output: 245,
                reasoning: 0,
                cache: {
                  read: 0,
                  write: 33_879,
                },
              },
            },
          ],
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({
      streamEvents,
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-1", (event) => {
      events.push(event);
    });

    await startDefaultSession(adapter, "session-1", "spec");
    await flushAsync();

    expect(events).toContainEqual({
      type: "assistant_part",
      sessionId: "session-1",
      timestamp: "2026-02-17T12:00:00Z",
      part: {
        kind: "step",
        messageId: "assistant-1",
        partId: "step-1",
        phase: "finish",
        reason: "tool-calls",
        totalTokens: 35_022,
      },
    });
  });

  test("maps completed MCP tool part with isError=true as error status", async () => {
    const streamEvents: Event[] = [
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-1",
            role: "assistant",
            sessionID: "session-opencode-1",
            time: {
              completed: Date.parse("2026-02-17T12:00:05Z"),
            },
            finish: "tool-calls",
          },
          parts: [
            {
              id: "tool-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-1",
              callID: "call-1",
              type: "tool",
              tool: "openducktor_odt_set_spec",
              state: {
                status: "completed",
                input: { taskId: "facebook-oauth" },
                output: {
                  content: [{ type: "text", text: "Task not found: facebook-oauth" }],
                  isError: true,
                },
              },
            },
          ],
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({
      streamEvents,
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-1", (event) => {
      events.push(event);
    });

    await startDefaultSession(adapter, "session-1", "spec");
    await flushAsync();

    const toolPartEvent = events.find((entry) => {
      if (entry.type !== "assistant_part") {
        return false;
      }
      const part = entry.part;
      return part.kind === "tool";
    });

    expect(toolPartEvent).toBeDefined();
    if (
      !toolPartEvent ||
      toolPartEvent.type !== "assistant_part" ||
      toolPartEvent.part.kind !== "tool"
    ) {
      throw new Error("Expected tool part event");
    }
    expect(toolPartEvent.part.status).toBe("error");
    expect(toolPartEvent.part.error).toContain("Task not found");
  });

  test("maps flattened MCP tool error JSON output as error status", async () => {
    const streamEvents: Event[] = [
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-1",
            role: "assistant",
            sessionID: "session-opencode-1",
            time: {
              completed: Date.parse("2026-02-17T12:00:05Z"),
            },
            finish: "tool-calls",
          },
          parts: [
            {
              id: "tool-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-1",
              callID: "call-1",
              type: "tool",
              tool: "openducktor_odt_set_plan",
              state: {
                status: "completed",
                input: { taskId: "facebook-oauth" },
                output: JSON.stringify(
                  {
                    ok: false,
                    error: {
                      code: "ODT_TOOL_EXECUTION_ERROR",
                      message: "Only epics can receive subtask proposals during planning.",
                    },
                  },
                  null,
                  2,
                ),
              },
            },
          ],
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({
      streamEvents,
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-1", (event) => {
      events.push(event);
    });

    await startDefaultSession(adapter, "session-1", "planner");
    await flushAsync();

    const toolPartEvent = events.find((entry) => {
      if (entry.type !== "assistant_part") {
        return false;
      }
      const part = entry.part;
      return part.kind === "tool";
    });

    expect(toolPartEvent).toBeDefined();
    if (
      !toolPartEvent ||
      toolPartEvent.type !== "assistant_part" ||
      toolPartEvent.part.kind !== "tool"
    ) {
      throw new Error("Expected tool part event");
    }

    expect(toolPartEvent.part.status).toBe("error");
    expect(toolPartEvent.part.error).toContain(
      "Only epics can receive subtask proposals during planning.",
    );
  });

  test("maps todowrite tool part with ended timing to completed even when status is pending", async () => {
    const streamEvents: Event[] = [
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-1",
            role: "assistant",
            sessionID: "session-opencode-1",
          },
          parts: [
            {
              id: "tool-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-1",
              callID: "call-1",
              type: "tool",
              tool: "todowrite",
              state: {
                status: "pending",
                input: {
                  todos: [
                    {
                      id: "todo-1",
                      content: "A",
                    },
                  ],
                },
                time: {
                  start: 100,
                  end: 175,
                },
              },
            },
          ],
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({
      streamEvents,
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-1", (event) => {
      events.push(event);
    });

    await startDefaultSession(adapter, "session-1", "spec");
    await flushAsync();

    const toolPartEvent = events.find((entry) => {
      if (entry.type !== "assistant_part") {
        return false;
      }
      return entry.part.kind === "tool" && entry.part.tool === "todowrite";
    });

    expect(toolPartEvent).toBeDefined();
    if (
      !toolPartEvent ||
      toolPartEvent.type !== "assistant_part" ||
      toolPartEvent.part.kind !== "tool"
    ) {
      throw new Error("Expected todowrite tool part event");
    }

    expect(toolPartEvent.part.status).toBe("completed");
    expect(toolPartEvent.part.startedAtMs).toBe(100);
    expect(toolPartEvent.part.endedAtMs).toBe(175);
  });

  test("maps todo.updated events into session_todos_updated", async () => {
    const streamEvents: Event[] = [
      {
        type: "todo.updated",
        properties: {
          sessionID: "session-opencode-1",
          todos: [
            {
              id: "todo-1",
              content: "Inspect auth flow",
              status: "in_progress",
              priority: "high",
            },
            {
              id: "todo-2",
              content: "Write spec",
              status: "completed",
              priority: "medium",
            },
          ],
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({
      streamEvents,
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-1", (event) => {
      events.push(event);
    });

    await startDefaultSession(adapter, "session-1", "spec");
    await flushAsync();

    const todoEvent = events.find((entry) => entry.type === "session_todos_updated");
    expect(todoEvent).toBeDefined();
    if (!todoEvent || todoEvent.type !== "session_todos_updated") {
      throw new Error("Expected session_todos_updated event");
    }
    expect(todoEvent.todos).toEqual([
      {
        id: "todo-1",
        content: "Inspect auth flow",
        status: "in_progress",
        priority: "high",
      },
      {
        id: "todo-2",
        content: "Write spec",
        status: "completed",
        priority: "medium",
      },
    ]);
  });

  test("maps todo.updated events with missing id/status aliases", async () => {
    const streamEvents: Event[] = [
      {
        type: "todo.updated",
        properties: {
          sessionID: "session-opencode-1",
          todos: [
            {
              content: "First",
              status: "active",
              priority: "low",
            },
            {
              text: "Second",
              completed: true,
            },
          ],
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({
      streamEvents,
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-1", (event) => {
      events.push(event);
    });

    await startDefaultSession(adapter, "session-1", "spec");
    await flushAsync();

    const todoEvent = events.find((entry) => entry.type === "session_todos_updated");
    expect(todoEvent).toBeDefined();
    if (!todoEvent || todoEvent.type !== "session_todos_updated") {
      throw new Error("Expected session_todos_updated event");
    }
    expect(todoEvent.todos).toEqual([
      {
        id: "todo:0",
        content: "First",
        status: "in_progress",
        priority: "low",
      },
      {
        id: "todo:1",
        content: "Second",
        status: "completed",
        priority: "medium",
      },
    ]);
  });

  test("loadSessionTodos reads /session/:id/todo and normalizes entries", async () => {
    const mock = makeMockClient({
      todoResult: {
        mode: "success",
        data: [
          {
            id: "todo-1",
            content: "Inspect auth flow",
            status: "in_progress",
            priority: "high",
          },
          {
            id: "todo-2",
            content: "Write spec",
            status: "unexpected_status",
            priority: "unexpected_priority",
          },
        ],
      },
    });
    const createClientCalls: unknown[] = [];
    const adapter = new OpencodeSdkAdapter({
      createClient: (input) => {
        createClientCalls.push(input);
        return mock.client;
      },
      now: () => "2026-02-17T12:00:00Z",
    });

    const todos = await adapter.loadSessionTodos({
      runtimeKind: "opencode",
      runtimeConnection: defaultRuntimeConnection,
      externalSessionId: "session-opencode-1",
    });

    expect(mock.session.todoCalls).toEqual([
      {
        sessionID: "session-opencode-1",
        directory: "/repo",
      },
    ]);
    expect(createClientCalls).toEqual([
      {
        runtimeEndpoint: "http://127.0.0.1:12345",
        workingDirectory: "/repo",
      },
    ]);
    expect(todos).toEqual([
      {
        id: "todo-1",
        content: "Inspect auth flow",
        status: "in_progress",
        priority: "high",
      },
      {
        id: "todo-2",
        content: "Write spec",
        status: "pending",
        priority: "medium",
      },
    ]);
  });

  test("loadSessionTodos rejects client errors with actionable status context", async () => {
    const { adapter, session, createClientCalls } = createLoadSessionTodosHarness({
      todoResult: {
        mode: "api_error",
        error: {
          message: "Service Unavailable",
        },
        status: 503,
        statusText: "Service Unavailable",
      },
    });

    await expect(adapter.loadSessionTodos(defaultLoadSessionTodosInput)).rejects.toThrow(
      "OpenCode request failed: load session todos (503 Service Unavailable): Service Unavailable",
    );
    expect(session.todoCalls).toEqual([
      {
        sessionID: "session-opencode-1",
        directory: "/repo",
      },
    ]);
    expect(createClientCalls).toEqual([
      {
        runtimeEndpoint: "http://127.0.0.1:12345",
        workingDirectory: "/repo",
      },
    ]);
  });

  test("loadSessionTodos rejects thrown request errors", async () => {
    const requestError = new Error("network down");
    const { adapter, session, createClientCalls } = createLoadSessionTodosHarness({
      todoResult: {
        mode: "throw",
        error: requestError,
      },
    });

    await expect(adapter.loadSessionTodos(defaultLoadSessionTodosInput)).rejects.toThrow(
      "OpenCode request failed: load session todos: network down",
    );
    expect(session.todoCalls).toEqual([
      {
        sessionID: "session-opencode-1",
        directory: "/repo",
      },
    ]);
    expect(createClientCalls).toEqual([
      {
        runtimeEndpoint: "http://127.0.0.1:12345",
        workingDirectory: "/repo",
      },
    ]);
  });

  test("loadSessionTodos rejects blank workingDirectory in runtimeConnection", async () => {
    const mock = makeMockClient({
      todoResult: {
        mode: "success",
        data: [],
      },
    });
    const createClientCalls: unknown[] = [];
    const adapter = new OpencodeSdkAdapter({
      createClient: (input) => {
        createClientCalls.push(input);
        return mock.client;
      },
      now: () => "2026-02-17T12:00:00Z",
    });

    await expect(
      adapter.loadSessionTodos({
        runtimeKind: "opencode",
        runtimeConnection: {
          endpoint: "http://127.0.0.1:12345",
          workingDirectory: "   ",
        },
        externalSessionId: "session-opencode-1",
      }),
    ).rejects.toThrow("Runtime connection workingDirectory is required to load session todos.");

    expect(mock.session.todoCalls).toEqual([]);
    expect(createClientCalls).toEqual([]);
  });

  test("loadSessionTodos trims workingDirectory before forwarding directory", async () => {
    const mock = makeMockClient({
      todoResult: {
        mode: "success",
        data: [],
      },
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const todos = await adapter.loadSessionTodos({
      runtimeKind: "opencode",
      runtimeConnection: {
        endpoint: "http://127.0.0.1:12345",
        workingDirectory: "  /repo  ",
      },
      externalSessionId: "session-opencode-1",
    });

    expect(todos).toEqual([]);
    expect(mock.session.todoCalls).toEqual([
      {
        sessionID: "session-opencode-1",
        directory: "/repo",
      },
    ]);
  });

  test("listAvailableModels returns provider models and primary agents", async () => {
    const mock = makeMockClient({
      agentsResponse: [
        {
          name: "Hephaestus",
          description: "Deep agent",
          mode: "primary",
          hidden: false,
          native: false,
          color: "#f59e0b",
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const catalog = await adapter.listAvailableModels({
      runtimeKind: "opencode",
      runtimeConnection: defaultRuntimeConnection,
    });

    expect(catalog.models).toHaveLength(1);
    expect(catalog.models[0]).toMatchObject({
      providerId: "openai",
      modelId: "gpt-5",
      contextWindow: 400_000,
      outputLimit: 32_000,
    });
    expect(catalog.profiles ?? []).toHaveLength(1);
    expect(catalog.profiles?.[0]).toMatchObject({
      id: "Hephaestus",
      label: "Hephaestus",
      mode: "primary",
      color: "#f59e0b",
    });
  });

  test("listAvailableModels preserves agent names exactly as reported by opencode", async () => {
    const mock = makeMockClient({
      agentsResponse: [
        {
          name: "Hephaestus (Deep Agent)",
          description: "Deep agent",
          mode: "primary",
          hidden: false,
          native: false,
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const catalog = await adapter.listAvailableModels({
      runtimeKind: "opencode",
      runtimeConnection: defaultRuntimeConnection,
    });

    expect(catalog.profiles).toEqual([
      expect.objectContaining({
        id: "Hephaestus (Deep Agent)",
        label: "Hephaestus (Deep Agent)",
        mode: "primary",
      }),
    ]);
  });

  test("listAvailableModels rejects profile lookup failures instead of masking them", async () => {
    const mock = makeMockClient({
      agentsResult: {
        mode: "api_error",
        error: {
          message: "agent index unavailable",
        },
      },
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await expect(
      adapter.listAvailableModels({
        runtimeKind: "opencode",
        runtimeConnection: defaultRuntimeConnection,
      }),
    ).rejects.toThrow("agent index unavailable");
  });

  test("listAvailableToolIds returns normalized tool IDs", async () => {
    const mock = makeMockClient({
      toolIdsResponse: ["odt_read_task", " invalid ", "", " odt_set_spec "],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const tools = await adapter.listAvailableToolIds({
      runtimeEndpoint: "http://127.0.0.1:12345",
      workingDirectory: "/repo",
    });

    expect(mock.tool.idsCalls).toEqual([{ directory: "/repo" }]);
    expect(tools).toEqual(["odt_read_task", "odt_set_spec"]);
  });

  test("getMcpStatus returns normalized server status map", async () => {
    const mock = makeMockClient({
      mcpStatusResponse: {
        openducktor: { status: "connected" },
        vibe_kanban: { status: "failed", error: "Connection closed" },
      },
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const status = await adapter.getMcpStatus({
      runtimeEndpoint: "http://127.0.0.1:12345",
      workingDirectory: "/repo",
    });

    expect(mock.mcp.statusCalls).toEqual([{ directory: "/repo" }]);
    expect(status).toEqual({
      openducktor: { status: "connected" },
      vibe_kanban: { status: "failed", error: "Connection closed" },
    });
  });

  test("connectMcpServer forwards server name and directory", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await adapter.connectMcpServer({
      runtimeEndpoint: "http://127.0.0.1:12345",
      workingDirectory: "/repo",
      name: "openducktor",
    });

    expect(mock.mcp.connectCalls).toEqual([{ directory: "/repo", name: "openducktor" }]);
  });

  test("stopSession aborts session and emits finished event", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });
    await startDefaultSession(adapter);

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-1", (event) => {
      events.push(event);
    });

    await adapter.stopSession("session-1");

    expect(mock.session.abortCalls).toHaveLength(1);
    expect(events.some((event) => event.type === "session_finished")).toBe(true);
  });
});
