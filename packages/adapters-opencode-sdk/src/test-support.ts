import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { RuntimeKind } from "@openducktor/contracts";
import { ODT_MCP_TOOL_NAMES, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentRole, PolicyBoundSessionRef, SessionRef } from "@openducktor/core";
import { workflowAgentSessionScope } from "@openducktor/core";
import { OpencodeSdkAdapter as BaseOpencodeSdkAdapter } from "./index";
import type { ParsedOpencodeMessage } from "./opencode-ingress";
import type { ParsedOpencodeGlobalEventPayload } from "./opencode-global-event-ingress";
import { buildQueuedRequestSignature } from "./user-message-signatures";
import {
  createOpencodeEventFixtures,
  createOpencodeMessageInfoFixture,
  createOpencodePartFixture,
  createParsedOpencodeEventFixture,
  type DirectEventFixtureInput,
  type OpencodeEventFixtureInput,
  type OpencodeMessageInfoFixtureInput,
  type OpencodePartFixtureInput,
} from "./opencode-protocol-test-fixtures";

type OpencodePolicyBoundSessionRef = Extract<PolicyBoundSessionRef, { runtimeKind: "opencode" }>;
type ClientMethodInput<
  Namespace extends keyof OpencodeClient,
  Method extends keyof OpencodeClient[Namespace],
> = OpencodeClient[Namespace][Method] extends (...args: infer Args) => infer _Result
  ? Args[0]
  : never;

type MockApiError = Error | { message: string };

type MockSessionMessage = {
  info: OpencodeMessageInfoFixtureInput;
  parts: OpencodePartFixtureInput[];
};

const completeMockMessage = (message: MockSessionMessage): ParsedOpencodeMessage => ({
  info: createOpencodeMessageInfoFixture(message.info),
  parts: message.parts.map(createOpencodePartFixture),
});

export const completeMockEvent = (
  event: DirectEventFixtureInput,
  index: number,
): ParsedOpencodeGlobalEventPayload => createParsedOpencodeEventFixture(event, index);

type MockChildSession = {
  id: string;
  parentID?: string;
  time: { created: number };
};

type MockTodoPayload = {
  id?: string;
  content: string;
  status: string;
  priority: string;
};

type MockAgentPayload =
  | null
  | number
  | {
      name: string;
      description?: string;
      mode: "primary" | "subagent";
      hidden?: boolean;
      native?: boolean;
      color?: string;
    };

type MockMcpStatus = { status: "connected" } | { status: "failed"; error: string };

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
  createCalls: ClientMethodInput<"session", "create">[];
  promptCalls: ClientMethodInput<"session", "prompt">[];
  promptAsyncCalls: ClientMethodInput<"session", "promptAsync">[];
  commandCalls: ClientMethodInput<"session", "command">[];
  abortCalls: ClientMethodInput<"session", "abort">[];
  getCalls: ClientMethodInput<"session", "get">[];
  updateCalls: ClientMethodInput<"session", "update">[];
  forkCalls: ClientMethodInput<"session", "fork">[];
  deleteCalls: ClientMethodInput<"session", "delete">[];
  updateResult: SessionUpdateMockResult;
  messagesCalls: ClientMethodInput<"session", "messages">[];
  childrenCalls: ClientMethodInput<"session", "children">[];
  todoCalls: ClientMethodInput<"session", "todo">[];
  messagesResponse: MockSessionMessage[];
  todoResult: TodoMockResult;
};

export type SessionUpdateMockResult = {
  data?: { id: string };
  error?: MockApiError;
};

export type MockTool = {
  idsCalls: ClientMethodInput<"tool", "ids">[];
  listCalls: ClientMethodInput<"tool", "list">[];
};

export type MockMcp = {
  statusCalls: ClientMethodInput<"mcp", "status">[];
  connectCalls: ClientMethodInput<"mcp", "connect">[];
};

export type MockPermission = {
  replyCalls: ClientMethodInput<"permission", "reply">[];
};

export type MockQuestion = {
  replyCalls: ClientMethodInput<"question", "reply">[];
};

export type MockEventStream = {
  events: OpencodeEventFixtureInput[];
};

