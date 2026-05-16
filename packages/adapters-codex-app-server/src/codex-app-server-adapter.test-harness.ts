import { mock } from "bun:test";
import { CODEX_RUNTIME_DESCRIPTOR, type RuntimeInstanceSummary } from "@openducktor/contracts";
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
        return {
          thread: {
            id: threadId,
            cwd: "/repo",
            createdAt: 1_778_112_000,
            preview: "Live Codex session",
            status:
              threadId === "thread-idle" ? { type: "idle" } : { type: "active", activeFlags: [] },
          },
          startedAt: "2026-05-07T00:00:00.000Z",
        } as Response;
      }
      case "turn/start":
        if (
          !Array.isArray((params as { input?: unknown })?.input) ||
          (params as { input: Array<{ type?: unknown }> }).input.some(
            (part) => typeof part.type !== "string",
          )
        ) {
          throw new Error("Invalid request: missing field `type`");
        }
        return (await this.turnStartDeferred.promise) as Response;
      case "turn/steer":
        return { turnId: "turn-steered" } as Response;
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
              id: "thread/start-runtime-ensure",
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
                { file: "src/app.ts", type: "modified", additions: 1, deletions: 0, diff: "@@" },
              ],
            },
          ],
        } as Response;
      default:
        throw new Error(`Unexpected method '${method}'.`);
    }
  }
}

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
  const ensureRepoRuntime = mock(async ({ repoPath, runtimeKind }) => ({
    ...makeRuntimeSummary("runtime-ensure"),
    repoPath,
    kind: runtimeKind,
    runtimeId: "runtime-ensure",
  }));
  const requireRepoRuntime = mock(async ({ repoPath, runtimeKind }) => ({
    ...makeRuntimeSummary("runtime-live"),
    repoPath,
    kind: runtimeKind,
    runtimeId: "runtime-live",
  }));
  const requireRuntimeById = mock(async ({ repoPath, runtimeKind }, runtimeId: string) => ({
    ...makeRuntimeSummary(runtimeId),
    repoPath,
    kind: runtimeKind,
    runtimeId,
  }));
  const drainServerRequests = mock(async (_runtimeId: string) => [] as unknown[]);
  const drainNotifications = mock(async (_runtimeId: string) => [] as unknown[]);
  const respondServerRequest = mock(async () => {});

  const adapter = new CodexAppServerAdapter({
    repoRuntimeResolver: {
      ensureRepoRuntime,
      requireRepoRuntime,
      requireRuntimeById,
    },
    transportFactory,
    drainServerRequests,
    respondServerRequest,
    ...overrides,
  });

  return {
    adapter,
    transports,
    transportFactory,
    ensureRepoRuntime,
    requireRepoRuntime,
    requireRuntimeById,
    drainServerRequests,
    drainNotifications,
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
