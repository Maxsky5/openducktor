import { describe, expect, mock, test } from "bun:test";
import {
  RUNTIME_DESCRIPTORS_BY_KIND,
  codexAppServerClientRequestSchema,
  parseCodexAppServerRequestResult,
  type CodexAppServerClientRequestMap,
  type CodexAppServerRequestMethod,
  type RuntimeInstanceSummary,
  type RuntimeKind,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createClaudeAgentSdkSessionStore } from "../claude/claude-agent-sdk-session-store";
import { createClaudeQueryFixture } from "../claude/claude-agent-sdk-session-io.test-support";
import { AsyncInputQueue } from "../claude/claude-agent-sdk-queue";
import type { ClaudeSession } from "../claude/claude-agent-sdk-types";
import {
  type CreateRuntimeSessionOperationsInput,
  createRuntimeSessionOperations,
  probeRuntimeSessionStatus,
  stopRuntimeSession,
} from "./runtime-session-operations";

type FetchRequest = (
  ...args: Parameters<typeof globalThis.fetch>
) => ReturnType<typeof globalThis.fetch>;

const fetchFixture = (request: FetchRequest): typeof globalThis.fetch =>
  Object.assign(request, { preconnect: () => {} });

const openCodeRuntime: RuntimeInstanceSummary = {
  kind: "opencode",
  runtimeId: "runtime-opencode",
  runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4096" },
  startedAt: "2026-05-10T10:00:00.000Z",
  descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
};

const createCodexRuntime = (
  overrides: Partial<RuntimeInstanceSummary> = {},
): RuntimeInstanceSummary => ({
  kind: "codex",
  runtimeId: "runtime-1",
  runtimeRoute: { type: "stdio", identity: "runtime-1" },
  startedAt: "2026-05-10T10:00:00.000Z",
  descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
  ...overrides,
});

const codexResult = <Method extends CodexAppServerRequestMethod>(
  method: Method,
  value: CodexAppServerClientRequestMap[Method]["result"],
) => Effect.succeed(parseCodexAppServerRequestResult(method, value));

const codexThreadReadResult = (
  threadId: string,
  cwd: string,
  status: { type: "active"; activeFlags: [] } | { type: "idle" | "notLoaded" | "systemError" },
) =>
  codexResult("thread/read", {
    thread: {
      id: threadId,
      extra: null,
      sessionId: threadId,
      forkedFromId: null,
      parentThreadId: null,
      preview: "Test thread",
      ephemeral: false,
      section: null,
      sectionEnteredAt: null,
      projectId: null,
      historyMode: "paginated",
      modelProvider: "openai",
      createdAt: 1,
      updatedAt: 1,
      recencyAt: 1,
      status,
      path: null,
      cwd,
      cliVersion: "0.149.0-test",
      source: "appServer",
      canAcceptDirectInput: true,
      threadSource: null,
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      name: null,
      turns: [],
    },
  });

const sessionTarget = (runtimeKind: RuntimeKind, externalSessionId = "session-1") => ({
  runtimeKind,
  externalSessionId,
  workingDirectory: "/repo/worktree",
});

const stopSession = (
  runtime: RuntimeInstanceSummary,
  operationsInput: CreateRuntimeSessionOperationsInput = {},
  externalSessionId = "session-1",
) =>
  Effect.runPromise(
    stopRuntimeSession({
      input: sessionTarget(runtime.kind, externalSessionId),
      runtime,
      sessionOperations: createRuntimeSessionOperations(operationsInput),
    }),
  );

const probeSession = (
  runtime: RuntimeInstanceSummary | null,
  runtimeKind: RuntimeKind,
  operationsInput: CreateRuntimeSessionOperationsInput = {},
  externalSessionId = "session-1",
) =>
  Effect.runPromise(
    probeRuntimeSessionStatus({
      input: sessionTarget(runtimeKind, externalSessionId),
      runtime,
      sessionOperations: createRuntimeSessionOperations(operationsInput),
    }),
  );

const claudeRuntime: RuntimeInstanceSummary = {
  kind: "claude",
  runtimeId: "runtime-claude",
  runtimeRoute: { type: "host_service", identity: "runtime-claude" },
  startedAt: "2026-07-17T10:00:00.000Z",
  descriptor: RUNTIME_DESCRIPTORS_BY_KIND.claude,
};

