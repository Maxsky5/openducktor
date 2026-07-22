import { expect, mock } from "bun:test";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  type CodexEffectivePolicy,
  type CodexRuntimeConfig,
  DEFAULT_CODEX_RUNTIME_POLICY,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import type {
  PolicyBoundSessionRef,
  SendAgentUserMessageInput,
  StartAgentSessionInput,
} from "@openducktor/core";
import { workflowAgentSessionScope } from "@openducktor/core";
import {
  CodexAppServerAdapter,
  type CodexAppServerAdapterOptions,
  type CodexJsonRpcRequest,
  type CodexJsonRpcTransport,
} from "./index";

export const makeRuntimeSummary = (runtimeId: string): RuntimeInstanceSummary => ({
  kind: "codex",
  runtimeId,
  repoPath: "/repo",
  taskId: null,
  role: "workspace",
  workingDirectory: "/repo",
  runtimeRoute: { type: "stdio", identity: runtimeId },
  startedAt: "2026-05-07T00:00:00.000Z",
  descriptor: CODEX_RUNTIME_DESCRIPTOR,
});

export const codexSessionRef = (
  externalSessionId = "thread/start-runtime-live",
): PolicyBoundSessionRef => ({
  externalSessionId,
  repoPath: "/repo",
  runtimeKind: "codex",
  workingDirectory: "/repo",
  sessionScope: workflowAgentSessionScope("task-1", "build"),
  runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
});

export const codexSessionRuntimeRef = (
  externalSessionId = "thread/start-runtime-live",
  overrides: Partial<PolicyBoundSessionRef> = {},
): PolicyBoundSessionRef => ({
  externalSessionId,
  repoPath: "/repo",
  runtimeKind: "codex",
  workingDirectory: "/repo",
  sessionScope: workflowAgentSessionScope("task-1", "build"),
  runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
  systemPrompt: "Use the repo rules.",
  model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
  ...overrides,
});

export const codexStartSessionInput = (
  overrides: Partial<StartAgentSessionInput> = {},
): StartAgentSessionInput => ({
  repoPath: "/repo",
  runtimeKind: "codex",
  workingDirectory: "/repo",
  sessionScope: workflowAgentSessionScope("task-1", "build"),
  runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
  systemPrompt: "Use the repo rules.",
  model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
  ...overrides,
});

export const codexUserMessageInput = (
  input: Pick<SendAgentUserMessageInput, "parts"> &
    Partial<Omit<SendAgentUserMessageInput, "parts">>,
): SendAgentUserMessageInput => {
  const { model: _defaultModel, ...base } = codexSessionRuntimeRef(input.externalSessionId);
  return {
    ...base,
    ...input,
  };
};

type TestRuntimeStreamListener = (event: {
  runtimeId: string;
  kind: "notification" | "server_request";
  receivedAt: string;
  message: unknown;
}) => void;

export const createRuntimeStreamSubscription = () => {
  const streamListeners: TestRuntimeStreamListener[] = [];
  const subscribeEvents = mock((_runtimeId: string, listener: TestRuntimeStreamListener) => {
    streamListeners.push(listener);
    return () => {};
  });
  const emitEvent = (
    kind: "notification" | "server_request",
    message: unknown,
    receivedAt = new Date().toISOString(),
  ) => {
    const listener = streamListeners[0];
    expect(listener).toBeDefined();
    listener?.({
      runtimeId: "runtime-live",
      kind,
      receivedAt,
      message,
    });
  };
  const emitNotification = (message: unknown, receivedAt?: string) =>
    emitEvent("notification", message, receivedAt);
  const emitServerRequest = (message: unknown, receivedAt?: string) =>
    emitEvent("server_request", message, receivedAt);
  return { subscribeEvents, emitNotification, emitServerRequest };
};

export const createDeferred = <T>() => {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return {
    promise,
    resolve: (value: T) => {
      resolve?.(value);
    },
  };
};

export class RecordingTransport implements CodexJsonRpcTransport {
  readonly calls: CodexJsonRpcRequest[] = [];
  readonly turnStartDeferred = createDeferred<unknown>();
  private turnStartCount = 0;

  constructor(
    private readonly runtimeId: string,
    deferTurnStart: boolean,
  ) {
    if (!deferTurnStart) {
      this.turnStartDeferred.resolve({});
    }
  }

