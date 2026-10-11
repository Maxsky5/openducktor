import { describe, expect, test } from "bun:test";
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
import { HostOperationError, HostResourceError } from "../../effect/host-errors";
import { createClaudeAgentSdkSessionStore } from "../claude/claude-agent-sdk-session-store";
import {
  type CreateRuntimeSessionOperationsInput,
  createRuntimeSessionOperations,
} from "./runtime-session-operations";

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
      model: null,
      reasoningEffort: null,
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

const unusedPort = (): never => {
  throw new Error("This test does not use this port.");
};

const createOperations = (operationsInput: Partial<CreateRuntimeSessionOperationsInput>) =>
  createRuntimeSessionOperations({
    opencode: { stopSession: unusedPort, probeSessionStatus: unusedPort },
    codexAppServer: { request: unusedPort },
    claudeAgentSdk: { stopSession: unusedPort, probeSessionStatus: unusedPort },
    ...operationsInput,
  });

const stopSession = (
  runtime: RuntimeInstanceSummary,
  operationsInput: Partial<CreateRuntimeSessionOperationsInput> = {},
  externalSessionId = "session-1",
) =>
  Effect.runPromise(
    createOperations(operationsInput)[runtime.kind].stopSession(
      sessionTarget(runtime.kind, externalSessionId),
      runtime,
    ),
  );

const probeSession = (
  runtime: RuntimeInstanceSummary,
  runtimeKind: RuntimeKind,
  operationsInput: Partial<CreateRuntimeSessionOperationsInput> = {},
  externalSessionId = "session-1",
) =>
  Effect.runPromise(
    createOperations(operationsInput)[runtimeKind].probeSessionStatus(
      sessionTarget(runtimeKind, externalSessionId),
      runtime,
    ),
  );

const claudeRuntime: RuntimeInstanceSummary = {
  kind: "claude",
  runtimeId: "runtime-claude",
  runtimeRoute: { type: "host_service", identity: "runtime-claude" },
  startedAt: "2026-07-17T10:00:00.000Z",
  descriptor: RUNTIME_DESCRIPTORS_BY_KIND.claude,
};

describe("Claude runtime session operations", () => {
  test("reports an unknown Claude session as a resource failure", async () => {
    const error = await Effect.runPromise(
      createOperations({ claudeAgentSdk: createClaudeAgentSdkSessionStore() })
        .claude.stopSession(sessionTarget("claude", "missing"), claudeRuntime)
        .pipe(Effect.flip),
    );

    expect(error).toBeInstanceOf(HostResourceError);
    expect(error).toMatchObject({
      resource: "claudeAgentSdk",
      operation: "runtimeRegistry.stopClaudeSession",
      message: "Unknown Claude session 'missing'.",
    });
  });

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
});

describe("OpenCode runtime session operations", () => {
  test("routes stop and status to the owned OpenCode connection", async () => {
    const stops: unknown[] = [];
    const probes: unknown[] = [];
    const opencode: CreateRuntimeSessionOperationsInput["opencode"] = {
      stopSession: (target, runtime) =>
        Effect.sync(() => {
          stops.push({ target, runtime });
        }),
      probeSessionStatus: (target, runtime) =>
        Effect.sync(() => {
          probes.push({ target, runtime });
          return { supported: true, hasLiveSession: true };
        }),
    };
    await stopSession(openCodeRuntime, { opencode });
    expect(await probeSession(openCodeRuntime, "opencode", { opencode })).toEqual({
      supported: true,
      hasLiveSession: true,
    });
    expect(stops).toEqual([{ target: sessionTarget("opencode"), runtime: openCodeRuntime }]);
    expect(probes).toEqual(stops);
  });
});

describe("Codex runtime session operations", () => {
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

  test("fails Codex stop without a Codex runtime route", async () => {
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
