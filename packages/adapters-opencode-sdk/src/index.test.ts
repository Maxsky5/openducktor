import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openblueprint/core";
import type { Event, OpencodeClient, Part } from "@opencode-ai/sdk/v2";
import { OpencodeSdkAdapter } from "./index";

type MockSession = {
  createCalls: unknown[];
  promptCalls: unknown[];
  abortCalls: unknown[];
  getCalls: unknown[];
  messagesCalls: unknown[];
  promptQueue: Array<{ info: { id: string }; parts: Part[] }>;
  messagesResponse: Array<{
    info: { id: string; role: "user" | "assistant"; time: { created: number } };
    parts: Part[];
  }>;
};

type MockTool = {
  idsCalls: unknown[];
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

const makeMockClient = ({
  sessionId = "session-opencode-1",
  streamEvents = [],
  promptQueue = [],
  messagesResponse = [],
  providerResponse = {
    providers: [
      {
        id: "openai",
        name: "OpenAI",
        models: {
          "gpt-5": {
            name: "GPT-5",
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
  toolIdsResponse = [],
  mcpStatusResponse = {},
}: {
  sessionId?: string;
  streamEvents?: Event[];
  promptQueue?: Array<{ info: { id: string }; parts: Part[] }>;
  messagesResponse?: Array<{
    info: { id: string; role: "user" | "assistant"; time: { created: number } };
    parts: Part[];
  }>;
  providerResponse?: unknown;
  agentsResponse?: unknown;
  toolIdsResponse?: unknown;
  mcpStatusResponse?: unknown;
}): {
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
    promptQueue: [...promptQueue],
    messagesResponse: [...messagesResponse],
  };
  const permission: MockPermission = {
    replyCalls: [],
  };
  const tool: MockTool = {
    idsCalls: [],
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
        return {
          data: agentsResponse,
          error: undefined,
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
    role,
    scenario,
    systemPrompt: "system prompt",
    baseUrl: "http://127.0.0.1:12345",
  });
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
      role: "planner",
      scenario: "planner_initial",
      systemPrompt: "system",
      baseUrl: "http://127.0.0.1:12000",
    });

    expect(summary.sessionId).toBe("session-1");
    expect(summary.externalSessionId).toBe("session-opencode-1");
    expect(summary.role).toBe("planner");
    expect(events).toHaveLength(1);
    expect((events[0] as { type: string }).type).toBe("session_started");
  });

  test("sendUserMessage forwards selected model and role-scoped odt tools", async () => {
    const mock = makeMockClient({
      promptQueue: [
        {
          info: { id: "assistant-1" },
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
        opencodeAgent: "hephaestus",
      },
    });

    expect(mock.session.promptCalls).toHaveLength(1);
    expect(mock.session.promptCalls[0]).toMatchObject({
      model: {
        providerID: "openai",
        modelID: "gpt-5",
      },
      variant: "high",
      agent: "hephaestus",
      tools: {
        odt_read_task: true,
        odt_set_spec: true,
        odt_set_plan: false,
        odt_build_blocked: false,
        odt_build_resumed: false,
        odt_build_completed: false,
        odt_qa_approved: false,
        odt_qa_rejected: false,
        openducktor_odt_read_task: true,
        openducktor_odt_set_spec: true,
        openducktor_odt_set_plan: false,
      },
    });
    expect(events.some((event) => event.type === "assistant_message")).toBe(true);
    expect(events.some((event) => event.type === "session_idle")).toBe(true);
  });

  test("sendUserMessage applies runtime workflow aliases when available", async () => {
    const mock = makeMockClient({
      toolIdsResponse: ["customprefix_odt_set_spec", "customprefix_odt_set_plan"],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "session-1", "spec");

    await adapter.sendUserMessage({
      sessionId: "session-1",
      content: "Write and persist spec",
    });

    expect(mock.session.promptCalls).toHaveLength(1);
    const tools = (mock.session.promptCalls[0] as { tools?: Record<string, boolean> }).tools;
    expect(tools).toMatchObject({
      customprefix_odt_set_spec: true,
      customprefix_odt_set_plan: false,
    });
  });

  test("loadSessionHistory preserves assistant text and maps streamed parts", async () => {
    const mock = makeMockClient({
      messagesResponse: [
        {
          info: {
            id: "assistant-1",
            role: "assistant",
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
      baseUrl: "http://127.0.0.1:12345",
      workingDirectory: "/repo",
      externalSessionId: "session-opencode-1",
      limit: 100,
    });

    expect(history).toHaveLength(1);
    expect(history[0]?.text).toBe("Final answer");
    expect(history[0]?.parts).toHaveLength(1);
    expect(history[0]?.parts[0]).toMatchObject({
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
    await Bun.sleep(0);

    const partEvents = events.filter((entry) => entry.type === "assistant_part");
    const messageEvents = events.filter((entry) => entry.type === "assistant_message");

    expect(partEvents.length).toBeGreaterThanOrEqual(2);
    expect(messageEvents).toHaveLength(1);
    expect(messageEvents[0]).toMatchObject({
      type: "assistant_message",
      message: "Assistant output",
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
    await Bun.sleep(0);

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
    await Bun.sleep(0);

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
    await Bun.sleep(0);

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
    await Bun.sleep(0);

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
    const originalFetch = globalThis.fetch;
    const fetchCalls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      fetchCalls.push(typeof input === "string" ? input : input.toString());
      return new Response(
        JSON.stringify([
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
        ]),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }) as typeof fetch;

    try {
      const mock = makeMockClient({});
      const adapter = new OpencodeSdkAdapter({
        createClient: () => mock.client,
        now: () => "2026-02-17T12:00:00Z",
      });

      const todos = await adapter.loadSessionTodos({
        baseUrl: "http://127.0.0.1:12345",
        workingDirectory: "/repo",
        externalSessionId: "session-opencode-1",
      });

      expect(fetchCalls).toEqual([
        "http://127.0.0.1:12345/session/session-opencode-1/todo?directory=%2Frepo",
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
    } finally {
      globalThis.fetch = originalFetch;
    }
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
      baseUrl: "http://127.0.0.1:12345",
      workingDirectory: "/repo",
    });

    expect(catalog.models).toHaveLength(1);
    expect(catalog.models[0]).toMatchObject({
      providerId: "openai",
      modelId: "gpt-5",
    });
    expect(catalog.agents).toHaveLength(1);
    expect(catalog.agents[0]).toMatchObject({
      name: "Hephaestus",
      mode: "primary",
      color: "#f59e0b",
    });
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
      baseUrl: "http://127.0.0.1:12345",
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
      baseUrl: "http://127.0.0.1:12345",
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
      baseUrl: "http://127.0.0.1:12345",
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