  async request<Response>({ method, params }: CodexJsonRpcRequest): Promise<Response> {
    this.calls.push({ method, params });
    switch (method) {
      case "initialize":
        return {} as Response;
      case "model/list":
        return {
          data: [
            {
              id: "gpt-5",
              model: "gpt-5",
              displayName: "GPT-5",
              description: "GPT-5 model",
              hidden: false,
              supportedReasoningEfforts: [
                { reasoningEffort: "medium", description: "Balanced reasoning" },
                { reasoningEffort: "high", description: "Deep reasoning" },
              ],
              defaultReasoningEffort: {
                reasoningEffort: "medium",
                description: "Balanced reasoning",
              },
              inputModalities: ["text"],
              supportsPersonality: true,
              isDefault: true,
            },
          ],
          nextCursor: null,
        } as Response;
      case "thread/start":
      case "thread/resume":
      case "thread/fork": {
        const threadId =
          method === "thread/resume"
            ? (params as { threadId: string }).threadId
            : `${method}-${this.runtimeId}`;
        const turns =
          method === "thread/resume" &&
          (threadId === "thread-idle" || threadId === "thread/start-runtime-live")
            ? [
                {
                  id: "turn-1",
                  startedAt: 1_778_112_001,
                  completedAt: 1_778_112_031,
                  status: "completed",
                  items: [
                    {
                      id: "msg-1",
                      type: "agentMessage",
                      phase: "final_answer",
                      text: "Hello from history",
                    },
                  ],
                },
              ]
            : [];
        return {
          thread: {
            id: threadId,
            cwd: "/repo",
            createdAt: 1_778_112_000,
            preview: "Live Codex session",
            status:
              threadId === "thread-idle" ? { type: "idle" } : { type: "active", activeFlags: [] },
            turns,
          },
          startedAt: "2026-05-07T00:00:00.000Z",
        } as Response;
      }
      case "thread/name/set":
        return {} as Response;
      case "turn/start": {
        if (
          !Array.isArray((params as { input?: unknown })?.input) ||
          (params as { input: Array<{ type?: unknown }> }).input.some(
            (part) => typeof part.type !== "string",
          )
        ) {
          throw new Error("Invalid request: missing field `type`");
        }
        const deferred = await this.turnStartDeferred.promise;
        if (typeof deferred === "object" && deferred !== null && "turn" in deferred) {
          return deferred as Response;
        }
        this.turnStartCount += 1;
        return { turn: { id: `turn-${this.turnStartCount}`, status: "completed" } } as Response;
      }
      case "turn/steer":
        return { turnId: "turn-steered" } as Response;
      case "skills/list":
        return {
          data: [
            {
              cwd: "/repo",
              skills: [
                {
                  name: "create-pr",
                  description: "Create a pull request",
                  path: "/repo/.codex/skills/create-pr/SKILL.md",
                  scope: "repo",
                  enabled: true,
                },
              ],
              errors: [],
            },
          ],
        } as Response;
      case "thread/read":
        return {
          thread: {
            id: (params as { threadId: string }).threadId,
            cwd: "/repo",
            createdAt: 1_778_112_000,
            preview: "Live Codex session",
            status: { type: "active", activeFlags: [] },
            turns: [
              {
                id: "turn-1",
                startedAt: 1_778_112_001,
                completedAt: 1_778_112_031,
                status: "completed",
                items: [
                  {
                    id: "user-history-1",
                    type: "userMessage",
                    content: [{ type: "text", text: "Hello Codex" }],
                  },
                  {
                    id: "reason-1",
                    type: "reasoning",
                    summary: ["Thinking"],
                    content: [],
                  },
                  {
                    id: "cmd-read-1",
                    type: "commandExecution",
                    command: "cat src/app.ts",
                    cwd: "/repo",
                    processId: "pty-1",
                    source: "model",
                    status: "completed",
                    commandActions: [
                      {
                        type: "read",
                        command: "cat src/app.ts",
                        name: "app.ts",
                        path: "/repo/src/app.ts",
                      },
                    ],
                    aggregatedOutput: "export const app = true;",
                    exitCode: 0,
                    durationMs: 12,
                  },
                  {
                    id: "cmd-bash-1",
                    type: "command_execution",
                    command: "bun test",
                    cwd: "/repo",
                    processId: "pty-2",
                    source: "model",
                    status: "completed",
                    command_actions: [{ type: "unknown", command: "bun test" }],
                    aggregated_output: "1 pass",
                    exitCode: 0,
                    durationMs: 34,
                  },
                  {
                    id: "file-change-1",
                    type: "fileChange",
                    status: "completed",
                    changes: [
                      {
                        path: "/repo/src/app.ts",
                        kind: "update",
                        diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n-old\n+new",
                      },
                    ],
                  },
                  {
                    id: "file-change-failed-1",
                    type: "fileChange",
                    status: "failed",
                    error: "patch failed",
                    changes: [
                      {
                        path: "/repo/src/broken.ts",
                        kind: "update",
                        diff: "--- a/src/broken.ts\n+++ b/src/broken.ts\n@@\n-old\n+broken",
                      },
                    ],
                  },
                  {
                    id: "dynamic-tool-1",
                    type: "dynamicToolCall",
                    namespace: "codex",
                    tool: "read",
                    arguments: { path: "/repo/README.md" },
                    status: "completed",
                    contentItems: [{ type: "inputText", text: "README" }],
                    success: true,
                    durationMs: 5,
                  },
                  {
                    id: "web-search-1",
                    type: "webSearch",
                    query: "OpenDucktor Codex runtime",
                    output: "search results",
                    action: null,
                  },
                  {
                    id: "tool-1",
                    type: "mcpToolCall",
                    server: "openducktor",
                    tool: "odt_read_task",
                    status: "completed",
                    arguments: { taskId: "task-1" },
                    result: { content: [{ type: "text", text: "ok" }] },
                  },
                  {
                    id: "tool-failed-1",
                    type: "mcpToolCall",
                    server: "openducktor",
                    tool: "odt_read_task",
                    status: "completed",
                    arguments: { taskId: "missing" },
                    result: { isError: true, message: "task missing" },
                  },
                  {
                    id: "msg-1",
                    type: "agentMessage",
                    phase: "final_answer",
                    text: "Hello from history",
                  },
                  {
                    id: "msg-commentary-1",
                    type: "agentMessage",
                    phase: "commentary",
                    text: "Later commentary",
                  },
                ],
              },
            ],
          },
        } as Response;
      case "thread/loaded/list":
        return { data: ["thread-saved", { id: "thread-idle" }], nextCursor: null } as Response;
      case "thread/list":
        return {
          data: [
            {
              id: "thread/start-runtime-live",
              cwd: "/repo",
              createdAt: 1_778_112_000,
              preview: "Live Codex session",
              status: { type: "idle" },
            },
            {
              id: "thread-saved",
              cwd: "/repo",
              createdAt: 1_778_112_000,
              preview: "Saved running session",
              status: { type: "active", activeFlags: [] },
            },
            {
              id: "thread-idle",
              cwd: "/repo",
              createdAt: 1_778_112_010,
              preview: "Saved idle session",
              status: { type: "idle" },
            },
          ],
          nextCursor: null,
          backwardsCursor: null,
        } as Response;
      case "thread/turns/list":
        return { data: [] } as Response;
      case "turn/diff":
        return {
          data: [
            {
              fileChanges: [
                {
                  file: "src/app.ts",
                  type: "modified",
                  additions: 1,
                  deletions: 0,
                  diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n",
                },
              ],
            },
          ],
        } as Response;
      default:
        throw new Error(`Unexpected method '${method}'.`);
    }
  }
}

