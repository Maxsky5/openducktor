import { describe, expect, test } from "bun:test";
import type { Event, OpencodeClient, Part } from "@opencode-ai/sdk/v2";
import type { AgentEvent } from "@openducktor/core";
import { OpencodeSdkAdapter } from "./index";
import type { SessionRecord } from "./types";
import { buildQueuedRequestSignature } from "./user-message-signatures";

const flushAsync = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const buildQueuedSignature = (text: string): string =>
  buildQueuedRequestSignature([{ kind: "text", text }]);
const defaultRuntimeConnection = {
  type: "local_http",
  endpoint: "http://127.0.0.1:12345",
  workingDirectory: "/repo",
} as const;

const DEFAULT_ODT_RUNTIME_TOOL_IDS = [
  "odt_read_task",
  "odt_read_task_documents",
  "odt_set_spec",
  "odt_set_plan",
  "odt_build_blocked",
  "odt_build_resumed",
  "odt_build_completed",
  "odt_set_pull_request",
  "odt_qa_approved",
  "odt_qa_rejected",
  "openducktor_odt_read_task",
  "openducktor_odt_read_task_documents",
  "openducktor_odt_set_spec",
  "openducktor_odt_set_plan",
  "openducktor_odt_build_blocked",
  "openducktor_odt_build_resumed",
  "openducktor_odt_build_completed",
  "openducktor_odt_set_pull_request",
  "openducktor_odt_qa_approved",
  "openducktor_odt_qa_rejected",
  "functions.openducktor_odt_read_task",
  "functions.openducktor_odt_read_task_documents",
  "functions.openducktor_odt_set_spec",
  "functions.openducktor_odt_set_plan",
  "functions.openducktor_odt_build_blocked",
  "functions.openducktor_odt_build_resumed",
  "functions.openducktor_odt_build_completed",
  "functions.openducktor_odt_set_pull_request",
  "functions.openducktor_odt_qa_approved",
  "functions.openducktor_odt_qa_rejected",
] as const;

