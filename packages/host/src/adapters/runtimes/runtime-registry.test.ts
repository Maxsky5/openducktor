import { describe, expect, mock, test } from "bun:test";
import {
  ODT_WORKFLOW_AGENT_TOOL_NAMES,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, toHostOperationError } from "../../effect/host-errors";
import type { CodexAppServerRequestResult } from "../../ports/codex-app-server-port";
import type { RuntimeWorkspaceHandle } from "../../ports/runtime-registry-port";
import {
  type CreateRuntimeRegistryInput,
  createRuntimeRegistry as createEffectRuntimeRegistry,
} from "./runtime-registry";
import {
  type CreateRuntimeSessionOperationsInput,
  createRuntimeSessionOperations,
} from "./runtime-session-operations";

type TestRuntimeRegistryInput = CreateRuntimeRegistryInput & CreateRuntimeSessionOperationsInput;

const createRuntimeRegistry = ({
  codexAppServer,
  claudeAgentSdk,
  sessionOperations,
  ...input
}: TestRuntimeRegistryInput = {}) => {
  const sessionOperationInput: CreateRuntimeSessionOperationsInput = {
    ...(codexAppServer ? { codexAppServer } : {}),
    ...(claudeAgentSdk ? { claudeAgentSdk } : {}),
  };
  return createEffectRuntimeRegistry({
    ...input,
    sessionOperations: sessionOperations ?? createRuntimeSessionOperations(sessionOperationInput),
  });
};
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
const createCodexRuntime = (
  overrides: Partial<RuntimeInstanceSummary> = {},
): RuntimeInstanceSummary =>
  createRuntime({
    kind: "codex",
    runtimeId: "runtime-1",
    runtimeRoute: { type: "stdio", identity: "runtime-1" },
    descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
    ...overrides,
  });
const createClaudeRuntime = (
  overrides: Partial<RuntimeInstanceSummary> = {},
): RuntimeInstanceSummary =>
  createRuntime({
    kind: "claude",
    runtimeId: "runtime-claude",
    runtimeRoute: { type: "host_service", identity: "runtime-claude" },
    descriptor: RUNTIME_DESCRIPTORS_BY_KIND.claude,
    ...overrides,
  });
