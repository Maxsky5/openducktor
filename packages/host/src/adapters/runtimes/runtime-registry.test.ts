import { describe, expect, mock, test } from "bun:test";
import {
  ODT_WORKFLOW_AGENT_TOOL_NAMES,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { toHostOperationError } from "../../effect/host-errors";
import type { CodexAppServerRequestResult } from "../../ports/codex-app-server-port";
import { createRuntimeRegistry as createEffectRuntimeRegistry } from "./runtime-registry";

const createRuntimeRegistry = (...args: Parameters<typeof createEffectRuntimeRegistry>) =>
  createEffectRuntimeRegistry(...args);
const codexResult = (value: unknown) => Effect.succeed(value as CodexAppServerRequestResult);
const requireMethod = <T>(method: T | undefined, methodName: string): T => {
  if (!method) {
    throw new Error(`Expected registry to support ${methodName}`);
  }
  return method;
};
const createRuntime = (
  overrides: Partial<RuntimeInstanceSummary> = {},
): RuntimeInstanceSummary => ({
  kind: "opencode",
  runtimeId: "runtime-1",
  repoPath: "/repo",
  taskId: null,
  role: "workspace",
  workingDirectory: "/repo",
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:4096",
  },
  startedAt: "2026-05-10T10:00:00.000Z",
  descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
  ...overrides,
});
describe("createRuntimeRegistry", () => {
  test("returns an existing workspace runtime during ensure", async () => {
    const runtime = createRuntime();
    const registry = createRuntimeRegistry({ runtimes: [runtime] });
    await expect(
      Effect.runPromise(
        registry.ensureWorkspaceRuntime({
          runtimeKind: "opencode",
          repoPath: "/repo",
          workingDirectory: "/repo",
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
        }),
      ),
    ).resolves.toEqual(runtime);
  });
  test("starts and registers a workspace runtime through the configured starter", async () => {
    const runtime = createRuntime();
    const starts: unknown[] = [];
    const registry = createRuntimeRegistry({
      workspaceStarter: {
        startWorkspaceRuntime(input) {
          starts.push(input);
          return Effect.succeed({
            runtime,
            stop: () => Effect.succeed(undefined),
          });
        },
      },
    });
    await expect(
      Effect.runPromise(
        registry.ensureWorkspaceRuntime({
          runtimeKind: "opencode",
          repoPath: "/repo",
          workingDirectory: "/repo",
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
        }),
      ),
    ).resolves.toEqual(runtime);
    await expect(Effect.runPromise(registry.listRuntimes())).resolves.toEqual([runtime]);
    expect(starts).toEqual([
      {
        runtimeKind: "opencode",
        repoPath: "/repo",
        workingDirectory: "/repo",
        descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
      },
    ]);
  });
  test("deduplicates parallel workspace runtime ensure calls", async () => {
    let starts = 0;
    let resolveStart: (runtime: RuntimeInstanceSummary) => void = () => {};
    const started = new Promise<RuntimeInstanceSummary>((resolve) => {
      resolveStart = resolve;
    });
    const registry = createRuntimeRegistry({
      workspaceStarter: {
        startWorkspaceRuntime() {
          return Effect.tryPromise({
            try: async () => {
              starts += 1;
              return {
                runtime: await started,
                stop: () => Effect.succeed(undefined),
              };
            },
            catch: (cause) =>
              toHostOperationError(cause, "test.workspaceStarter.startWorkspaceRuntime"),
          });
        },
      },
    });
    const input = {
      runtimeKind: "opencode",
      repoPath: "/repo",
      workingDirectory: "/repo",
      descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
    };
    const first = Effect.runPromise(registry.ensureWorkspaceRuntime(input));
    const second = Effect.runPromise(registry.ensureWorkspaceRuntime(input));
    resolveStart(createRuntime());
    await expect(Promise.all([first, second])).resolves.toEqual([createRuntime(), createRuntime()]);
    expect(starts).toBe(1);
  });
  test("waits for starting runtime handles before stopping all runtimes", async () => {
    const stops: string[] = [];
    let resolveStart: (runtime: RuntimeInstanceSummary) => void = () => {};
    const started = new Promise<RuntimeInstanceSummary>((resolve) => {
      resolveStart = resolve;
    });
    const registry = createRuntimeRegistry({
      workspaceStarter: {
        startWorkspaceRuntime() {
          return Effect.tryPromise({
            try: async () => {
              const runtime = await started;
              return {
                runtime,
                stop: () =>
                  Effect.sync(() => {
                    stops.push(runtime.runtimeId);
                  }),
              };
            },
            catch: (cause) =>
              toHostOperationError(cause, "test.workspaceStarter.startWorkspaceRuntime"),
          });
        },
      },
    });
    const input = {
      runtimeKind: "opencode",
      repoPath: "/repo",
      workingDirectory: "/repo",
      descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
    };
    const ensure = Effect.runPromise(registry.ensureWorkspaceRuntime(input));
    const stopAllRuntimes = requireMethod(registry.stopAllRuntimes, "stopAllRuntimes");
    const stopAll = Effect.runPromise(stopAllRuntimes());
    const runtime = createRuntime();
    resolveStart(runtime);
    await expect(stopAll).resolves.toEqual([runtime]);
    await expect(ensure).resolves.toEqual(runtime);
    await expect(Effect.runPromise(registry.listRuntimes())).resolves.toEqual([]);
    expect(stops).toEqual(["runtime-1"]);
  });
  test("stops host-started runtime handles before removing them", async () => {
    const stops: string[] = [];
    const runtime = createRuntime();
    const registry = createRuntimeRegistry({
      workspaceStarter: {
        startWorkspaceRuntime() {
          return Effect.succeed({
            runtime,
            stop: () =>
              Effect.try({
                try: () => {
                  stops.push(runtime.runtimeId);
                },
                catch: (cause) => toHostOperationError(cause, "test.workspaceRuntime.stop"),
              }),
          });
        },
      },
    });
    await Effect.runPromise(
      registry.ensureWorkspaceRuntime({
        runtimeKind: "opencode",
        repoPath: "/repo",
        workingDirectory: "/repo",
        descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
      }),
    );
    await expect(Effect.runPromise(registry.stopRuntime(runtime.runtimeId))).resolves.toBe(true);
    await expect(Effect.runPromise(registry.listRuntimes())).resolves.toEqual([]);
    expect(stops).toEqual(["runtime-1"]);
  });
  test("fails fast when workspace runtime startup is not configured", async () => {
    const registry = createRuntimeRegistry();
    await expect(
      Effect.runPromise(
        registry.ensureWorkspaceRuntime({
          runtimeKind: "opencode",
          repoPath: "/repo",
          workingDirectory: "/repo",
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
        }),
      ),
    ).rejects.toThrow(
      "Runtime kind opencode workspace startup is not configured in the TypeScript host.",
    );
  });
  test("aborts and probes OpenCode sessions through the local runtime endpoint", async () => {
    const requests: Array<{
      method: string;
      pathname: string;
      directory: string | null;
    }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
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
    }) as unknown as typeof fetch;
    try {
      const registry = createRuntimeRegistry();
      const probeSessionStatus = requireMethod(registry.probeSessionStatus, "probeSessionStatus");
      const endpoint = "http://127.0.0.1:4096";
      await expect(
        Effect.runPromise(
          registry.stopSession({
            runtimeKind: "opencode",
            runtimeRoute: { type: "local_http", endpoint },
            externalSessionId: "session-1",
            workingDirectory: "/repo/worktree",
          }),
        ),
      ).resolves.toBeUndefined();
      await expect(
        Effect.runPromise(
          probeSessionStatus({
            runtimeKind: "opencode",
            runtimeRoute: { type: "local_http", endpoint },
            externalSessionId: "session-1",
            workingDirectory: "/repo/worktree",
          }),
        ),
      ).resolves.toEqual({ supported: true, hasLiveSession: true });
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
  test("probes OpenCode MCP status and tool ids through the local runtime endpoint", async () => {
    const requests: Array<{
      method: string;
      pathname: string;
      directory: string | null;
    }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(request?.url ?? input.toString());
      const method = init?.method ?? request?.method ?? "GET";
      requests.push({
        method,
        pathname: url.pathname,
        directory: url.searchParams.get("directory"),
      });
      if (method === "GET" && url.pathname === "/mcp") {
        return Response.json({ openducktor: { status: "connected" } });
      }
      if (method === "GET" && url.pathname === "/experimental/tool/ids") {
        return Response.json(["odt_read_task", " odt_set_spec ", ""]);
      }
      return Response.json({ error: "not found" }, { status: 404 });
    }) as unknown as typeof fetch;
    try {
      const registry = createRuntimeRegistry();
      const probeMcpStatus = requireMethod(registry.probeMcpStatus, "probeMcpStatus");
      const endpoint = "http://127.0.0.1:4096";
      await expect(
        Effect.runPromise(
          probeMcpStatus({
            runtimeKind: "opencode",
            runtimeRoute: { type: "local_http", endpoint },
            workingDirectory: "/repo/worktree",
            serverName: "openducktor",
          }),
        ),
      ).resolves.toEqual({
        supported: true,
        connected: true,
        serverStatus: "connected",
        toolIds: ["odt_read_task", "odt_set_spec"],
        detail: null,
        failureKind: null,
      });
      expect(requests).toEqual([
        {
          method: "GET",
          pathname: "/mcp",
          directory: "/repo/worktree",
        },
        {
          method: "GET",
          pathname: "/experimental/tool/ids",
          directory: "/repo/worktree",
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  test("reports Codex MCP status for host-managed stdio runtimes", async () => {
    const registry = createRuntimeRegistry();
    const probeMcpStatus = requireMethod(registry.probeMcpStatus, "probeMcpStatus");
    await expect(
      Effect.runPromise(
        probeMcpStatus({
          runtimeKind: "codex",
          runtimeRoute: { type: "stdio", identity: "runtime-1" },
          workingDirectory: "/repo",
          serverName: "openducktor",
        }),
      ),
    ).resolves.toEqual({
      supported: true,
      connected: true,
      serverStatus: "connected",
      toolIds: [...ODT_WORKFLOW_AGENT_TOOL_NAMES],
      detail: null,
      failureKind: null,
    });
  });
  test("probes Codex session status through the host-managed app-server transport", async () => {
    const calls: unknown[] = [];
    const registry = createRuntimeRegistry({
      codexAppServer: {
        request(input) {
          calls.push(input);
          const params = input.params as { threadId: "session-1" | "session-2" | "session-3" };
          const statusByThreadId = {
            "session-1": { type: "active", activeFlags: [] },
            "session-2": { type: "idle" },
            "session-3": { type: "systemError" },
          } as const;
          return codexResult({
            thread: {
              id: params.threadId,
              cwd: "/repo/worktree",
              status: statusByThreadId[params.threadId],
            },
          });
        },
      },
    });
    const probeSessionStatus = requireMethod(registry.probeSessionStatus, "probeSessionStatus");
    await expect(
      Effect.runPromise(
        probeSessionStatus({
          runtimeKind: "codex",
          runtimeRoute: { type: "stdio", identity: "runtime-1" },
          externalSessionId: "session-1",
          workingDirectory: "/repo/worktree",
        }),
      ),
    ).resolves.toEqual({ supported: true, hasLiveSession: true });
    await expect(
      Effect.runPromise(
        probeSessionStatus({
          runtimeKind: "codex",
          runtimeRoute: { type: "stdio", identity: "runtime-1" },
          externalSessionId: "session-2",
          workingDirectory: "/repo/worktree",
        }),
      ),
    ).resolves.toEqual({ supported: true, hasLiveSession: false });
    await expect(
      Effect.runPromise(
        probeSessionStatus({
          runtimeKind: "codex",
          runtimeRoute: { type: "stdio", identity: "runtime-1" },
          externalSessionId: "session-3",
          workingDirectory: "/repo/worktree",
        }),
      ),
    ).resolves.toEqual({ supported: true, hasLiveSession: false });
    expect(calls).toEqual([
      {
        runtimeId: "runtime-1",
        method: "thread/read",
        params: { threadId: "session-1", includeTurns: false },
      },
      {
        runtimeId: "runtime-1",
        method: "thread/read",
        params: { threadId: "session-2", includeTurns: false },
      },
      {
        runtimeId: "runtime-1",
        method: "thread/read",
        params: { threadId: "session-3", includeTurns: false },
      },
    ]);
  });
  test("interrupts an active Codex session through the app-server port", async () => {
    const calls: unknown[] = [];
    const registry = createRuntimeRegistry({
      codexAppServer: {
        request(input) {
          calls.push(input);
          if (input.method === "thread/read") {
            return codexResult({
              thread: {
                id: "session-1",
                cwd: "/repo/worktree",
                status: { type: "active", activeFlags: [] },
              },
            });
          }
          if (input.method === "thread/turns/list") {
            return codexResult({
              data: [
                {
                  id: "turn-1",
                  startedAt: 1_778_112_001,
                  completedAt: null,
                  durationMs: null,
                  error: null,
                  items: [],
                  itemsView: "summary",
                  status: "running",
                },
              ],
              nextCursor: null,
              backwardsCursor: null,
            });
          }
          return codexResult({});
        },
      },
    });
    await expect(
      Effect.runPromise(
        registry.stopSession({
          runtimeKind: "codex",
          runtimeRoute: { type: "stdio", identity: "runtime-1" },
          externalSessionId: "session-1",
          workingDirectory: "/repo/worktree",
        }),
      ),
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
  test("treats exact idle Codex sessions as already stopped", async () => {
    const calls: unknown[] = [];
    const registry = createRuntimeRegistry({
      codexAppServer: {
        request(input) {
          calls.push(input);
          return codexResult({
            thread: {
              id: "session-1",
              cwd: "/repo/worktree",
              status: { type: "idle" },
            },
          });
        },
      },
    });
    await expect(
      Effect.runPromise(
        registry.stopSession({
          runtimeKind: "codex",
          runtimeRoute: { type: "stdio", identity: "runtime-1" },
          externalSessionId: "session-1",
          workingDirectory: "/repo/worktree",
        }),
      ),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([
      {
        runtimeId: "runtime-1",
        method: "thread/read",
        params: { threadId: "session-1", includeTurns: false },
      },
    ]);
  });
  test("fails active Codex stop when no active turn can be found", async () => {
    const registry = createRuntimeRegistry({
      codexAppServer: {
        request(input) {
          if (input.method === "thread/read") {
            return codexResult({
              thread: {
                id: "session-1",
                cwd: "/repo/worktree",
                status: { type: "active", activeFlags: [] },
              },
            });
          }
          return codexResult({
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
    });
    await expect(
      Effect.runPromise(
        registry.stopSession({
          runtimeKind: "codex",
          runtimeRoute: { type: "stdio", identity: "runtime-1" },
          externalSessionId: "session-1",
          workingDirectory: "/repo/worktree",
        }),
      ),
    ).rejects.toThrow("Codex session is active but no interruptible active turn was found.");
  });
  test("fails Codex stop without the app-server port or a Codex runtime route", async () => {
    const registry = createRuntimeRegistry();
    await expect(
      Effect.runPromise(
        registry.stopSession({
          runtimeKind: "codex",
          runtimeRoute: { type: "stdio", identity: "runtime-1" },
          externalSessionId: "session-1",
          workingDirectory: "/repo/worktree",
        }),
      ),
    ).rejects.toThrow("Codex session stop requires the Codex app-server port.");
    const codexRegistry = createRuntimeRegistry({
      codexAppServer: {
        request() {
          return codexResult({});
        },
      },
    });
    await expect(
      Effect.runPromise(
        codexRegistry.stopSession({
          runtimeKind: "codex",
          runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4096" },
          externalSessionId: "session-1",
          workingDirectory: "/repo/worktree",
        }),
      ),
    ).rejects.toThrow("Codex app-server operations require a stdio runtime route.");
  });
});