const createSession = (repoPath: string, externalSessionId: string): ClaudeSession => ({
  acceptedUserMessages: [],
  activeSdkUserTurnCount: 1,
  abortController: new AbortController(),
  activity: "running",
  externalSessionId,
  input: {
    repoPath,
    runtimeKind: "claude",
    workingDirectory: `${repoPath}/worktree`,
    runtimePolicy: { kind: "claude" },
    sessionScope: { kind: "repository" },
    systemPrompt: "Help",
  },
  model: undefined,
  pendingApprovals: new Map(),
  pendingQuestions: new Map(),
  queuedSdkMessages: [],
  pendingUserTurnCount: 0,
  query: createClaudeQueryFixture({}),
  queue: new AsyncInputQueue(),
  runtimeId: "runtime-claude",
  startedAt: "2026-07-17T10:01:00.000Z",
  summary: {
    externalSessionId,
    runtimeKind: "claude",
    workingDirectory: `${repoPath}/worktree`,
    sessionAssociation: { kind: "repository" },
    startedAt: "2026-07-17T10:01:00.000Z",
    status: "running",
  },
  streamAssistantMessageOrdinal: 0,
  streamAssistantMessageIdsByBlockIndex: new Map(),
  subagentMessageIdsByTaskId: new Map(),
  subagentTaskIdsByToolUseId: new Map(),
  toolEndedAtMsByCallId: new Map(),
  toolInputsByCallId: new Map(),
  toolMessageIdsByCallId: new Map(),
  toolNamesByCallId: new Map(),
  toolStartedAtMsByCallId: new Map(),
  todosById: new Map(),
});

describe("Claude runtime session operations", () => {
  test("stops and probes a session of the shared Claude service without a repository", async () => {
    const sessionStore = createClaudeAgentSdkSessionStore();
    sessionStore.set(createSession("/repo-a", "session-a"));
    sessionStore.set(createSession("/repo-b", "session-b"));
    const sessionOperations = createRuntimeSessionOperations({ claudeAgentSdk: sessionStore });
    const target = {
      runtimeKind: "claude" as const,
      externalSessionId: "session-b",
      workingDirectory: "/repo-b/worktree",
    };

    await expect(
      Effect.runPromise(
        probeRuntimeSessionStatus({ input: target, runtime: claudeRuntime, sessionOperations }),
      ),
    ).resolves.toEqual({ supported: true, hasLiveSession: true });
    await Effect.runPromise(
      stopRuntimeSession({ input: target, runtime: claudeRuntime, sessionOperations }),
    );

    expect(sessionStore.get("session-b")).toBeUndefined();
    expect(sessionStore.get("session-a")?.activity).toBe("running");
    await expect(
      Effect.runPromise(
        probeRuntimeSessionStatus({ input: target, runtime: claudeRuntime, sessionOperations }),
      ),
    ).resolves.toEqual({ supported: true, hasLiveSession: false });
  });

  test("reports an unknown Claude session as a resource failure", async () => {
    const sessionOperations = createRuntimeSessionOperations({
      claudeAgentSdk: createClaudeAgentSdkSessionStore(),
    });

    await expect(
      Effect.runPromise(
        stopRuntimeSession({
          input: {
            runtimeKind: "claude",
            externalSessionId: "missing",
            workingDirectory: "/repo/worktree",
          },
          runtime: claudeRuntime,
          sessionOperations,
        }),
      ),
    ).rejects.toThrow("Unknown Claude session 'missing'.");
  });
});

describe("Claude runtime session routing", () => {
  test("routes Claude session stop and status probes through the Claude Agent SDK service", async () => {
    const stops: unknown[] = [];
    const probes: unknown[] = [];
    const claudeAgentSdk: CreateRuntimeSessionOperationsInput["claudeAgentSdk"] = {
      stopSession(input) {
        stops.push(input);
        return Effect.void;
      },
      probeSessionStatus(input) {
        probes.push(input);
        return Effect.succeed({ supported: true, hasLiveSession: true });
      },
    };

    await expect(stopSession(claudeRuntime, { claudeAgentSdk })).resolves.toBeUndefined();
    await expect(probeSession(claudeRuntime, "claude", { claudeAgentSdk })).resolves.toEqual({
      supported: true,
      hasLiveSession: true,
    });
    expect(stops).toEqual([sessionTarget("claude")]);
    expect(probes).toEqual([sessionTarget("claude")]);
  });

  test("fails Claude session operations without the Claude Agent SDK service", async () => {
    await expect(probeSession(claudeRuntime, "claude")).rejects.toThrow(
      "Claude session status probing requires the Claude Agent SDK service.",
    );
    await expect(stopSession(claudeRuntime)).rejects.toThrow(
      "Claude session stop requires the Claude Agent SDK service.",
    );
  });
});

