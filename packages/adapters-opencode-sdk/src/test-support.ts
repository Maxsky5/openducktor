import type { JsonValue } from "@openducktor/contracts";
import type { Event, OpencodeClient, Part } from "@opencode-ai/sdk/v2";
import type { RuntimeKind } from "@openducktor/contracts";
import { ODT_MCP_TOOL_NAMES, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentRole, PolicyBoundSessionRef, SessionRef } from "@openducktor/core";
import { workflowAgentSessionScope } from "@openducktor/core";
import { OpencodeSdkAdapter as BaseOpencodeSdkAdapter } from "./index";
import { buildQueuedRequestSignature } from "./user-message-signatures";

type OpencodePolicyBoundSessionRef = Extract<PolicyBoundSessionRef, { runtimeKind: "opencode" }>;

export const flushAsync = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
export const buildQueuedSignature = (text: string): string =>
  buildQueuedRequestSignature([{ kind: "text", text }]);
export const defaultRuntimeConnection = {
  type: "local_http",
  endpoint: "http://127.0.0.1:12345",
  workingDirectory: "/repo",
} as const;

export const defaultRepoRuntimeInput = {
  repoPath: "/repo",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo",
  sessionScope: workflowAgentSessionScope("task-1", "spec" satisfies AgentRole),
  runtimePolicy: { kind: "opencode" as const },
};

export const sessionRef = (externalSessionId = "session-opencode-1"): SessionRef => ({
  repoPath: "/repo",
  externalSessionId,
  runtimeKind: "opencode",
  workingDirectory: "/repo",
});

export const sessionRuntimeRef = (
  externalSessionId = "session-opencode-1",
  overrides: Partial<OpencodePolicyBoundSessionRef> & { role?: AgentRole } = {},
): OpencodePolicyBoundSessionRef => {
  const { role, ...sessionOverrides } = overrides;
  return {
    externalSessionId,
    repoPath: "/repo",
    runtimeKind: "opencode",
    workingDirectory: "/repo",
    sessionScope: workflowAgentSessionScope("task-1", role ?? "spec"),
    runtimePolicy: { kind: "opencode" },
    systemPrompt: "system prompt",
    ...sessionOverrides,
  };
};

const createDefaultRuntimeSummary = (repoPath: string, runtimeKind: RuntimeKind) => ({
  kind: runtimeKind,
  runtimeId: "runtime-opencode-1",
  repoPath,
  taskId: null,
  role: "workspace" as const,
  workingDirectory: defaultRuntimeConnection.workingDirectory,
  runtimeRoute: {
    type: "local_http" as const,
    endpoint: defaultRuntimeConnection.endpoint,
  },
  startedAt: "2026-02-17T12:00:00Z",
  descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
});

export class OpencodeSdkAdapter extends BaseOpencodeSdkAdapter {
  constructor(options: ConstructorParameters<typeof BaseOpencodeSdkAdapter>[0] = {}) {
    super({
      repoRuntimeResolver: {
        requireRepoRuntime: async ({ repoPath, runtimeKind }) =>
          createDefaultRuntimeSummary(repoPath, runtimeKind),
      },
      ...options,
    });
  }
}

const DEFAULT_ODT_RUNTIME_TOOL_IDS = [
  ...ODT_MCP_TOOL_NAMES,
  ...ODT_MCP_TOOL_NAMES.map((toolName) => `openducktor_${toolName}`),
  ...ODT_MCP_TOOL_NAMES.map((toolName) => `functions.openducktor_${toolName}`),
] as const;

export type MockSession = {
  createCalls: unknown[];
  promptCalls: unknown[];
  promptAsyncCalls: unknown[];
  commandCalls: unknown[];
  abortCalls: unknown[];
  getCalls: unknown[];
  updateCalls: unknown[];
  forkCalls: unknown[];
  deleteCalls: unknown[];
  updateResult: SessionUpdateMockResult;
  messagesCalls: unknown[];
  childrenCalls: unknown[];
  todoCalls: unknown[];
  messagesResponse: Array<{
    info: {
      id: string;
      role: "user" | "assistant";
      time: { created: number };
      [key: string]: JsonValue;
    };
    parts: Part[];
  }>;
  todoResult: TodoMockResult;
};

export type SessionUpdateMockResult = {
  data?: JsonValue;
  error?: JsonValue | undefined;
  response?: JsonValue | undefined;
};

export type MockTool = {
  idsCalls: unknown[];
  listCalls: unknown[];
};

export type MockMcp = {
  statusCalls: unknown[];
  connectCalls: unknown[];
};

export type MockPermission = {
  replyCalls: unknown[];
};

export type MockQuestion = {
  replyCalls: unknown[];
};

export type MockEventStream = {
  events: Event[];
};

export type TodoMockResult =
  | {
      mode: "success";
      data: JsonValue;
    }
  | {
      mode: "api_error";
      error: JsonValue | undefined;
      status?: number;
      statusText?: string;
    }
  | {
      mode: "throw";
      error: Error;
    };

export type AgentsMockResult =
  | {
      mode: "success";
      data: JsonValue;
    }
  | {
      mode: "api_error";
      error: JsonValue | undefined;
    }
  | {
      mode: "throw";
      error: Error;
    };