type MockSession = {
  createCalls: unknown[];
  promptCalls: unknown[];
  promptAsyncCalls: unknown[];
  commandCalls: unknown[];
  abortCalls: unknown[];
  getCalls: unknown[];
  messagesCalls: unknown[];
  todoCalls: unknown[];
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

type PromptAsyncMockResult =
  | {
      mode: "success";
      data?: unknown;
    }
  | {
      mode: "api_error";
      error: unknown;
      response?: { status?: number; statusText?: string };
    }
  | {
      mode: "throw";
      error: Error;
    };

type CommandMockResult =
  | {
      mode: "success";
      data?: unknown;
    }
  | {
      mode: "api_error";
      error: unknown;
      response?: { status?: number; statusText?: string };
    }
  | {
      mode: "throw";
      error: Error;
    };

type MakeMockClientInput = {
  sessionId?: string;
  promptAsyncResult?: PromptAsyncMockResult;
  commandResult?: CommandMockResult;
  streamEvents?: Event[];
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
  promptAsyncResult = { mode: "success" },
  commandResult = { mode: "success" },
  streamEvents = [],
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
    promptAsyncCalls: [],
    commandCalls: [],
    abortCalls: [],
    getCalls: [],
    messagesCalls: [],
    todoCalls: [],
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
        session.promptAsyncCalls.push(input);
        if (promptAsyncResult.mode === "throw") {
          throw promptAsyncResult.error;
        }
        if (promptAsyncResult.mode === "api_error") {
          return {
            data: undefined,
            error: promptAsyncResult.error,
            response: promptAsyncResult.response,
          };
        }
        return { data: promptAsyncResult.data, error: undefined };
      },
      command: async (input: unknown) => {
        session.commandCalls.push(input);
        if (commandResult.mode === "throw") {
          throw commandResult.error;
        }
        if (commandResult.mode === "api_error") {
          return {
            data: undefined,
            error: commandResult.error,
            response: commandResult.response,
          };
        }
        return { data: commandResult.data, error: undefined };
      },
      prompt: async (input: unknown) => {
        session.promptCalls.push(input);
        return { data: undefined, error: undefined };
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
    global: {
      event: async (options?: { signal?: AbortSignal }) => {
        async function* iterator(): AsyncGenerator<{ directory: string; payload: Event }> {
          for (const event of stream.events) {
            if (options?.signal?.aborted) {
              return;
            }
            const directory =
              (event as Event & { properties?: { directory?: string } }).properties?.directory ??
              defaultRuntimeConnection.workingDirectory;
            yield { directory, payload: event };
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
  runtimeKind: "opencode" as const,
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
  test("shares one global event stream across sessions on the same endpoint", async () => {
    const mock = makeMockClient({});
    let listCalls = 0;
    const abortSignals: AbortSignal[] = [];
    (
      mock.client.global as unknown as {
        event: (options?: {
          signal?: AbortSignal;
        }) => Promise<{ stream: AsyncIterable<{ directory: string; payload: Event }> }>;
      }
    ).event = async (options?: { signal?: AbortSignal }) => {
      listCalls += 1;
      abortSignals.push(options?.signal ?? AbortSignal.abort());

      async function* iterator(): AsyncGenerator<{ directory: string; payload: Event }> {
        if (options?.signal?.aborted) {
          return;
        }
        await new Promise<void>((resolve) => {
          options?.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      }

      return { stream: iterator() };
    };

    const createClientCalls: unknown[] = [];
    const adapter = new OpencodeSdkAdapter({
      createClient: (input) => {
        createClientCalls.push(input);
        return mock.client;
      },
      now: () => "2026-02-17T12:00:00Z",
    });

    await adapter.startSession({
      sessionId: "session-1",
      repoPath: "/repo",
      workingDirectory: "/repo",
      taskId: "task-1",
      runtimeKind: "opencode",
      role: "build",
      scenario: "build_implementation_start",
      systemPrompt: "system",
      runtimeConnection: {
        type: "local_http",
        endpoint: "http://127.0.0.1:12000",
        workingDirectory: "/repo",
      },
    });
    await adapter.startSession({
      sessionId: "session-2",
      repoPath: "/repo",
      workingDirectory: "/other",
      taskId: "task-2",
      runtimeKind: "opencode",
      role: "qa",
      scenario: "qa_review",
      systemPrompt: "system",
      runtimeConnection: {
        type: "local_http",
        endpoint: "http://127.0.0.1:12000",
        workingDirectory: "/other",
      },
    });

    expect(listCalls).toBe(1);
    expect(abortSignals).toHaveLength(1);
    expect(createClientCalls).toEqual([
      {
        runtimeEndpoint: "http://127.0.0.1:12000",
        workingDirectory: "/repo",
      },
      {
        runtimeEndpoint: "http://127.0.0.1:12000",
      },
      {
        runtimeEndpoint: "http://127.0.0.1:12000",
        workingDirectory: "/other",
      },
    ]);

    await adapter.stopSession("session-1");
    expect(abortSignals[0]?.aborted).toBe(false);

    await adapter.stopSession("session-2");
    expect(abortSignals[0]?.aborted).toBe(true);
  });

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
        type: "local_http",
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
      permission: "openducktor_*",
      pattern: "*",
      action: "deny",
    });
    expect(permissionRules).toContainEqual({
      permission: "functions.openducktor_*",
      pattern: "*",
      action: "deny",
    });
    expect(permissionRules).toContainEqual({
      permission: "odt_create_task",
      pattern: "*",
      action: "deny",
    });
    expect(permissionRules).toContainEqual({
      permission: "odt_read_task",
      pattern: "*",
      action: "allow",
    });
    expect(permissionRules).toContainEqual({
      permission: "odt_read_task_documents",
      pattern: "*",
      action: "allow",
    });
    expect(permissionRules).toContainEqual({
      permission: "odt_set_plan",
      pattern: "*",
      action: "allow",
    });
    expect(permissionRules).toContainEqual({
      permission: "odt_set_spec",
      pattern: "*",
      action: "deny",
    });
    expect(permissionRules).toContainEqual({
      permission: "openducktor_odt_read_task",
      pattern: "*",
      action: "allow",
    });
    expect(permissionRules).toContainEqual({
      permission: "openducktor_odt_read_task_documents",
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
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "session-1", "spec");

    const events: Array<{ type: string }> = [];
    adapter.subscribeEvents("session-1", (event) => events.push(event as { type: string }));

    await adapter.sendUserMessage({
      sessionId: "session-1",
      parts: [{ kind: "text", text: "Write and persist spec" }],
      model: {
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "hephaestus",
      },
    });

    expect(mock.session.promptCalls).toHaveLength(0);
    expect(mock.session.promptAsyncCalls).toHaveLength(1);
    expect(mock.session.promptAsyncCalls[0]).toMatchObject({
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
        openducktor_odt_read_task_documents: true,
        openducktor_odt_set_spec: true,
        openducktor_odt_set_plan: false,
        openducktor_odt_build_blocked: false,
        openducktor_odt_build_resumed: false,
        openducktor_odt_build_completed: false,
        openducktor_odt_set_pull_request: false,
        openducktor_odt_qa_approved: false,
        openducktor_odt_qa_rejected: false,
      },
      parts: [{ type: "text", text: "Write and persist spec" }],
    });
    expect(mock.tool.idsCalls).toEqual([{ directory: "/repo" }]);
    expect(mock.mcp.statusCalls).toEqual([{ directory: "/repo" }]);
    expect(events.some((event) => event.type === "assistant_message")).toBe(false);
    expect(events.some((event) => event.type === "session_idle")).toBe(false);
  });

  test("sendUserMessage does not emit assistant output before stream events arrive", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "session-1", "spec");

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-1", (event) => events.push(event));

    await adapter.sendUserMessage({
      sessionId: "session-1",
      parts: [{ kind: "text", text: "Recover ids" }],
    });

    expect(events.some((event) => event.type === "assistant_part")).toBe(false);
    expect(events.some((event) => event.type === "assistant_message")).toBe(false);
    expect(events.some((event) => event.type === "session_idle")).toBe(false);
  });

  test("sendUserMessage uses the native session command endpoint for slash commands", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "session-1", "build");

    await adapter.sendUserMessage({
      sessionId: "session-1",
      parts: [
        {
          kind: "slash_command",
          command: {
            id: "compact",
            trigger: "compact",
            title: "compact",
            hints: [],
          },
        },
        { kind: "text", text: " summarize the latest session" },
      ],
      model: {
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "hephaestus",
      },
    });

    expect(mock.session.commandCalls).toEqual([
      {
        sessionID: "session-opencode-1",
        directory: "/repo",
        command: "compact",
        arguments: "summarize the latest session",
        model: "openai/gpt-5",
        variant: "high",
        agent: "hephaestus",
      },
    ]);
    expect(mock.session.promptAsyncCalls).toHaveLength(0);
  });

  test("sendUserMessage emits a busy status immediately for slash commands", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "session-1", "build");

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-1", (event) => events.push(event));

    await adapter.sendUserMessage({
      sessionId: "session-1",
      parts: [
        {
          kind: "slash_command",
          command: {
            id: "compact",
            trigger: "compact",
            title: "compact",
            hints: [],
          },
        },
      ],
    });

    expect(events).toContainEqual({
      type: "session_status",
      sessionId: "session-1",
      timestamp: "2026-02-17T12:00:00Z",
      status: { type: "busy" },
    });
  });

  test("sendUserMessage rejects slash commands that are not the first meaningful segment", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "session-1", "build");

    await expect(
      adapter.sendUserMessage({
        sessionId: "session-1",
        parts: [
          { kind: "text", text: "before " },
          {
            kind: "slash_command",
            command: {
              id: "compact",
              trigger: "compact",
              title: "compact",
              hints: [],
            },
          },
        ],
      }),
    ).rejects.toThrow("OpenCode slash commands must be the first meaningful message segment.");
    expect(mock.session.commandCalls).toHaveLength(0);
    expect(mock.session.promptAsyncCalls).toHaveLength(0);
  });

  test("sendUserMessage emits session_idle when the send fails after reporting busy", async () => {
    const mock = makeMockClient({
      commandResult: {
        mode: "api_error",
        error: new Error("bad command payload"),
        response: { status: 400, statusText: "Bad Request" },
      },
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "session-1", "build");

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-1", (event) => events.push(event));

    await expect(
      adapter.sendUserMessage({
        sessionId: "session-1",
        parts: [
          {
            kind: "slash_command",
            command: {
              id: "compact",
              trigger: "compact",
              title: "compact",
              hints: [],
            },
          },
        ],
      }),
    ).rejects.toThrow("OpenCode request failed: run slash command (400 Bad Request)");

    expect(events).toContainEqual({
      type: "session_status",
      sessionId: "session-1",
      timestamp: "2026-02-17T12:00:00Z",
      status: { type: "busy" },
    });
    expect(events).toContainEqual({
      type: "session_idle",
      sessionId: "session-1",
      timestamp: "2026-02-17T12:00:00Z",
    });
  });

  test("sendUserMessage resets session activity so the next stream idle can settle the turn", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "session-1", "spec");

    const sessions = (
      adapter as unknown as {
        sessions: Map<string, { hasIdleSinceActivity: boolean }>;
      }
    ).sessions;
    const session = sessions.get("session-1");
    if (!session) {
      throw new Error("Expected adapter session record");
    }

    session.hasIdleSinceActivity = true;

    await adapter.sendUserMessage({
      sessionId: "session-1",
      parts: [{ kind: "text", text: "Second turn" }],
    });

    expect(session.hasIdleSinceActivity).toBe(false);
  });

  test("sendUserMessage does not pre-queue the first turn without a pending assistant boundary", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "session-1", "spec");

    const sessions = (
      adapter as unknown as {
        sessions: Map<
          string,
          {
            activeAssistantMessageId: string | null;
            pendingQueuedUserMessages: Array<{ signature: string }>;
          }
        >;
      }
    ).sessions;
    const session = sessions.get("session-1");
    if (!session) {
      throw new Error("Expected adapter session record");
    }

    session.activeAssistantMessageId = null;

    await adapter.sendUserMessage({
      sessionId: "session-1",
      parts: [{ kind: "text", text: "First turn" }],
    });

    expect(session.pendingQueuedUserMessages).toHaveLength(0);
  });

  test("sendUserMessage pre-queues busy follow-ups when an assistant boundary is active", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "session-1", "spec");

    const sessions = (
      adapter as unknown as {
        sessions: Map<
          string,
          {
            hasIdleSinceActivity: boolean;
            activeAssistantMessageId: string | null;
            pendingQueuedUserMessages: Array<{ signature: string }>;
          }
        >;
      }
    ).sessions;
    const session = sessions.get("session-1");
    if (!session) {
      throw new Error("Expected adapter session record");
    }

    session.hasIdleSinceActivity = true;
    session.activeAssistantMessageId = "msg-200";

    await adapter.sendUserMessage({
      sessionId: "session-1",
      parts: [{ kind: "text", text: "Queued follow-up" }],
    });

    expect(session.pendingQueuedUserMessages).toEqual([
      { signature: buildQueuedSignature("Queued follow-up") },
    ]);
  });

  test("sendUserMessage pre-queues follow-ups after a slash command establishes an assistant boundary", async () => {
    const mock = makeMockClient({
      commandResult: {
        mode: "success",
        data: {
          info: {
            id: "msg-command-assistant-1",
          },
        },
      },
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "session-1", "build");

    const sessions = (
      adapter as unknown as {
        sessions: Map<
          string,
          {
            activeAssistantMessageId: string | null;
            pendingQueuedUserMessages: Array<{ signature: string }>;
          }
        >;
      }
    ).sessions;
    const session = sessions.get("session-1");
    if (!session) {
      throw new Error("Expected adapter session record");
    }

    await adapter.sendUserMessage({
      sessionId: "session-1",
      parts: [
        {
          kind: "slash_command",
          command: {
            id: "compact",
            trigger: "compact",
            title: "compact",
            hints: [],
          },
        },
      ],
    });

    expect(session.activeAssistantMessageId).toBe("msg-command-assistant-1");

    await adapter.sendUserMessage({
      sessionId: "session-1",
      parts: [{ kind: "text", text: "Queued follow-up" }],
    });

    expect(session.pendingQueuedUserMessages).toEqual([
      { signature: buildQueuedSignature("Queued follow-up") },
    ]);
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
      parts: [{ kind: "text", text: "Continue" }],
    });

    expect(mock.session.promptCalls).toHaveLength(0);
    expect(mock.session.promptAsyncCalls).toHaveLength(1);
    expect(mock.session.promptAsyncCalls[0]).toMatchObject({
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
      parts: [{ kind: "text", text: "First message" }],
      model: selectedModel,
    });
    await adapter.sendUserMessage({
      sessionId: "session-1",
      parts: [{ kind: "text", text: "Second message" }],
      model: selectedModel,
    });

    expect(mock.tool.idsCalls).toEqual([{ directory: "/repo" }]);
    expect(mock.mcp.statusCalls).toEqual([{ directory: "/repo" }]);
    expect(mock.session.promptCalls).toHaveLength(0);
    expect(mock.session.promptAsyncCalls).toHaveLength(2);
  });

  test("sendUserMessage falls back to the session model for model-scoped tool discovery", async () => {
    const mock = makeMockClient({
      toolIdsResponse: ["bash", "read", "glob"],
      modelToolsResponse: [
        { id: "openducktor_odt_read_task" },
        { id: "openducktor_odt_read_task_documents" },
        { id: "openducktor_odt_set_spec" },
      ],
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
      parts: [{ kind: "text", text: "Use the saved model" }],
    });

    expect(mock.tool.listCalls).toEqual([
      {
        directory: "/repo",
        provider: "openai",
        model: "gpt-5",
      },
    ]);
    expect(mock.session.promptCalls).toHaveLength(0);
    expect(mock.session.promptAsyncCalls[0]).toMatchObject({
      tools: {
        edit: false,
        write: false,
        apply_patch: false,
        ast_grep_replace: false,
        lsp_rename: false,
        openducktor_odt_read_task: true,
        openducktor_odt_read_task_documents: true,
        openducktor_odt_set_spec: true,
      },
    });
  });

  test("sendUserMessage wraps promptAsync API errors with response details", async () => {
    const mock = makeMockClient({
      promptAsyncResult: {
        mode: "api_error",
        error: { message: "quota exceeded" },
        response: { status: 429, statusText: "Too Many Requests" },
      },
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "session-1", "spec");

    await expect(
      adapter.sendUserMessage({
        sessionId: "session-1",
        parts: [{ kind: "text", text: "Try again" }],
      }),
    ).rejects.toThrow(
      "OpenCode request failed: prompt session (429 Too Many Requests): quota exceeded",
    );
  });

  test("sendUserMessage wraps thrown promptAsync errors", async () => {
    const mock = makeMockClient({
      promptAsyncResult: {
        mode: "throw",
        error: new Error("socket closed"),
      },
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "session-1", "spec");

    await expect(
      adapter.sendUserMessage({
        sessionId: "session-1",
        parts: [{ kind: "text", text: "Try again" }],
      }),
    ).rejects.toThrow("OpenCode request failed: prompt session: socket closed");
  });

  test("loadSessionHistory preserves message model metadata and maps streamed parts", async () => {
    const mock = makeMockClient({
      messagesResponse: [
        {
          info: {
            id: "msg-100",
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
              messageID: "msg-100",
              type: "text",
              text: "Use the selected agent",
              time: { start: Date.now(), end: Date.now() },
            } as Part,
          ],
        },
        {
          info: {
            id: "msg-200",
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
              messageID: "msg-200",
              type: "reasoning",
              text: "Reasoning block",
              time: { start: Date.now(), end: Date.now() },
            } as Part,
            {
              id: "text-1",
              sessionID: "session-opencode-1",
              messageID: "msg-200",
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
      runtimeKind: "opencode",
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
    if (history[0]?.role !== "user") {
      throw new Error("Expected first history entry to be a user message");
    }
    if (history[1]?.role !== "assistant") {
      throw new Error("Expected second history entry to be an assistant message");
    }
    expect(history[0].state).toBe("read");
    expect(history[1].totalTokens).toBe(2_450);
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

  test("loadSessionHistory marks queued user messages using the last unfinished assistant boundary", async () => {
    const mock = makeMockClient({
      messagesResponse: [
        {
          info: {
            id: "msg-100",
            role: "user",
            time: { created: Date.parse("2026-02-17T11:59:00Z") },
          },
          parts: [
            {
              id: "text-user-read-z",
              sessionID: "session-opencode-1",
              messageID: "msg-100",
              type: "text",
              text: "Original request",
              time: { start: Date.now(), end: Date.now() },
            } as Part,
          ],
        },
        {
          info: {
            id: "msg-200",
            role: "assistant",
            parentID: "msg-100",
            time: { created: Date.parse("2026-02-17T12:00:00Z") },
          },
          parts: [
            {
              id: "text-assistant-parent-a",
              sessionID: "session-opencode-1",
              messageID: "msg-200",
              type: "text",
              text: "Working on it",
              time: { start: Date.now(), end: Date.now() },
            } as Part,
          ],
        },
        {
          info: {
            id: "msg-300",
            role: "user",
            time: { created: Date.parse("2026-02-17T12:01:00Z") },
          },
          parts: [
            {
              id: "text-user-queued-a",
              sessionID: "session-opencode-1",
              messageID: "msg-300",
              type: "text",
              text: "One more change",
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
      runtimeKind: "opencode",
      runtimeConnection: defaultRuntimeConnection,
      externalSessionId: "session-opencode-1",
      limit: 100,
    });

    expect(history).toHaveLength(3);
    if (history[0]?.role !== "user" || history[2]?.role !== "user") {
      throw new Error("Expected first and last history entries to be user messages");
    }
    expect(history[0].messageId).toBe("msg-100");
    expect(history[0].state).toBe("read");
    expect(history[2].messageId).toBe("msg-300");
    expect(history[2].state).toBe("queued");
  });

  test("loadSessionHistory preserves user whitespace and reconstructs adjacent file references", async () => {
    const mock = makeMockClient({
      messagesResponse: [
        {
          info: {
            id: "msg-user-1",
            role: "user",
            text: "  @src/alpha.ts @src/beta.ts  ",
            time: { created: Date.parse("2026-02-17T11:59:00Z") },
          },
          parts: [
            {
              id: "file-alpha",
              sessionID: "session-opencode-1",
              messageID: "msg-user-1",
              type: "file",
              mime: "text/plain",
              filename: "alpha.ts",
              url: "file:///repo/src/alpha.ts",
              source: {
                type: "file",
                path: "src/alpha.ts",
                text: { value: "@src/alpha.ts", start: 2, end: 15 },
              },
            } as Part,
            {
              id: "file-beta",
              sessionID: "session-opencode-1",
              messageID: "msg-user-1",
              type: "file",
              mime: "text/plain",
              filename: "beta.ts",
              url: "file:///repo/src/beta.ts",
              source: {
                type: "file",
                path: "src/beta.ts",
                text: { value: "@src/beta.ts", start: 15, end: 27 },
              },
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
      runtimeKind: "opencode",
      runtimeConnection: defaultRuntimeConnection,
      externalSessionId: "session-opencode-1",
      limit: 100,
    });

    expect(history).toHaveLength(1);
    if (history[0]?.role !== "user") {
      throw new Error("Expected user history entry");
    }
    expect(history[0].text).toBe("  @src/alpha.ts @src/beta.ts  ");
    expect(history[0].displayParts).toEqual([
      {
        kind: "text",
        text: "  @src/alpha.ts @src/beta.ts  ",
      },
      {
        kind: "file_reference",
        file: {
          id: "file-alpha",
          path: "src/alpha.ts",
          name: "alpha.ts",
          kind: "code",
        },
        sourceText: {
          start: 2,
          end: 15,
          value: "@src/alpha.ts",
        },
      },
      {
        kind: "file_reference",
        file: {
          id: "file-beta",
          path: "src/beta.ts",
          name: "beta.ts",
          kind: "code",
        },
        sourceText: {
          start: 15,
          end: 27,
          value: "@src/beta.ts",
        },
      },
    ]);
  });

  test("loadSessionHistory collapses redundant slash-command echo text parts", async () => {
    const slashEnvelope = `<auto-slash-command>\n# /test-command Command\n\n**Description**: A command for testing slash commands\n\n**User Arguments**: pouet\n\n**Scope**: opencode\n\n---\n\n## Command Instructions\n\nI just want to test the slash commands mechanism.\nReturn the arguments of this command: pouet\n\n\n---\n\n## User Request\n\npouet\n</auto-slash-command>`;
    const mock = makeMockClient({
      messagesResponse: [
        {
          info: {
            id: "msg-user-slash-1",
            role: "user",
            time: { created: Date.parse("2026-02-17T11:59:00Z") },
          },
          parts: [
            {
              id: "text-user-envelope",
              sessionID: "session-opencode-1",
              messageID: "msg-user-slash-1",
              type: "text",
              text: slashEnvelope,
            } as Part,
            {
              id: "text-user-echo",
              sessionID: "session-opencode-1",
              messageID: "msg-user-slash-1",
              type: "text",
              text: "I just want to test the slash commands mechanism.\nReturn the arguments of this command: pouet",
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
      runtimeKind: "opencode",
      runtimeConnection: defaultRuntimeConnection,
      externalSessionId: "session-opencode-1",
      limit: 100,
    });

    expect(history).toHaveLength(1);
    if (history[0]?.role !== "user") {
      throw new Error("Expected user history entry");
    }
    expect(history[0].text).toBe(slashEnvelope);
    expect(history[0].displayParts).toEqual([{ kind: "text", text: slashEnvelope }]);
  });

  test("loadSessionHistory preserves local attachment preview paths from the live session metadata", async () => {
    const mock = makeMockClient({
      messagesResponse: [
        {
          info: {
            id: "msg-user-attachment-1",
            role: "user",
            text: "Describe this screenshot",
            time: { created: Date.parse("2026-02-17T11:59:00Z") },
          },
          parts: [
            {
              id: "file-attachment-1",
              sessionID: "session-opencode-1",
              messageID: "msg-user-attachment-1",
              type: "file",
              mime: "image/png",
              filename: "Screenshot-2026-03-16-at-23.48.30.png",
              url: "https://files.example.invalid/uploaded-image",
            } as Part,
          ],
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const sessions = (adapter as unknown as { sessions: Map<string, SessionRecord> }).sessions;
    sessions.set("session-1", {
      externalSessionId: "session-opencode-1",
      eventTransportKey: defaultRuntimeConnection.endpoint,
      input: {
        sessionId: "session-1",
        repoPath: "/repo",
        runtimeKind: "opencode",
        runtimeConnection: defaultRuntimeConnection,
        workingDirectory: "/repo/feature-worktree",
        taskId: "task-1",
        role: "spec",
        scenario: "spec_initial",
        systemPrompt: "System prompt",
      },
      messageMetadataById: new Map([
        [
          "msg-user-attachment-1",
          {
            timestamp: "2026-02-17T11:59:00Z",
            displayParts: [
              {
                kind: "attachment",
                attachment: {
                  id: "attachment-image-1",
                  path: "/tmp/local-screenshot.png",
                  name: "Screenshot-2026-03-16-at-23.48.30.png",
                  kind: "image",
                  mime: "image/png",
                },
              },
            ],
          },
        ],
      ]),
    } as unknown as SessionRecord);

    const history = await adapter.loadSessionHistory({
      runtimeKind: "opencode",
      runtimeConnection: defaultRuntimeConnection,
      externalSessionId: "session-opencode-1",
      limit: 100,
    });

    if (history[0]?.role !== "user") {
      throw new Error("Expected user history entry");
    }
    expect(history[0].displayParts).toContainEqual(
      expect.objectContaining({
        kind: "attachment",
        attachment: expect.objectContaining({
          path: "/tmp/local-screenshot.png",
          name: "Screenshot-2026-03-16-at-23.48.30.png",
          kind: "image",
          mime: "image/png",
        }),
      }),
    );
  });

  test("loadSessionHistory only reuses preserved attachment parts from the matching runtime endpoint", async () => {
    const mock = makeMockClient({
      messagesResponse: [
        {
          info: {
            id: "msg-user-attachment-1",
            role: "user",
            text: "Describe this screenshot",
            time: { created: Date.parse("2026-02-17T11:59:00Z") },
          },
          parts: [
            {
              id: "file-attachment-1",
              sessionID: "session-opencode-1",
              messageID: "msg-user-attachment-1",
              type: "file",
              mime: "image/png",
              filename: "Screenshot-2026-03-16-at-23.48.30.png",
              url: "https://files.example.invalid/uploaded-image",
            } as Part,
          ],
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const sessions = (adapter as unknown as { sessions: Map<string, SessionRecord> }).sessions;
    sessions.set("session-runtime-a", {
      externalSessionId: "session-opencode-1",
      eventTransportKey: defaultRuntimeConnection.endpoint,
      input: {
        sessionId: "session-runtime-a",
        repoPath: "/repo",
        runtimeKind: "opencode",
        runtimeConnection: defaultRuntimeConnection,
        workingDirectory: "/repo/feature-worktree",
        taskId: "task-1",
        role: "spec",
        scenario: "spec_initial",
        systemPrompt: "System prompt",
      },
      messageMetadataById: new Map([
        [
          "msg-user-attachment-1",
          {
            timestamp: "2026-02-17T11:59:00Z",
            displayParts: [
              {
                kind: "attachment",
                attachment: {
                  id: "attachment-image-1",
                  path: "/tmp/runtime-a-screenshot.png",
                  name: "Screenshot-2026-03-16-at-23.48.30.png",
                  kind: "image",
                  mime: "image/png",
                },
              },
            ],
          },
        ],
      ]),
    } as unknown as SessionRecord);
    sessions.set("session-runtime-b", {
      externalSessionId: "session-opencode-1",
      eventTransportKey: "http://127.0.0.1:12000",
      input: {
        sessionId: "session-runtime-b",
        repoPath: "/repo",
        runtimeKind: "opencode",
        runtimeConnection: {
          type: "local_http",
          endpoint: "http://127.0.0.1:12000",
          workingDirectory: "/repo",
        },
        workingDirectory: "/repo/other-worktree",
        taskId: "task-1",
        role: "spec",
        scenario: "spec_initial",
        systemPrompt: "System prompt",
      },
      messageMetadataById: new Map([
        [
          "msg-user-attachment-1",
          {
            timestamp: "2026-02-17T11:59:00Z",
            displayParts: [
              {
                kind: "attachment",
                attachment: {
                  id: "attachment-image-2",
                  path: "/tmp/runtime-b-screenshot.png",
                  name: "Screenshot-2026-03-16-at-23.48.30.png",
                  kind: "image",
                  mime: "image/png",
                },
              },
            ],
          },
        ],
      ]),
    } as unknown as SessionRecord);

    const history = await adapter.loadSessionHistory({
      runtimeKind: "opencode",
      runtimeConnection: defaultRuntimeConnection,
      externalSessionId: "session-opencode-1",
      limit: 100,
    });

    if (history[0]?.role !== "user") {
      throw new Error("Expected user history entry");
    }
    expect(history[0].displayParts).toContainEqual(
      expect.objectContaining({
        kind: "attachment",
        attachment: expect.objectContaining({
          path: "/tmp/runtime-a-screenshot.png",
        }),
      }),
    );
    expect(history[0].displayParts).not.toContainEqual(
      expect.objectContaining({
        kind: "attachment",
        attachment: expect.objectContaining({
          path: "/tmp/runtime-b-screenshot.png",
        }),
      }),
    );
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

  test("synthesizes session_idle from terminal assistant completion when no idle event follows", async () => {
    const streamEvents: Event[] = [
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-terminal-1",
            role: "assistant",
            sessionID: "session-opencode-1",
            providerID: "openai",
            modelID: "gpt-5",
            agent: "Hephaestus",
            variant: "high",
            finish: "stop",
            time: {
              created: Date.parse("2026-02-17T12:00:03Z"),
              completed: Date.parse("2026-02-17T12:00:05Z"),
            },
          },
          parts: [
            {
              id: "text-terminal-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-terminal-1",
              type: "text",
              text: "Done",
              time: { start: 1, end: 1 },
            },
          ],
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({ streamEvents });
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

    const idleEvents = events.filter((entry) => entry.type === "session_idle");
    expect(idleEvents).toHaveLength(1);
  });

  test("maps terminal assistant metadata onto previously streamed text parts", async () => {
    const streamEvents: Event[] = [
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "assistant-text-2",
            sessionID: "session-opencode-1",
            messageID: "assistant-2",
            type: "text",
            text: "All done",
            time: { start: 1, end: 1 },
          },
        },
      } as unknown as Event,
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-2",
            role: "assistant",
            sessionID: "session-opencode-1",
            providerID: "anthropic",
            modelID: "claude-sonnet",
            agent: "Hephaestus",
            variant: "max",
            finish: "stop",
            tokens: {
              input: 8,
              output: 4,
            },
            time: {
              created: Date.parse("2026-02-17T12:00:06Z"),
              completed: Date.parse("2026-02-17T12:00:08Z"),
            },
          },
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({ streamEvents });
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

    const assistantMessages = events.filter((entry) => entry.type === "assistant_message");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]).toMatchObject({
      type: "assistant_message",
      messageId: "assistant-2",
      message: "All done",
      totalTokens: 12,
      model: {
        providerId: "anthropic",
        modelId: "claude-sonnet",
        profileId: "Hephaestus",
        variant: "max",
      },
    });
  });

  test("does not re-emit assistant streaming events after idle is already preserved", async () => {
    const streamEvents: Event[] = [
      {
        type: "session.status",
        properties: {
          sessionID: "session-opencode-1",
          status: {
            type: "idle",
          },
        },
      } as unknown as Event,
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-idle-preserved-1",
            role: "assistant",
            sessionID: "session-opencode-1",
            providerID: "openai",
            modelID: "gpt-5",
            agent: "Hephaestus",
            variant: "high",
            finish: "stop",
            time: {
              created: Date.parse("2026-02-17T12:00:06Z"),
              completed: Date.parse("2026-02-17T12:00:08Z"),
            },
          },
          parts: [
            {
              id: "text-idle-preserved-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-idle-preserved-1",
              type: "text",
              text: "All done",
              time: { start: 1, end: 1 },
            },
          ],
        },
      } as unknown as Event,
      {
        type: "message.part.delta",
        properties: {
          sessionID: "session-opencode-1",
          partID: "text-idle-preserved-1",
          messageID: "assistant-idle-preserved-1",
          field: "text",
          delta: " later",
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({ streamEvents });
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

    expect(events.filter((entry) => entry.type === "session_status")).toHaveLength(1);
    expect(events.filter((entry) => entry.type === "assistant_message")).toHaveLength(1);
    expect(events.filter((entry) => entry.type === "assistant_part")).toHaveLength(0);
    expect(events.filter((entry) => entry.type === "assistant_delta")).toHaveLength(0);
    expect(events.filter((entry) => entry.type === "session_idle")).toHaveLength(0);
  });

  test("emits the final assistant message when idle-preserved parts arrive after terminal metadata", async () => {
    const streamEvents: Event[] = [
      {
        type: "session.status",
        properties: {
          sessionID: "session-opencode-1",
          status: {
            type: "idle",
          },
        },
      } as unknown as Event,
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-idle-late-part-1",
            role: "assistant",
            sessionID: "session-opencode-1",
            providerID: "openai",
            modelID: "gpt-5",
            agent: "Hephaestus",
            variant: "high",
            finish: "stop",
            time: {
              created: Date.parse("2026-02-17T12:00:06Z"),
              completed: Date.parse("2026-02-17T12:00:08Z"),
            },
          },
        },
      } as unknown as Event,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "text-idle-late-part-1",
            sessionID: "session-opencode-1",
            messageID: "assistant-idle-late-part-1",
            type: "text",
            text: "Recovered final output",
            time: { start: 1, end: 1 },
          },
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({ streamEvents });
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

    expect(events.filter((entry) => entry.type === "session_status")).toHaveLength(1);
    expect(events.filter((entry) => entry.type === "assistant_part")).toHaveLength(0);
    expect(events.filter((entry) => entry.type === "assistant_delta")).toHaveLength(0);

    const assistantMessages = events.filter((entry) => entry.type === "assistant_message");
    expect(assistantMessages).toHaveLength(1);
    if (assistantMessages[0]?.type !== "assistant_message") {
      throw new Error("Expected assistant_message event");
    }
    expect(assistantMessages[0].message).toBe("Recovered final output");
    expect(events.filter((entry) => entry.type === "session_idle")).toHaveLength(0);
  });

  test("does not finalize previously streamed assistant text without a stop signal", async () => {
    const streamEvents: Event[] = [
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "assistant-text-3",
            sessionID: "session-opencode-1",
            messageID: "assistant-3",
            type: "text",
            text: "Still thinking",
            time: { start: 1, end: 1 },
          },
        },
      } as unknown as Event,
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-3",
            role: "assistant",
            sessionID: "session-opencode-1",
            providerID: "anthropic",
            modelID: "claude-sonnet",
            agent: "Hephaestus",
            variant: "max",
            tokens: {
              input: 8,
              output: 4,
            },
            time: {
              created: Date.parse("2026-02-17T12:00:06Z"),
              completed: Date.parse("2026-02-17T12:00:08Z"),
            },
          },
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({ streamEvents });
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

    expect(events.some((entry) => entry.type === "assistant_message")).toBe(false);
    expect(events.some((entry) => entry.type === "session_idle")).toBe(false);
  });

  test("maps acknowledged user message.updated events into user_message", async () => {
    const streamEvents: Event[] = [
      {
        type: "message.updated",
        properties: {
          info: {
            id: "user-1",
            role: "user",
            sessionID: "session-opencode-1",
            providerID: "openai",
            modelID: "gpt-5",
            agent: "Hephaestus",
            variant: "high",
            text: "Generate the pull request",
            time: {
              created: Date.parse("2026-02-17T12:00:04Z"),
            },
          },
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

    const userEvents = events.filter((entry) => entry.type === "user_message");
    expect(userEvents).toHaveLength(1);
    expect(userEvents[0]).toMatchObject({
      type: "user_message",
      timestamp: "2026-02-17T12:00:04.000Z",
      messageId: "user-1",
      message: "Generate the pull request",
      state: "read",
      model: {
        providerId: "openai",
        modelId: "gpt-5",
        profileId: "Hephaestus",
        variant: "high",
      },
    });
  });

  test("maps user message parts into user_message when message.updated omits text", async () => {
    const streamEvents: Event[] = [
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "text-user-2",
            sessionID: "session-opencode-1",
            messageID: "user-2",
            type: "text",
            text: "Generate the pull request",
          },
        },
      } as unknown as Event,
      {
        type: "message.updated",
        properties: {
          info: {
            id: "user-2",
            role: "user",
            sessionID: "session-opencode-1",
            providerID: "openai",
            modelID: "gpt-5",
            agent: "Hephaestus",
            variant: "high",
            time: {
              created: Date.parse("2026-02-17T12:00:05Z"),
            },
          },
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

    const userEvents = events.filter((entry) => entry.type === "user_message");
    expect(userEvents).toHaveLength(1);
    expect(userEvents[0]).toMatchObject({
      type: "user_message",
      timestamp: "2026-02-17T12:00:05.000Z",
      messageId: "user-2",
      message: "Generate the pull request",
      state: "read",
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
          type: "local_http",
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
        type: "local_http",
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

  test("listAvailableModels applies OpenCode default colors for native agents without explicit color", async () => {
    const expectedNativeDefaultColors = [
      { id: "build", color: "var(--icon-agent-build-base)" },
      { id: "plan", color: "var(--icon-agent-plan-base)" },
    ] as const;

    const mock = makeMockClient({
      agentsResponse: expectedNativeDefaultColors.map((entry) => ({
        name: entry.id,
        description: `Native ${entry.id} agent`,
        mode: entry.id === "plan" ? "primary" : "subagent",
        hidden: entry.id !== "plan",
        native: true,
      })),
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const catalog = await adapter.listAvailableModels({
      runtimeKind: "opencode",
      runtimeConnection: defaultRuntimeConnection,
    });

    expect(catalog.profiles).toEqual(
      expect.arrayContaining(
        expectedNativeDefaultColors.map((entry) =>
          expect.objectContaining({
            id: entry.id,
            label: entry.id,
            color: entry.color,
          }),
        ),
      ),
    );
  });

  test("listAvailableModels does not synthesize colors for unsupported native names", async () => {
    const mock = makeMockClient({
      agentsResponse: [
        {
          name: "ask",
          description: "Native ask agent",
          mode: "subagent",
          hidden: true,
          native: true,
        },
        {
          name: "docs",
          description: "Native docs agent",
          mode: "subagent",
          hidden: true,
          native: true,
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

    expect(catalog.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "ask", label: "ask" }),
        expect.objectContaining({ id: "docs", label: "docs" }),
      ]),
    );

    const ask = catalog.profiles?.find((entry) => entry.id === "ask");
    const docs = catalog.profiles?.find((entry) => entry.id === "docs");
    expect(ask).toBeDefined();
    expect(docs).toBeDefined();
    expect(ask).not.toHaveProperty("color");
    expect(docs).not.toHaveProperty("color");
  });

  test("listAvailableModels keeps explicit native color and skips fallback for non-native reserved names", async () => {
    const mock = makeMockClient({
      agentsResponse: [
        {
          name: "build",
          description: "Native build agent",
          mode: "subagent",
          hidden: true,
          native: true,
          color: "#123456",
        },
        {
          name: "plan",
          description: "Custom plan profile",
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

    expect(catalog.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "build",
          label: "build",
          color: "#123456",
        }),
      ]),
    );

    const planProfile = catalog.profiles?.find((entry) => entry.id === "plan");
    expect(planProfile).toBeDefined();
    expect(planProfile).not.toHaveProperty("color");
  });

  test("listAvailableModels ignores malformed or blank agent entries", async () => {
    const mock = makeMockClient({
      agentsResponse: [
        null,
        42,
        {
          name: "   ",
          mode: "primary",
          native: true,
        },
        {
          name: "valid",
          mode: "primary",
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
        id: "valid",
        label: "valid",
        mode: "primary",
        native: false,
      }),
    ]);
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

  test("getMcpStatus rejects malformed payloads instead of returning an empty map", async () => {
    const mock = makeMockClient({
      mcpStatusResponse: "not-an-object",
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await expect(
      adapter.getMcpStatus({
        runtimeEndpoint: "http://127.0.0.1:12345",
        workingDirectory: "/repo",
      }),
    ).rejects.toThrow("Invalid MCP status payload");
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