const createRuntimeHandle = (
  runtime: RuntimeInstanceSummary,
  stop: () => Effect.Effect<void, HostOperationError> = () => Effect.succeed(undefined),
  isAlive = true,
): RuntimeWorkspaceHandle => ({
  runtime,
  isAlive: () => isAlive,
  stop,
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
  test("returns an existing workspace runtime when the repo path formatting differs", async () => {
    const runtime = createRuntime({
      repoPath: "/repo",
      workingDirectory: "/repo",
    });
    const registry = createRuntimeRegistry({ runtimes: [runtime] });
    await expect(
      Effect.runPromise(
        registry.ensureWorkspaceRuntime({
          runtimeKind: "opencode",
          repoPath: "/repo/",
          workingDirectory: "/repo/",
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
        }),
      ),
    ).resolves.toEqual(runtime);
  });
  test("does not reuse a task runtime during workspace runtime ensure", async () => {
    const taskRuntime = createRuntime({
      runtimeId: "task-runtime",
      taskId: "task-1",
      workingDirectory: "/repo/task-1",
    });
    const workspaceRuntime = createRuntime({ runtimeId: "workspace-runtime" });
    const starts: unknown[] = [];
    const registry = createRuntimeRegistry({
      runtimes: [taskRuntime],
      workspaceStarter: {
        startWorkspaceRuntime(input) {
          starts.push(input);
          return Effect.succeed(createRuntimeHandle(workspaceRuntime));
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
    ).resolves.toEqual(workspaceRuntime);
    await expect(Effect.runPromise(registry.listRuntimes())).resolves.toEqual([
      taskRuntime,
      workspaceRuntime,
    ]);
    expect(starts).toEqual([
      {
        runtimeKind: "opencode",
        repoPath: "/repo",
        workingDirectory: "/repo",
        descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
      },
    ]);
  });
  test("finds runtimes by id from initial registrations", async () => {
    const runtime = createRuntime();
    const registry = createRuntimeRegistry({ runtimes: [runtime] });
    await expect(Effect.runPromise(registry.findRuntimeById(runtime.runtimeId))).resolves.toEqual(
      runtime,
    );
    await expect(
      Effect.runPromise(registry.findRuntimeById("missing-runtime")),
    ).resolves.toBeNull();
  });
  test("lists initial runtimes by repository and optional kind", async () => {
    const opencode = createRuntime({
      runtimeId: "opencode-1",
      repoPath: "C:\\Repo",
      workingDirectory: "C:\\Repo",
    });
    const codex = createRuntime({
      kind: "codex",
      runtimeId: "codex-1",
      repoPath: "c:/repo",
      workingDirectory: "c:/repo",
      runtimeRoute: { type: "stdio", identity: "codex-1" },
      descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
    });
    const otherRepo = createRuntime({
      runtimeId: "other-repo",
      repoPath: "/other",
      workingDirectory: "/other",
    });
    const registry = createRuntimeRegistry({
      runtimes: [opencode, codex, otherRepo],
    });
    await expect(
      Effect.runPromise(registry.listRuntimesByRepo({ repoPath: "c:/repo" })),
    ).resolves.toEqual([opencode, codex]);
    await expect(
      Effect.runPromise(
        registry.listRuntimesByRepo({
          repoPath: "c:/repo",
          runtimeKind: "codex",
        }),
      ),
    ).resolves.toEqual([codex]);
  });
  test("starts and registers a workspace runtime through the configured starter", async () => {
    const runtime = createRuntime();
    const starts: unknown[] = [];
    const registry = createRuntimeRegistry({
      workspaceStarter: {
        startWorkspaceRuntime(input) {
          starts.push(input);
          return Effect.succeed(createRuntimeHandle(runtime));
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
    await expect(Effect.runPromise(registry.findRuntimeById(runtime.runtimeId))).resolves.toEqual(
      runtime,
    );
    await expect(
      Effect.runPromise(
        registry.listRuntimesByRepo({
          repoPath: "/repo",
          runtimeKind: "opencode",
        }),
      ),
    ).resolves.toEqual([runtime]);
    expect(starts).toEqual([
      {
        runtimeKind: "opencode",
        repoPath: "/repo",
        workingDirectory: "/repo",
        descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
      },
    ]);
  });
  test("restarts a registered workspace runtime whose handle is no longer alive", async () => {
    const staleRuntime = createRuntime({ runtimeId: "runtime-stale" });
    const freshRuntime = createRuntime({ runtimeId: "runtime-fresh" });
    const stops: string[] = [];
    let starts = 0;
    const registry = createRuntimeRegistry({
      workspaceStarter: {
        startWorkspaceRuntime() {
          starts += 1;
          if (starts === 1) {
            return Effect.succeed(
              createRuntimeHandle(
                staleRuntime,
                () =>
                  Effect.sync(() => {
                    stops.push(staleRuntime.runtimeId);
                  }),
                false,
              ),
            );
          }
          return Effect.succeed(createRuntimeHandle(freshRuntime));
        },
      },
    });
    const input = {
      runtimeKind: "opencode",
      repoPath: "/repo",
      workingDirectory: "/repo",
      descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
    };

    await expect(Effect.runPromise(registry.ensureWorkspaceRuntime(input))).resolves.toEqual(
      staleRuntime,
    );
    await expect(Effect.runPromise(registry.ensureWorkspaceRuntime(input))).resolves.toEqual(
      freshRuntime,
    );
    await expect(Effect.runPromise(registry.listRuntimes())).resolves.toEqual([freshRuntime]);
    expect(starts).toBe(2);
    expect(stops).toEqual(["runtime-stale"]);
  });
  test("does not list a replaced runtime under its previous repo", async () => {
    const originalRuntime = createRuntime({
      runtimeId: "runtime-1",
      repoPath: "/old-repo",
      workingDirectory: "/old-repo",
    });
    const replacementRuntime = createRuntime({
      runtimeId: "runtime-1",
      repoPath: "/new-repo",
      workingDirectory: "/new-repo",
    });
    const registry = createRuntimeRegistry({
      runtimes: [originalRuntime],
      workspaceStarter: {
        startWorkspaceRuntime() {
          return Effect.succeed(createRuntimeHandle(replacementRuntime));
        },
      },
    });
    await expect(
      Effect.runPromise(
        registry.ensureWorkspaceRuntime({
          runtimeKind: "opencode",
          repoPath: "/new-repo",
          workingDirectory: "/new-repo",
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
        }),
      ),
    ).resolves.toEqual(replacementRuntime);
    await expect(
      Effect.runPromise(registry.listRuntimesByRepo({ repoPath: "/old-repo" })),
    ).resolves.toEqual([]);
    await expect(
      Effect.runPromise(registry.listRuntimesByRepo({ repoPath: "/new-repo" })),
    ).resolves.toEqual([replacementRuntime]);
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
              return createRuntimeHandle(await started);
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
    await expect(
      Effect.runPromise(
        registry.listRuntimesByRepo({
          repoPath: "/repo",
          runtimeKind: "opencode",
        }),
      ),
    ).resolves.toEqual([createRuntime()]);
    expect(starts).toBe(1);
  });
  test("deduplicates parallel workspace runtime ensure calls with equivalent repo paths", async () => {
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
              return createRuntimeHandle(await started);
            },
            catch: (cause) =>
              toHostOperationError(cause, "test.workspaceStarter.startWorkspaceRuntime"),
          });
        },
      },
    });
    const first = Effect.runPromise(
      registry.ensureWorkspaceRuntime({
        runtimeKind: "opencode",
        repoPath: "/repo",
        workingDirectory: "/repo",
        descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
      }),
    );
    const second = Effect.runPromise(
      registry.ensureWorkspaceRuntime({
        runtimeKind: "opencode",
        repoPath: "/repo/",
        workingDirectory: "/repo/",
        descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
      }),
    );
    resolveStart(createRuntime());
    await expect(Promise.all([first, second])).resolves.toEqual([createRuntime(), createRuntime()]);
    await expect(
      Effect.runPromise(
        registry.listRuntimesByRepo({
          repoPath: "/repo",
          runtimeKind: "opencode",
        }),
      ),
    ).resolves.toEqual([createRuntime()]);
    expect(starts).toBe(1);
  });
  test("cancels starting runtime handles before stopping all runtimes", async () => {
    const stops: string[] = [];
    let markStarted: () => void = () => {};
    const startEntered = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let resolveStart: (runtime: RuntimeInstanceSummary) => void = () => {};
    const started = new Promise<RuntimeInstanceSummary>((resolve) => {
      resolveStart = resolve;
    });
    const registry = createRuntimeRegistry({
      workspaceStarter: {
        startWorkspaceRuntime() {
          return Effect.tryPromise({
            try: async () => {
              markStarted();
              const runtime = await started;
              return createRuntimeHandle(runtime, () =>
                Effect.sync(() => {
                  stops.push(runtime.runtimeId);
                }),
              );
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
    const ensure = Effect.runPromise(registry.ensureWorkspaceRuntime(input)).then(
      (runtime) => ({ type: "started" as const, runtime }),
      (error: unknown) => ({ type: "cancelled" as const, error }),
    );
    await startEntered;
    const stopAllRuntimes = requireMethod(registry.stopAllRuntimes, "stopAllRuntimes");
    const stopAll = Effect.runPromise(stopAllRuntimes());
    const stopResult = await Promise.race([
      stopAll.then((stopped) => ({ type: "stopped" as const, stopped })),
      new Promise<{ type: "pending" }>((resolve) =>
        setTimeout(() => resolve({ type: "pending" }), 100),
      ),
    ]);
    const runtime = createRuntime();
    resolveStart(runtime);
    await Promise.allSettled([ensure, stopAll]);

    expect(stopResult).toEqual({ type: "stopped", stopped: [] });
    expect((await ensure).type).toBe("cancelled");
    await expect(Effect.runPromise(registry.listRuntimes())).resolves.toEqual([]);
    await expect(
      Effect.runPromise(registry.findRuntimeById(runtime.runtimeId)),
    ).resolves.toBeNull();
    await expect(
      Effect.runPromise(
        registry.listRuntimesByRepo({
          repoPath: "/repo",
          runtimeKind: "opencode",
        }),
      ),
    ).resolves.toEqual([]);
    expect(stops).toEqual([]);
  });
  test("stops host-started runtime handles before removing them", async () => {
    const stops: string[] = [];
    const runtime = createRuntime();
    const registry = createRuntimeRegistry({
      workspaceStarter: {
        startWorkspaceRuntime() {
          return Effect.succeed(
            createRuntimeHandle(runtime, () =>
              Effect.try({
                try: () => {
                  stops.push(runtime.runtimeId);
                },
                catch: (cause) => toHostOperationError(cause, "test.workspaceRuntime.stop"),
              }),
            ),
          );
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
    await expect(
      Effect.runPromise(registry.findRuntimeById(runtime.runtimeId)),
    ).resolves.toBeNull();
    await expect(
      Effect.runPromise(
        registry.listRuntimesByRepo({
          repoPath: "/repo",
          runtimeKind: "opencode",
        }),
      ),
    ).resolves.toEqual([]);
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
      const endpoint = "http://127.0.0.1:4096";
      const registry = createRuntimeRegistry({
        runtimes: [
          createRuntime({
            runtimeRoute: { type: "local_http", endpoint },
          }),
        ],
      });
      const probeSessionStatus = requireMethod(registry.probeSessionStatus, "probeSessionStatus");
      await expect(
        Effect.runPromise(
          registry.stopSession({
            runtimeKind: "opencode",
            repoPath: "/repo",
            externalSessionId: "session-1",
            workingDirectory: "/repo/worktree",
          }),
        ),
      ).resolves.toBeUndefined();
      await expect(
        Effect.runPromise(
          probeSessionStatus({
            runtimeKind: "opencode",
            repoPath: "/repo",
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
  test("treats session status probes without a live workspace runtime as inactive", async () => {
    const calls: unknown[] = [];
    const registry = createRuntimeRegistry({
      codexAppServer: {
        request(input) {
          calls.push(input);
          return codexResult({});
        },
      },
    });
    await expect(
      Effect.runPromise(
        registry.probeSessionStatus({
          runtimeKind: "codex",
          repoPath: "/repo",
          externalSessionId: "session-1",
          workingDirectory: "/repo/worktree",
        }),
      ),
    ).resolves.toEqual({ supported: true, hasLiveSession: false });
    expect(calls).toEqual([]);
  });
  test("requires a live workspace runtime to stop a session", async () => {
    const registry = createRuntimeRegistry();
    await expect(
      Effect.runPromise(
        registry.stopSession({
          runtimeKind: "opencode",
          repoPath: "/repo",
          externalSessionId: "session-1",
          workingDirectory: "/repo/worktree",
        }),
      ),
    ).rejects.toThrow("No live opencode workspace runtime found for repo '/repo'.");
  });
  test("rejects ambiguous same-kind workspace runtimes before session operations", async () => {
    const registry = createRuntimeRegistry({
      runtimes: [
        createRuntime({ runtimeId: "runtime-1" }),
        createRuntime({ runtimeId: "runtime-2" }),
      ],
    });
    await expect(
      Effect.runPromise(
        registry.probeSessionStatus({
          runtimeKind: "opencode",
          repoPath: "/repo",
          externalSessionId: "session-1",
          workingDirectory: "/repo/worktree",
        }),
      ),
    ).rejects.toThrow("Multiple live opencode workspace runtimes found for repo '/repo'.");
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
  test("reports OpenCode MCP fetch timeouts as reconnecting probe results", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as unknown as typeof fetch;
    try {
      const registry = createRuntimeRegistry();
      const probeMcpStatus = requireMethod(registry.probeMcpStatus, "probeMcpStatus");

      await expect(
        Effect.runPromise(
          probeMcpStatus({
            runtimeKind: "opencode",
            runtimeRoute: {
              type: "local_http",
              endpoint: "http://127.0.0.1:4096",
            },
            workingDirectory: "/repo/worktree",
            serverName: "openducktor",
          }),
        ),
      ).resolves.toEqual({
        supported: true,
        connected: false,
        serverStatus: null,
        toolIds: [],
        detail: "The operation was aborted due to timeout",
        failureKind: "timeout",
      });
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
      runtimes: [createCodexRuntime()],
      codexAppServer: {
        request(input) {
          calls.push(input);
          const params = input.params as {
            threadId: "session-1" | "session-2" | "session-3" | "session-4" | "session-5";
          };
          const statusByThreadId = {
            "session-1": { type: "active", activeFlags: [] },
            "session-2": { type: "idle" },
            "session-3": { type: "systemError" },
            "session-4": { type: "notLoaded" },
            "session-5": { type: "active", activeFlags: [] },
          } as const;
          return codexResult({
            thread: {
              id: params.threadId,
              cwd: params.threadId === "session-5" ? "/repo/other-worktree" : "/repo/worktree",
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
          repoPath: "/repo",
          externalSessionId: "session-1",
          workingDirectory: "/repo/worktree",
        }),
      ),
    ).resolves.toEqual({ supported: true, hasLiveSession: true });
    await expect(
      Effect.runPromise(
        probeSessionStatus({
          runtimeKind: "codex",
          repoPath: "/repo",
          externalSessionId: "session-2",
          workingDirectory: "/repo/worktree",
        }),
      ),
    ).resolves.toEqual({ supported: true, hasLiveSession: false });
    await expect(
      Effect.runPromise(
        probeSessionStatus({
          runtimeKind: "codex",
          repoPath: "/repo",
          externalSessionId: "session-3",
          workingDirectory: "/repo/worktree",
        }),
      ),
    ).resolves.toEqual({ supported: true, hasLiveSession: true });
    await expect(
      Effect.runPromise(
        probeSessionStatus({
          runtimeKind: "codex",
          repoPath: "/repo",
          externalSessionId: "session-4",
          workingDirectory: "/repo/worktree",
        }),
      ),
    ).resolves.toEqual({ supported: true, hasLiveSession: false });
    await expect(
      Effect.runPromise(
        probeSessionStatus({
          runtimeKind: "codex",
          repoPath: "/repo",
          externalSessionId: "session-5",
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
      {
        runtimeId: "runtime-1",
        method: "thread/read",
        params: { threadId: "session-4", includeTurns: false },
      },
      {
        runtimeId: "runtime-1",
        method: "thread/read",
        params: { threadId: "session-5", includeTurns: false },
      },
    ]);
  });
  test("treats missing Codex session probe threads as inactive", async () => {
    const registry = createRuntimeRegistry({
      runtimes: [createCodexRuntime()],
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
    });
    const probeSessionStatus = requireMethod(registry.probeSessionStatus, "probeSessionStatus");
    await expect(
      Effect.runPromise(
        probeSessionStatus({
          runtimeKind: "codex",
          repoPath: "/repo",
          externalSessionId: "missing-session",
          workingDirectory: "/repo/worktree",
        }),
      ),
    ).resolves.toEqual({ supported: true, hasLiveSession: false });
  });
  test("fails malformed Codex session probe thread payloads with a typed error", async () => {
    const registry = createRuntimeRegistry({
      runtimes: [createCodexRuntime()],
      codexAppServer: {
        request() {
          return codexResult({});
        },
      },
    });
    const probeSessionStatus = requireMethod(registry.probeSessionStatus, "probeSessionStatus");
    await expect(
      Effect.runPromise(
        probeSessionStatus({
          runtimeKind: "codex",
          repoPath: "/repo",
          externalSessionId: "session-1",
          workingDirectory: "/repo/worktree",
        }),
      ),
    ).rejects.toThrow("Codex thread/read response thread must be an object");
  });
  test("interrupts an active Codex session through the app-server port", async () => {
    const calls: unknown[] = [];
    const registry = createRuntimeRegistry({
      runtimes: [createCodexRuntime()],
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
          repoPath: "/repo",
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
      runtimes: [createCodexRuntime()],
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
          repoPath: "/repo",
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
      runtimes: [createCodexRuntime()],
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
          repoPath: "/repo",
          externalSessionId: "session-1",
          workingDirectory: "/repo/worktree",
        }),
      ),
    ).rejects.toThrow("Codex session is active but no interruptible active turn was found.");
  });
  test("fails malformed Codex turn-list payloads with a typed error", async () => {
    const registry = createRuntimeRegistry({
      runtimes: [createCodexRuntime()],
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
          return codexResult({});
        },
      },
    });
    await expect(
      Effect.runPromise(
        registry.stopSession({
          runtimeKind: "codex",
          repoPath: "/repo",
          externalSessionId: "session-1",
          workingDirectory: "/repo/worktree",
        }),
      ),
    ).rejects.toThrow("Codex thread/turns/list response data must be an array");
  });
  test("fails Codex stop without the app-server port or a Codex runtime route", async () => {
    const registry = createRuntimeRegistry({
      runtimes: [createCodexRuntime()],
    });
    await expect(
      Effect.runPromise(
        registry.stopSession({
          runtimeKind: "codex",
          repoPath: "/repo",
          externalSessionId: "session-1",
          workingDirectory: "/repo/worktree",
        }),
      ),
    ).rejects.toThrow("Codex session stop requires the Codex app-server port.");
    const codexRegistry = createRuntimeRegistry({
      runtimes: [
        createCodexRuntime({
          runtimeRoute: {
            type: "local_http",
            endpoint: "http://127.0.0.1:4096",
          },
        }),
      ],
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
          repoPath: "/repo",
          externalSessionId: "session-1",
          workingDirectory: "/repo/worktree",
        }),
      ),
    ).rejects.toThrow("Codex app-server operations require a stdio runtime route.");
  });
  test("routes Claude session stop and status probes through the Claude Agent SDK service", async () => {
    const stops: unknown[] = [];
    const probes: unknown[] = [];
    const registry = createRuntimeRegistry({
      runtimes: [createClaudeRuntime()],
      claudeAgentSdk: {
        stopSession(input) {
          stops.push(input);
          return Effect.void;
        },
        probeSessionStatus(input) {
          probes.push(input);
          return Effect.succeed({ supported: true, hasLiveSession: true });
        },
      },
    });
    const sessionRef = {
      runtimeKind: "claude",
      repoPath: "/repo",
      externalSessionId: "session-1",
      workingDirectory: "/repo/worktree",
    } as const;
    const probeSessionStatus = requireMethod(registry.probeSessionStatus, "probeSessionStatus");

    await expect(Effect.runPromise(registry.stopSession(sessionRef))).resolves.toBeUndefined();
    await expect(Effect.runPromise(probeSessionStatus(sessionRef))).resolves.toEqual({
      supported: true,
      hasLiveSession: true,
    });
    expect(stops).toEqual([sessionRef]);
    expect(probes).toEqual([sessionRef]);
  });
  test("fails Claude session operations without the Claude Agent SDK service", async () => {
    const registry = createRuntimeRegistry({
      runtimes: [createClaudeRuntime()],
    });
    const sessionRef = {
      runtimeKind: "claude",
      repoPath: "/repo",
      externalSessionId: "session-1",
      workingDirectory: "/repo/worktree",
    } as const;
    const probeSessionStatus = requireMethod(registry.probeSessionStatus, "probeSessionStatus");

    await expect(Effect.runPromise(probeSessionStatus(sessionRef))).rejects.toThrow(
      "Claude session status probing requires the Claude Agent SDK service.",
    );
    await expect(Effect.runPromise(registry.stopSession(sessionRef))).rejects.toThrow(
      "Claude session stop requires the Claude Agent SDK service.",
    );
  });
});
