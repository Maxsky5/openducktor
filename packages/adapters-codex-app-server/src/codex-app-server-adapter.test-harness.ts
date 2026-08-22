import { expect, mock } from "bun:test";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  type CodexAppServerProtocolMessage,
  type CodexAppServerThread,
  type CodexAppServerTurn,
  type CodexEffectivePolicy,
  type CodexRuntimeConfig,
  DEFAULT_CODEX_RUNTIME_POLICY,
  type RuntimeInstanceSummary,
  hasRuntimeType,
} from "@openducktor/contracts";
import type { JsonValue } from "@openducktor/contracts";
import type {
  PolicyBoundSessionRef,
  SendAgentUserMessageInput,
  StartAgentSessionInput,
} from "@openducktor/core";
import { workflowAgentSessionScope } from "@openducktor/core";
import type { CodexThreadInventoryReader } from "./codex-thread-inventory";
import type { CodexAppServerStreamEvent } from "./types";
import {
  CodexAppServerAdapter,
  type CodexAppServerAdapterOptions,
  type CodexJsonRpcRequest,
  type CodexJsonRpcTransport,
} from "./index";
import { isPlainObject } from "./codex-app-server-shared";

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

type TestRuntimeStreamMessage = CodexAppServerProtocolMessage;
type TestRuntimeStreamListener = (event: CodexAppServerStreamEvent) => void;

type TestRuntimeStreamSubscription = {
  runtimeId: string;
  listener: TestRuntimeStreamListener;
  active: boolean;
};

export const createRuntimeStreamSubscription = () => {
  const subscriptions: TestRuntimeStreamSubscription[] = [];
  const subscribeEvents = mock((runtimeId: string, listener: TestRuntimeStreamListener) => {
    const subscription = { runtimeId, listener, active: true };
    subscriptions.push(subscription);
    return () => {
      subscription.active = false;
    };
  });
  const emitEvent = (
    subscription: TestRuntimeStreamSubscription,
    kind: "notification" | "server_request",
    message: TestRuntimeStreamMessage,
    receivedAt = new Date().toISOString(),
  ) => {
    subscription.listener({
      runtimeId: subscription.runtimeId,
      kind,
      receivedAt,
      message,
    });
  };
  const latestActiveSubscription = (): TestRuntimeStreamSubscription => {
    const subscription = subscriptions.findLast(({ active }) => active);
    expect(subscription).toBeDefined();
    if (!subscription) {
      throw new Error("Expected an active runtime stream subscription.");
    }
    return subscription;
  };
  const capturedSubscription = (subscription: TestRuntimeStreamSubscription) => ({
    emitNotification: (message: TestRuntimeStreamMessage, receivedAt?: string) =>
      emitEvent(subscription, "notification", message, receivedAt),
  });
  const emitNotification = (message: TestRuntimeStreamMessage, receivedAt?: string) =>
    emitEvent(latestActiveSubscription(), "notification", message, receivedAt);
  const emitServerRequest = (message: TestRuntimeStreamMessage, receivedAt?: string) =>
    emitEvent(latestActiveSubscription(), "server_request", message, receivedAt);
  const captureLatestSubscription = () => capturedSubscription(latestActiveSubscription());
  return {
    subscribeEvents,
    emitNotification,
    emitServerRequest,
    captureLatestSubscription,
    subscriptionCount: () => subscriptions.length,
  };
};

export const createDeferred = <T>(): PromiseWithResolvers<T> => Promise.withResolvers<T>();

export const codexTurnFixture = (
  input: Pick<CodexAppServerTurn, "id" | "items" | "status"> & Partial<CodexAppServerTurn>,
): CodexAppServerTurn => ({
  completedAt: null,
  durationMs: null,
  error: null,
  itemsView: "full",
  startedAt: null,
  ...input,
});

const recordingTransportHistoryTurns = () => [
  codexTurnFixture({
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
  }),
];