describe("OpenCode runtime session operations", () => {
  test("aborts and probes OpenCode sessions through the local runtime endpoint", async () => {
    const requests: Array<{
      method: string;
      pathname: string;
      directory: string | null;
    }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchFixture(
      mock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : null;
        const url = new URL(request?.url ?? input.toString());
        const method = init?.method ?? request?.method ?? "GET";
        requests.push({
          method,
          pathname: url.pathname,
          directory: url.searchParams.get("directory"),
        });
        if (method === "POST" && url.pathname === "/session/session-1/abort") {
          return new Response("aborted", { status: 200 });
        }
        if (method === "GET" && url.pathname === "/session/status") {
          return Response.json({ "session-1": { type: "busy" } });
        }
        return new Response("not found", { status: 404 });
      }),
    );
    try {
      await expect(stopSession(openCodeRuntime)).resolves.toBeUndefined();
      await expect(probeSession(openCodeRuntime, "opencode")).resolves.toEqual({
        supported: true,
        hasLiveSession: true,
      });
      expect(requests).toEqual([
        {
          method: "POST",
          pathname: "/session/session-1/abort",
          directory: "/repo/worktree",
        },
        {
          method: "GET",
          pathname: "/session/status",
          directory: "/repo/worktree",
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Codex runtime session operations", () => {
  test("treats session status probes without a runtime as inactive", async () => {
    const calls: unknown[] = [];
    await expect(
      probeSession(null, "codex", {
        codexAppServer: {
          request(input) {
            calls.push(input);
            return codexResult("turn/interrupt", {});
          },
        },
      }),
    ).resolves.toEqual({ supported: true, hasLiveSession: false });
    expect(calls).toEqual([]);
  });

  test("probes Codex session status through the host-managed app-server transport", async () => {
    const calls: unknown[] = [];
    const codexAppServer: CreateRuntimeSessionOperationsInput["codexAppServer"] = {
      request(input) {
        calls.push(input);
        const request = codexAppServerClientRequestSchema.parse({
          method: input.method,
          params: input.params,
        });
        if (request.method !== "thread/read") {
          throw new Error(`Expected thread/read, received ${request.method}.`);
        }
        const threadId = request.params.threadId;
        let status: Parameters<typeof codexThreadReadResult>[2];
        switch (threadId) {
          case "session-1":
          case "session-5":
            status = { type: "active", activeFlags: [] };
            break;
          case "session-2":
            status = { type: "idle" };
            break;
          case "session-3":
            status = { type: "systemError" };
            break;
          case "session-4":
            status = { type: "notLoaded" };
            break;
          default:
            throw new Error(`Unexpected test thread '${threadId}'.`);
        }
        return codexThreadReadResult(
          threadId,
          threadId === "session-5" ? "/repo/other-worktree" : "/repo/worktree",
          status,
        );
      },
    };
    const runtime = createCodexRuntime();
    const expectedLiveSessions: Array<[string, boolean]> = [
      ["session-1", true],
      ["session-2", false],
      ["session-3", true],
      ["session-4", false],
      ["session-5", false],
    ];

    for (const [sessionId, hasLiveSession] of expectedLiveSessions) {
      await expect(probeSession(runtime, "codex", { codexAppServer }, sessionId)).resolves.toEqual({
        supported: true,
        hasLiveSession,
      });
    }
    expect(calls).toEqual(
      expectedLiveSessions.map(([threadId]) => ({
        runtimeId: "runtime-1",
        method: "thread/read",
        params: { threadId, includeTurns: false },
      })),
    );
  });

  test("treats missing Codex session probe threads as inactive", async () => {
    await expect(
      probeSession(
        createCodexRuntime(),
        "codex",
        {
          codexAppServer: {
            request(input) {
              return Effect.fail(
                new HostOperationError({
                  operation: `codexAppServerTransport.request.${input.method}`,
                  message: `Codex app-server request ${input.method} failed for runtime ${input.runtimeId}: thread not found`,
                  details: { runtimeId: input.runtimeId, method: input.method },
                }),
              );
            },
          },
        },
        "missing-session",
      ),
    ).resolves.toEqual({ supported: true, hasLiveSession: false });
  });

  test("fails malformed Codex session probe thread payloads with a typed error", async () => {
    await expect(
      probeSession(createCodexRuntime(), "codex", {
        codexAppServer: {
          request() {
            return Effect.succeed(parseCodexAppServerRequestResult("thread/read", {}));
          },
        },
      }),
    ).rejects.toThrow('"thread"');
  });

  test("interrupts an active Codex session through the app-server port", async () => {
    const calls: unknown[] = [];
    await expect(
      stopSession(createCodexRuntime(), {
        codexAppServer: {
          request(input) {
            calls.push(input);
            if (input.method === "thread/read") {
              return codexThreadReadResult("session-1", "/repo/worktree", {
                type: "active",
                activeFlags: [],
              });
            }
            if (input.method === "thread/turns/list") {
              return codexResult("thread/turns/list", {
                data: [
                  {
                    id: "turn-1",
                    startedAt: 1_778_112_001,
                    completedAt: null,
                    durationMs: null,
                    error: null,
                    items: [],
                    itemsView: "summary",
                    status: "inProgress",
                  },
                ],
                nextCursor: null,
                backwardsCursor: null,
              });
            }
            return codexResult("turn/interrupt", {});
          },
        },
      }),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([
      {
        runtimeId: "runtime-1",
        method: "thread/read",
        params: { threadId: "session-1", includeTurns: false },
      },
      {
        runtimeId: "runtime-1",
        method: "thread/turns/list",
        params: {
          threadId: "session-1",
          limit: 20,
          sortDirection: "desc",
          itemsView: "summary",
        },
      },
      {
        runtimeId: "runtime-1",
        method: "turn/interrupt",
        params: { threadId: "session-1", turnId: "turn-1" },
      },
    ]);
  });

  test.each([["idle" as const], ["systemError" as const]])(
    "treats Codex %s sessions as already stopped",
    async (statusType) => {
      const calls: unknown[] = [];
      await expect(
        stopSession(createCodexRuntime(), {
          codexAppServer: {
            request(input) {
              calls.push(input);
              return codexThreadReadResult("session-1", "/repo/worktree", { type: statusType });
            },
          },
        }),
      ).resolves.toBeUndefined();
      expect(calls).toEqual([
        {
          runtimeId: "runtime-1",
          method: "thread/read",
          params: { threadId: "session-1", includeTurns: false },
        },
      ]);
    },
  );

  test("completes active Codex stop when no active turn can be found", async () => {
    await expect(
      stopSession(createCodexRuntime(), {
        codexAppServer: {
          request(input) {
            if (input.method === "thread/read") {
              return codexThreadReadResult("session-1", "/repo/worktree", {
                type: "active",
                activeFlags: [],
              });
            }
            return codexResult("thread/turns/list", {
              data: [
                {
                  id: "turn-1",
                  startedAt: 1_778_112_001,
                  completedAt: 1_778_112_031,
                  durationMs: 30,
                  error: null,
                  items: [],
                  itemsView: "summary",
                  status: "completed",
                },
              ],
              nextCursor: null,
              backwardsCursor: null,
            });
          },
        },
      }),
    ).resolves.toBeUndefined();
  });

  test("fails malformed Codex turn-list payloads with a typed error", async () => {
    await expect(
      stopSession(createCodexRuntime(), {
        codexAppServer: {
          request(input) {
            if (input.method === "thread/read") {
              return codexThreadReadResult("session-1", "/repo/worktree", {
                type: "active",
                activeFlags: [],
              });
            }
            return Effect.succeed(parseCodexAppServerRequestResult("thread/turns/list", {}));
          },
        },
      }),
    ).rejects.toThrow('"data"');
  });

  test("fails Codex stop without the app-server port or a Codex runtime route", async () => {
    await expect(stopSession(createCodexRuntime())).rejects.toThrow(
      "Codex session stop requires the Codex app-server port.",
    );
    await expect(
      stopSession(
        createCodexRuntime({
          runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4096" },
        }),
        {
          codexAppServer: {
            request() {
              return codexResult("turn/interrupt", {});
            },
          },
        },
      ),
    ).rejects.toThrow("Codex app-server operations require a stdio runtime route.");
  });
});
