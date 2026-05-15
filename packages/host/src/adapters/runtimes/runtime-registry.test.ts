import { describe, expect, mock, test } from "bun:test";
import {
  ODT_WORKFLOW_AGENT_TOOL_NAMES,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { createRuntimeRegistry } from "./runtime-registry";

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
      registry.ensureWorkspaceRuntime({
        runtimeKind: "opencode",
        repoPath: "/repo",
        workingDirectory: "/repo",
        descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
      }),
    ).resolves.toEqual(runtime);
  });

  test("starts and registers a workspace runtime through the configured starter", async () => {
    const runtime = createRuntime();
    const starts: unknown[] = [];
    const registry = createRuntimeRegistry({
      workspaceStarter: {
        async startWorkspaceRuntime(input) {
          starts.push(input);
          return {
            runtime,
            async stop() {},
          };
        },
      },
    });

    await expect(
      registry.ensureWorkspaceRuntime({
        runtimeKind: "opencode",
        repoPath: "/repo",
        workingDirectory: "/repo",
        descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
      }),
    ).resolves.toEqual(runtime);
    await expect(registry.listRuntimes()).resolves.toEqual([runtime]);
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
        async startWorkspaceRuntime() {
          starts += 1;
          return {
            runtime: await started,
            async stop() {},
          };
        },
      },
    });
    const input = {
      runtimeKind: "opencode",
      repoPath: "/repo",
      workingDirectory: "/repo",
      descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
    };
    const first = registry.ensureWorkspaceRuntime(input);
    const second = registry.ensureWorkspaceRuntime(input);

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
        async startWorkspaceRuntime() {
          const runtime = await started;
          return {
            runtime,
            async stop() {
              stops.push(runtime.runtimeId);
            },
          };
        },
      },
    });
    const input = {
      runtimeKind: "opencode",
      repoPath: "/repo",
      workingDirectory: "/repo",
      descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
    };

    const ensure = registry.ensureWorkspaceRuntime(input);
    const stopAll = registry.stopAllRuntimes?.();
    if (!stopAll) {
      throw new Error("Expected registry to support stopAllRuntimes");
    }
    const runtime = createRuntime();
    resolveStart(runtime);

    await expect(stopAll).resolves.toEqual([runtime]);
    await expect(ensure).resolves.toEqual(runtime);
    await expect(registry.listRuntimes()).resolves.toEqual([]);
    expect(stops).toEqual(["runtime-1"]);
  });

  test("stops host-started runtime handles before removing them", async () => {
    const stops: string[] = [];
    const runtime = createRuntime();
    const registry = createRuntimeRegistry({
      workspaceStarter: {
        async startWorkspaceRuntime() {
          return {
            runtime,
            async stop() {
              stops.push(runtime.runtimeId);
            },
          };
        },
      },
    });

    await registry.ensureWorkspaceRuntime({
      runtimeKind: "opencode",
      repoPath: "/repo",
      workingDirectory: "/repo",
      descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
    });

    await expect(registry.stopRuntime(runtime.runtimeId)).resolves.toBe(true);
    await expect(registry.listRuntimes()).resolves.toEqual([]);
    expect(stops).toEqual(["runtime-1"]);
  });

  test("fails fast when workspace runtime startup is not configured", async () => {
    const registry = createRuntimeRegistry();

    await expect(
      registry.ensureWorkspaceRuntime({
        runtimeKind: "opencode",
        repoPath: "/repo",
        workingDirectory: "/repo",
        descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
      }),
    ).rejects.toThrow(
      "Runtime kind opencode workspace startup is not configured in the TypeScript host.",
    );
  });

  test("aborts and probes OpenCode sessions through the local runtime endpoint", async () => {
    const requests: Array<{ method: string; pathname: string; directory: string | null }> = [];
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
      const endpoint = "http://127.0.0.1:4096";

      await expect(
        registry.stopSession({
          runtimeKind: "opencode",
          runtimeRoute: { type: "local_http", endpoint },
          externalSessionId: "session-1",
          workingDirectory: "/repo/worktree",
        }),
      ).resolves.toBeUndefined();

      await expect(
        registry.probeSessionStatus?.({
          runtimeKind: "opencode",
          runtimeRoute: { type: "local_http", endpoint },
          externalSessionId: "session-1",
          workingDirectory: "/repo/worktree",
        }),
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
    const requests: Array<{ method: string; pathname: string; directory: string | null }> = [];
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
      const endpoint = "http://127.0.0.1:4096";

      await expect(
        registry.probeMcpStatus?.({
          runtimeKind: "opencode",
          runtimeRoute: { type: "local_http", endpoint },
          workingDirectory: "/repo/worktree",
          serverName: "openducktor",
        }),
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

    await expect(
      registry.probeMcpStatus?.({
        runtimeKind: "codex",
        runtimeRoute: { type: "stdio", identity: "runtime-1" },
        workingDirectory: "/repo",
        serverName: "openducktor",
      }),
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
        async request(input) {
          calls.push(input);
          if (input.method === "thread/loaded/list") {
            return {
              data: ["session-1", "session-2", "session-3"],
              nextCursor: null,
            };
          }
          if (input.method === "thread/list") {
            return {
              data: [
                {
                  id: "session-1",
                  cwd: "/repo/worktree",
                  status: { type: "active", activeFlags: [] },
                },
                { id: "session-2", cwd: "/repo/worktree", status: { type: "idle" } },
                { id: "session-3", cwd: "/repo/worktree", status: { type: "systemError" } },
              ],
              nextCursor: null,
              backwardsCursor: null,
            };
          }
          throw new Error(`unexpected method ${input.method}`);
        },
      },
    });

    await expect(
      registry.probeSessionStatus?.({
        runtimeKind: "codex",
        runtimeRoute: { type: "stdio", identity: "runtime-1" },
        externalSessionId: "session-1",
        workingDirectory: "/repo/worktree",
      }),
    ).resolves.toEqual({ supported: true, hasLiveSession: true });
    await expect(
      registry.probeSessionStatus?.({
        runtimeKind: "codex",
        runtimeRoute: { type: "stdio", identity: "runtime-1" },
        externalSessionId: "session-2",
        workingDirectory: "/repo/worktree",
      }),
    ).resolves.toEqual({ supported: true, hasLiveSession: false });
    await expect(
      registry.probeSessionStatus?.({
        runtimeKind: "codex",
        runtimeRoute: { type: "stdio", identity: "runtime-1" },
        externalSessionId: "session-3",
        workingDirectory: "/repo/worktree",
      }),
    ).resolves.toEqual({ supported: true, hasLiveSession: false });

    expect(calls).toEqual([
      {
        runtimeId: "runtime-1",
        method: "thread/loaded/list",
        params: { cursor: null, limit: 100 },
      },
      {
        runtimeId: "runtime-1",
        method: "thread/list",
        params: { cursor: null, limit: 100 },
      },
      {
        runtimeId: "runtime-1",
        method: "thread/loaded/list",
        params: { cursor: null, limit: 100 },
      },
      {
        runtimeId: "runtime-1",
        method: "thread/list",
        params: { cursor: null, limit: 100 },
      },
      {
        runtimeId: "runtime-1",
        method: "thread/loaded/list",
        params: { cursor: null, limit: 100 },
      },
      {
        runtimeId: "runtime-1",
        method: "thread/list",
        params: { cursor: null, limit: 100 },
      },
    ]);
  });

  test("fails Codex session status probing on repeated pagination cursors", async () => {
    const registry = createRuntimeRegistry({
      codexAppServer: {
        async request() {
          return { data: ["session-1"], nextCursor: "cursor-1" };
        },
      },
    });

    await expect(
      registry.probeSessionStatus?.({
        runtimeKind: "codex",
        runtimeRoute: { type: "stdio", identity: "runtime-1" },
        externalSessionId: "session-1",
        workingDirectory: "/repo/worktree",
      }),
    ).rejects.toThrow("Codex thread/loaded/list returned a repeated pagination cursor");
  });
});