export const defaultCodexRuntimeConfig = (): CodexRuntimeConfig => ({
  enabled: true,
  defaults: { ...DEFAULT_CODEX_RUNTIME_POLICY },
  roleOverrides: {},
});

export const defaultCodexEffectivePolicy = (): CodexEffectivePolicy => ({
  ...DEFAULT_CODEX_RUNTIME_POLICY,
  approvalsReviewerApplies: true,
});

const defaultThreadResumeResponse = (request: CodexJsonRpcRequest) => {
  const threadId = (request.params as { threadId: string }).threadId;
  return {
    thread: {
      id: threadId,
      cwd: "/repo",
      createdAt: 1,
      status: { type: "idle" },
      turns: [],
    },
  };
};

const withDefaultThreadResume = (transport: CodexJsonRpcTransport): CodexJsonRpcTransport => ({
  async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
    if (request.method === "thread/resume") {
      try {
        return await transport.request<Response>(request);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.startsWith("Unexpected method 'thread/resume'")) {
          throw error;
        }
        return defaultThreadResumeResponse(request) as Response;
      }
    }
    return transport.request<Response>(request);
  },
});

export const createAdapterWithTransport = (
  transport: CodexJsonRpcTransport,
  overrides: Partial<CodexAppServerAdapterOptions> = {},
) =>
  new CodexAppServerAdapter({
    repoRuntimeResolver: {
      requireRepoRuntime: async () => makeRuntimeSummary("runtime-live"),
    },
    transportFactory: () => withDefaultThreadResume(transport),
    onRuntimeEventQueueFailure: () => {},
    subscribeEvents: () => () => {},
    respondServerRequest: async () => {},
    ...overrides,
  });

export const createHarness = (
  overrides: Partial<CodexAppServerAdapterOptions> = {},
  options: { deferTurnStart?: boolean } = {},
) => {
  const transports = new Map<string, RecordingTransport>();
  const transportFactory = mock((runtimeId: string) => {
    const existing = transports.get(runtimeId);
    if (existing) {
      return existing;
    }
    const transport = new RecordingTransport(runtimeId, options.deferTurnStart ?? false);
    transports.set(runtimeId, transport);
    return transport;
  });
  const requireRepoRuntime = mock(async ({ repoPath, runtimeKind }) => ({
    ...makeRuntimeSummary("runtime-live"),
    repoPath,
    kind: runtimeKind,
    runtimeId: "runtime-live",
  }));
  const respondServerRequest = mock(async () => {});

  const adapter = new CodexAppServerAdapter({
    repoRuntimeResolver: {
      requireRepoRuntime,
    },
    transportFactory,
    onRuntimeEventQueueFailure: () => {},
    subscribeEvents: () => () => {},
    respondServerRequest,
    ...overrides,
  });

  return {
    adapter,
    transports,
    transportFactory,
    requireRepoRuntime,
    respondServerRequest,
  };
};

export const waitForEvent = async (
  events: unknown[],
  predicate: (event: unknown) => boolean,
): Promise<unknown> => {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const event = events.find(predicate);
    if (event) {
      return event;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for Codex event.");
};

export const flushCodexAdapterWork = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};