export type TodoMockResult =
  | {
      mode: "success";
      data: MockTodoPayload[];
    }
  | {
      mode: "api_error";
      error: MockApiError;
      status?: number;
      statusText?: string;
    }
  | {
      mode: "throw";
      error: Error;
    };

export type AgentsMockResult =
  | {
      mode: "api_error";
      error: MockApiError;
    }
  | {
      mode: "throw";
      error: Error;
    };

export type PromptAsyncMockResult =
  | {
      mode: "success";
    }
  | {
      mode: "api_error";
      error: MockApiError;
      response?: { status?: number; statusText?: string };
    }
  | {
      mode: "throw";
      error: Error;
    };

export type CommandMockResult =
  | {
      mode: "success";
      data?: { info: { id: string } };
    }
  | {
      mode: "api_error";
      error: MockApiError;
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
  streamEvents?: OpencodeEventFixtureInput[];
  messagesResponse?: MockSessionMessage[];
  childrenResponse?: MockChildSession[];
  todoResult?: TodoMockResult;
  agentsResponse?: MockAgentPayload[];
  agentsResult?: AgentsMockResult;
  toolIdsResponse?: string[];
  mcpStatusResponse?: Record<string, MockMcpStatus>;
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
  agentsResponse = [],
  agentsResult,
  toolIdsResponse = [...DEFAULT_ODT_RUNTIME_TOOL_IDS],
  mcpStatusResponse = { openducktor: { status: "connected" } },
}: MakeMockClientInput = {}) => {
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
  const baseClient = createOpencodeClient({ baseUrl: defaultRuntimeConnection.endpoint });

  const client: OpencodeClient = {
    ...baseClient,
    session: {
      ...baseClient.session,
      create: async (input: ClientMethodInput<"session", "create">) => {
        session.createCalls.push(input);
        return { data: { id: queuedSessionIds.shift() ?? sessionId }, error: undefined };
      },
      promptAsync: async (input: ClientMethodInput<"session", "promptAsync">) => {
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
        return { data: undefined, error: undefined };
      },
      command: async (input: ClientMethodInput<"session", "command">) => {
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
      prompt: async (input: ClientMethodInput<"session", "prompt">) => {
        session.promptCalls.push(input);
        return { data: undefined, error: undefined };
      },
      abort: async (input: ClientMethodInput<"session", "abort">) => {
        session.abortCalls.push(input);
        return { data: true, error: undefined };
      },
      get: async (input: ClientMethodInput<"session", "get">) => {
        session.getCalls.push(input);
        return {
          data: {
            directory: defaultRuntimeConnection.workingDirectory,
            id: sessionId,
            projectID: "project-1",
            slug: sessionId,
            time: {
              created: Date.parse("2026-02-17T12:00:00Z"),
              updated: Date.parse("2026-02-17T12:00:00Z"),
            },
            title: "OpenDucktor test session",
            version: "1.18.18",
          },
          error: undefined,
        };
      },
      update: async (input: ClientMethodInput<"session", "update">) => {
        session.updateCalls.push(input);
        return session.updateResult;
      },
      fork: async (input: ClientMethodInput<"session", "fork">) => {
        session.forkCalls.push(input);
        return { data: { id: forkSessionId }, error: undefined };
      },
      delete: async (input: ClientMethodInput<"session", "delete">) => {
        session.deleteCalls.push(input);
        return { data: true, error: undefined };
      },
      messages: async (input: ClientMethodInput<"session", "messages">) => {
        session.messagesCalls.push(input);
        return {
          data: session.messagesResponse.map(completeMockMessage),
          error: undefined,
        };
      },
      children: async (input: ClientMethodInput<"session", "children">) => {
        session.childrenCalls.push(input);
        return {
          data: childrenResponse,
          error: undefined,
        };
      },
      todo: async (input: ClientMethodInput<"session", "todo">) => {
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
      ...baseClient.permission,
      reply: async (input: ClientMethodInput<"permission", "reply">) => {
        permission.replyCalls.push(input);
        return { data: true, error: undefined };
      },
    },
    question: {
      ...baseClient.question,
      reply: async (input: ClientMethodInput<"question", "reply">) => {
        question.replyCalls.push(input);
        return { data: true, error: undefined };
      },
    },
    config: {
      ...baseClient.config,
      providers: async () => {
        return {
          data: {
            providers: [
              {
                env: [],
                id: "openai",
                name: "OpenAI",
                options: {},
                source: "custom",
                models: {
                  "gpt-5": {
                    api: { id: "gpt-5", npm: "@ai-sdk/openai", url: "https://api.openai.com" },
                    capabilities: {
                      attachment: true,
                      input: { audio: false, image: true, pdf: true, text: true, video: false },
                      interleaved: false,
                      output: { audio: false, image: false, pdf: false, text: true, video: false },
                      reasoning: true,
                      temperature: true,
                      toolcall: true,
                    },
                    cost: { cache: { read: 0, write: 0 }, input: 0, output: 0 },
                    headers: {},
                    id: "gpt-5",
                    name: "GPT-5",
                    limit: {
                      context: 400_000,
                      output: 32_000,
                    },
                    options: {},
                    providerID: "openai",
                    release_date: "2026-01-01",
                    status: "active",
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
          error: undefined,
        };
      },
    },
    app: {
      ...baseClient.app,
      agents: async () => {
        if (agentsResult?.mode === "throw") {
          throw agentsResult.error;
        }
        return {
          data:
            agentsResult?.mode === "api_error"
              ? undefined
              : agentsResponse.map((agent) =>
                  typeof agent === "object" && agent !== null
                    ? { options: {}, permission: [], ...agent }
                    : agent,
                ),
          error: agentsResult?.mode === "api_error" ? agentsResult.error : undefined,
        };
      },
    },
    tool: {
      ...baseClient.tool,
      ids: async (input: ClientMethodInput<"tool", "ids">) => {
        tool.idsCalls.push(input);
        return {
          data: toolIdsResponse,
          error: undefined,
        };
      },
      list: async (input: ClientMethodInput<"tool", "list">) => {
        tool.listCalls.push(input);
        return {
          data: [],
          error: undefined,
        };
      },
    },
    mcp: {
      ...baseClient.mcp,
      status: async (input: ClientMethodInput<"mcp", "status">) => {
        mcp.statusCalls.push(input);
        return {
          data: mcpStatusResponse,
          error: undefined,
        };
      },
      connect: async (input: ClientMethodInput<"mcp", "connect">) => {
        mcp.connectCalls.push(input);
        return {
          data: true,
          error: undefined,
        };
      },
    },
    global: {
      ...baseClient.global,
      event: async (options?: { signal?: AbortSignal }) => {
        async function* iterator() {
          for (const [index, rawEvent] of stream.events.entries()) {
            if (options?.signal?.aborted) {
              return;
            }
            const properties = "properties" in rawEvent ? rawEvent.properties : undefined;
            const directory =
              properties && "directory" in properties && typeof properties.directory === "string"
                ? properties.directory
                : defaultRuntimeConnection.workingDirectory;
            for (const payload of createOpencodeEventFixtures(rawEvent, index)) {
              yield { directory, payload };
            }
          }
        }
        return { stream: iterator() };
      },
    },
  };

  return { client, session, tool, mcp, permission, question, stream } satisfies {
    client: OpencodeClient;
    session: MockSession;
    tool: MockTool;
    mcp: MockMcp;
    permission: MockPermission;
    question: MockQuestion;
    stream: MockEventStream;
  };
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
    ...(model ? { model } : undefined),
  });
};

export const defaultLoadSessionTodosInput = {
  ...defaultRepoRuntimeInput,
  externalSessionId: "session-opencode-1",
};

export const createLoadSessionTodosHarness = (mockInput: MakeMockClientInput) => {
  const createClientCalls: unknown[] = [];
  const mock = makeMockClient(mockInput);
  const adapter = new OpencodeSdkAdapter({
    createClient: (input) => {
      createClientCalls.push(input);
      return mock.client;
    },
    now: () => "2026-02-17T12:00:00Z",
  });

  return { adapter, session: mock.session, createClientCalls } satisfies {
    adapter: BaseOpencodeSdkAdapter;
    session: MockSession;
    createClientCalls: unknown[];
  };
};