export type PromptAsyncMockResult =
  | {
      mode: "success";
      data?: JsonValue;
    }
  | {
      mode: "api_error";
      error: JsonValue | undefined;
      response?: { status?: number; statusText?: string };
    }
  | {
      mode: "throw";
      error: Error;
    };

export type CommandMockResult =
  | {
      mode: "success";
      data?: JsonValue;
    }
  | {
      mode: "api_error";
      error: JsonValue | undefined;
      response?: { status?: number; statusText?: string };
    }
  | {
      mode: "throw";
      error: Error;
    };

export type MakeMockClientInput = {
  sessionId?: string;
  sessionIds?: string[];
  forkSessionId?: string;
  sessionUpdateResult?: SessionUpdateMockResult;
  promptAsyncResult?: PromptAsyncMockResult;
  commandResult?: CommandMockResult;
  streamEvents?: Event[];
  messagesResponse?: Array<{
    info: {
      id: string;
      role: "user" | "assistant";
      time: { created: number };
      [key: string]: JsonValue;
    };
    parts: Part[];
  }>;
  childrenResponse?: unknown[];
  todoResult?: TodoMockResult;
  providerResponse?: JsonValue | undefined;
  agentsResponse?: JsonValue | undefined;
  agentsResult?: AgentsMockResult;
  toolIdsResponse?: JsonValue | undefined;
  modelToolsResponse?: JsonValue | undefined;
  mcpStatusResponse?: JsonValue | undefined;
};

export const makeMockClient = ({
  sessionId = "session-opencode-1",
  sessionIds,
  forkSessionId = "session-opencode-fork",
  sessionUpdateResult = { data: { id: sessionId }, error: undefined },
  promptAsyncResult = { mode: "success" },
  commandResult = { mode: "success" },
  streamEvents = [],
  messagesResponse = [],
  childrenResponse = [],
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
}: MakeMockClientInput = {}): {
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
    updateCalls: [],
    forkCalls: [],
    deleteCalls: [],
    updateResult: sessionUpdateResult,
    messagesCalls: [],
    childrenCalls: [],
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
  const queuedSessionIds = [...(sessionIds ?? [sessionId])];

  const client = {
    session: {
      create: async (input: JsonValue | undefined) => {
        session.createCalls.push(input);
        return { data: { id: queuedSessionIds.shift() ?? sessionId }, error: undefined };
      },
      promptAsync: async (input: JsonValue | undefined) => {
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
      command: async (input: JsonValue | undefined) => {
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
      prompt: async (input: JsonValue | undefined) => {
        session.promptCalls.push(input);
        return { data: undefined, error: undefined };
      },
      abort: async (input: JsonValue | undefined) => {
        session.abortCalls.push(input);
        return { data: true, error: undefined };
      },
      get: async (input: JsonValue | undefined) => {
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
      update: async (input: JsonValue | undefined) => {
        session.updateCalls.push(input);
        return session.updateResult;
      },
      fork: async (input: JsonValue | undefined) => {
        session.forkCalls.push(input);
        return { data: { id: forkSessionId }, error: undefined };
      },
      delete: async (input: JsonValue | undefined) => {
        session.deleteCalls.push(input);
        return { data: true, error: undefined };
      },
      messages: async (input: JsonValue | undefined) => {
        session.messagesCalls.push(input);
        return {
          data: session.messagesResponse,
          error: undefined,
        };
      },
      children: async (input: JsonValue | undefined) => {
        session.childrenCalls.push(input);
        return {
          data: childrenResponse,
          error: undefined,
        };
      },
      todo: async (input: JsonValue | undefined) => {
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
      reply: async (input: JsonValue | undefined) => {
        permission.replyCalls.push(input);
        return { data: true, error: undefined };
      },
    },
    question: {
      reply: async (input: JsonValue | undefined) => {
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
      ids: async (input: JsonValue | undefined) => {
        tool.idsCalls.push(input);
        return {
          data: toolIdsResponse,
          error: undefined,
        };
      },
      list: async (input: JsonValue | undefined) => {
        tool.listCalls.push(input);
        return {
          data: modelToolsResponse,
          error: undefined,
        };
      },
    },
    mcp: {
      status: async (input: JsonValue | undefined) => {
        mcp.statusCalls.push(input);
        return {
          data: mcpStatusResponse,
          error: undefined,
        };
      },
      connect: async (input: JsonValue | undefined) => {
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

export const startDefaultSession = async (
  adapter: BaseOpencodeSdkAdapter,
  role: "spec" | "planner" | "build" | "qa" = "spec",
  model?: {
    providerId: string;
    modelId: string;
    variant?: string;
    profileId?: string;
  },
): Promise<void> => {
  await adapter.startSession({
    repoPath: "/repo",
    workingDirectory: "/repo",
    runtimeKind: "opencode",
    sessionScope: workflowAgentSessionScope("task-1", role),
    runtimePolicy: { kind: "opencode" },
    systemPrompt: "system prompt",
    ...(model ? { model } : {}),
  });
};

export const defaultLoadSessionTodosInput = {
  ...defaultRepoRuntimeInput,
  externalSessionId: "session-opencode-1",
};

export const createLoadSessionTodosHarness = (
  mockInput: MakeMockClientInput,
): {
  adapter: BaseOpencodeSdkAdapter;
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