export const codexThreadFixture = (
  input: Pick<CodexAppServerThread, "id" | "status"> & Partial<CodexAppServerThread>,
): CodexAppServerThread => ({
  id: input.id,
  extra: null,
  sessionId: input.id,
  forkedFromId: null,
  parentThreadId: null,
  preview: "Live Codex session",
  ephemeral: false,
  section: null,
  sectionEnteredAt: null,
  projectId: null,
  historyMode: "paginated",
  modelProvider: "openai",
  createdAt: 1_778_112_000,
  updatedAt: 1_778_112_000,
  recencyAt: 1_778_112_000,
  status: input.status,
  path: null,
  cwd: "/repo",
  cliVersion: "0.149.0-test",
  source: "appServer",
  canAcceptDirectInput: true,
  threadSource: null,
  agentNickname: null,
  agentRole: null,
  gitInfo: null,
  name: null,
  turns: [],
  ...input,
});

export const codexThreadStartResultFixture = (threadId: string) => ({
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  cwd: "/repo",
  instructionSources: [],
  model: "gpt-5",
  modelProvider: "openai",
  reasoningEffort: "medium",
  sandbox: {
    type: "workspaceWrite",
    excludeSlashTmp: false,
    excludeTmpdirEnvVar: false,
    networkAccess: false,
    writableRoots: ["/repo"],
  },
  serviceTier: null,
  thread: codexThreadFixture({ id: threadId, status: { type: "active", activeFlags: [] } }),
});

const requestThreadId = (params: JsonValue | undefined): string => {
  if (!isPlainObject(params) || !hasRuntimeType(params.threadId, "string")) {
    throw new Error("Expected request params.threadId.");
  }
  return params.threadId;
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

  async request({ method, params }: CodexJsonRpcRequest): Promise<JsonValue> {
    this.calls.push({ method, params });
    switch (method) {
      case "initialize":
        return {
          codexHome: "/tmp/codex-home",
          platformFamily: "unix",
          platformOs: "macos",
          userAgent: "codex_cli_rs/0.149.0-test",
        };
      case "model/list":
        return {
          data: [
            {
              id: "gpt-5",
              additionalSpeedTiers: [],
              availabilityNux: null,
              model: "gpt-5",
              displayName: "GPT-5",
              description: "GPT-5 model",
              hidden: false,
              supportedReasoningEfforts: [
                { reasoningEffort: "medium", description: "Balanced reasoning" },
                { reasoningEffort: "high", description: "Deep reasoning" },
              ],
              defaultReasoningEffort: "medium",
              inputModalities: ["text"],
              serviceTiers: [],
              supportsPersonality: true,
              isDefault: true,
              upgrade: null,
              upgradeInfo: null,
            },
          ],
          nextCursor: null,
        };
      case "thread/start":
      case "thread/resume":
      case "thread/fork": {
        const threadId =
          method === "thread/resume" ? requestThreadId(params) : `${method}-${this.runtimeId}`;
        const result = codexThreadStartResultFixture(threadId);
        return threadId === "thread-idle"
          ? { ...result, thread: codexThreadFixture({ id: threadId, status: { type: "idle" } }) }
          : result;
      }
      case "thread/name/set":
      case "thread/compact/start":
      case "turn/interrupt":
        return {};
      case "turn/start": {
        if (!isPlainObject(params) || !Array.isArray(params.input)) {
          throw new Error("Invalid request: missing field `type`");
        }
        for (const part of params.input) {
          if (!isPlainObject(part) || !hasRuntimeType(part.type, "string")) {
            throw new Error("Invalid request: missing field `type`");
          }
        }
        const deferred = await this.turnStartDeferred.promise;
        if (isPlainObject(deferred) && "turn" in deferred) {
          return deferred;
        }
        this.turnStartCount += 1;
        return {
          turn: {
            completedAt: 1_778_112_031,
            durationMs: 1_000,
            error: null,
            id: `turn-${this.turnStartCount}`,
            items: [],
            itemsView: "full",
            startedAt: 1_778_112_030,
            status: "completed",
          },
        };
      }
      case "turn/steer":
        return { turnId: "turn-steered" };
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
        };
      case "thread/read":
        return {
          thread: codexThreadFixture({
            id: requestThreadId(params),
            status: { type: "active", activeFlags: [] },
          }),
        };
      case "thread/loaded/list":
        return { data: ["thread-saved", "thread-idle"], nextCursor: null };
      case "thread/list":
        return {
          data: [
            codexThreadFixture({ id: "thread/start-runtime-live", status: { type: "idle" } }),
            codexThreadFixture({
              id: "thread-saved",
              status: { type: "active", activeFlags: [] },
              preview: "Saved running session",
            }),
            codexThreadFixture({
              id: "thread-idle",
              createdAt: 1_778_112_010,
              status: { type: "idle" },
              preview: "Saved idle session",
            }),
          ],
          nextCursor: null,
          backwardsCursor: null,
        };
      case "thread/turns/list":
        return {
          data: recordingTransportHistoryTurns(),
          nextCursor: null,
          backwardsCursor: null,
        };
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

export const createAdapterWithTransport = (
  transport: CodexJsonRpcTransport,
  overrides: Partial<CodexAppServerAdapterOptions> = {},
) =>
  new CodexAppServerAdapter({
    repoRuntimeResolver: {
      requireRepoRuntime: async () => makeRuntimeSummary("runtime-live"),
    },
    transportFactory: () => transport,
    onRuntimeEventQueueFailure: () => {
      return undefined;
    },
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
    onRuntimeEventQueueFailure: () => {
      return undefined;
    },
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

// SAFETY: This test controls the fixture and supplies `{ threadInventory: CodexThreadInventoryReader }` used by this case.
export const codexThreadInventoryForTest = (
  adapter: CodexAppServerAdapter,
): CodexThreadInventoryReader =>
  (adapter as { threadInventory: CodexThreadInventoryReader }).threadInventory;

type CodexRuntimeTeardownCounts = {
  statusOverrideRuntimeCount: number;
  statusOverrideThreadCount: number;
  runtimeEventQueueRuntimeCount: number;
};

export const codexRuntimeTeardownCountsForTest = (
  adapter: CodexAppServerAdapter,
  runtimeId: string,
): CodexRuntimeTeardownCounts => {
  const threadInventory = codexThreadInventoryForTest(adapter);
  // SAFETY: This test controls the fixture and supplies `{ statusOverridesByRuntimeId: Map<string, Map<string, unknown>>; }` used by this case.
  const statusOverridesByRuntimeId = (
    threadInventory as {
      statusOverridesByRuntimeId: Map<string, Map<string, unknown>>;
    }
  ).statusOverridesByRuntimeId;
  // SAFETY: This test controls the fixture and supplies the asserted shape used by this case.
  const runtimeEventProcessingByRuntimeId = (
    adapter as {
      runtimeEvents: {
        runtimeEventProcessingByRuntimeId: Map<string, Promise<void>>;
      };
    }
  ).runtimeEvents.runtimeEventProcessingByRuntimeId;

  return {
    statusOverrideRuntimeCount: statusOverridesByRuntimeId.size,
    statusOverrideThreadCount: statusOverridesByRuntimeId.get(runtimeId)?.size ?? 0,
    runtimeEventQueueRuntimeCount: runtimeEventProcessingByRuntimeId.size,
  };
};

export function waitForEvent<Event, Match extends Event>(
  events: Event[],
  predicate: (event: Event) => event is Match,
): Promise<Match>;
export function waitForEvent<Event>(
  events: Event[],
  predicate: (event: Event) => boolean,
): Promise<Event>;
export async function waitForEvent<Event>(
  events: Event[],
  predicate: (event: Event) => boolean,
): Promise<Event> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const event = events.find(predicate);
    if (event) {
      return event;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for Codex event.");
}

export const flushCodexAdapterWork = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};
