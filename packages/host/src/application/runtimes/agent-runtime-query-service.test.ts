import { expect, test } from "bun:test";
import {
  createPrepareOpencodeSessionRuntime,
  OpencodeSdkAdapter,
  type PreparedOpencodeSessionRuntime,
} from "@openducktor/adapters-opencode-sdk";
import {
  type AgentSessionLiveSnapshot,
  type RuntimeInstanceSummary,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeKind,
  repoConfigSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { once } from "node:events";
import { createServer } from "node:http";
import { z, type JSONType } from "zod";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import { createRuntimeQueryAdapter } from "../../adapters/agent-sessions/runtime-query-adapter";
import { unexpectedRuntimeQueries } from "../../test-support/runtime-query-test-doubles";
import {
  createAgentSessionRuntimeAdapterTestDouble,
  createSettingsConfigTestDouble,
  createWorkspaceSettingsServiceTestDouble,
} from "../../test-support/service-test-doubles";
import { HostOperationError, HostResourceError } from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import { createTaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import { createAgentRuntimeQueryService } from "./agent-runtime-query-service";

const repoPath = "/remote/repo";
const workingDirectory = "/worktrees/workspace/task";
const harness = async (
  runtimeKind: RuntimeKind = "opencode",
  options: {
    sessionWorkingDirectory?: string;
    worktreeBasePath?: string | undefined;
    canonicalizePath?: SettingsConfigPort["canonicalizePath"];
  } = {},
) => {
  let runtime: RuntimeInstanceSummary | null = {
    runtimeId: "runtime-1",
    kind: runtimeKind,
    runtimeRoute:
      runtimeKind === "opencode"
        ? { type: "local_http", endpoint: "http://127.0.0.1:7777" }
        : { type: "host_service", identity: "runtime-1" },
    startedAt: "2026-09-10T10:00:00.000Z",
    descriptor: RUNTIME_DESCRIPTORS_BY_KIND[runtimeKind],
  };
  const calls: unknown[] = [];
  let beforeModels = async () => {};
  let snapshots: AgentSessionLiveSnapshot[] = [];
  const adapterRegistry = createLiveSessionAdapterRegistry();
  const worktreeReads = createTaskSessionLifecycleCoordinator();
  const adapter = createAgentSessionRuntimeAdapterTestDouble(
    { runtimeKind, runtimeId: "runtime-1" },
    {
      queries: {
        ...unexpectedRuntimeQueries,
        resolveSessionParent: (ref) =>
          Effect.succeed(ref.externalSessionId === "cold-child" ? "root" : null),
        loadRuntimeCatalog: (input) =>
          Effect.promise(async () => {
            await beforeModels();
            calls.push(input);
            return {
              models: {
                status: "available" as const,
                catalog: { models: [], defaultModelsByProvider: {} },
              },
            };
          }),
        loadSessionHistory: (input) =>
          Effect.sync(() => {
            calls.push(input);
            return [];
          }),
        searchFiles: (input) =>
          Effect.sync(() => {
            calls.push(input);
            return [];
          }),
      },
      readSnapshot: (ref) =>
        Effect.succeed(
          snapshots.find((s) => s.ref.externalSessionId === ref.externalSessionId)
            ? {
                type: "live" as const,
                session: snapshots.find((s) => s.ref.externalSessionId === ref.externalSessionId)!,
              }
            : { type: "missing" as const, ref },
        ),
    },
  );
  await Effect.runPromise(adapterRegistry.register(adapter));
  const service = createAgentRuntimeQueryService({
    adapterRegistry,
    runtimeRegistry: {
      requireReady: (kind) =>
        Effect.suspend(() =>
          runtime
            ? Effect.succeed(runtime)
            : Effect.fail(
                new HostResourceError({
                  resource: "agent_runtime",
                  operation: "runtime.requireReady",
                  message: `The ${kind} runtime is not ready yet. Wait for the runtime to start, or check Diagnostics.`,
                }),
              ),
        ),
    },
    gitPort: {
      canonicalizePath: (path) => Effect.succeed(path === "/alias" ? repoPath : path),
      isGitRepository: (path) => Effect.succeed(path === repoPath),
      shareGitCommonDirectory: () => Effect.succeed(false),
      isRegisteredWorktree: () => Effect.succeed(false),
    },
    settingsConfig: createSettingsConfigTestDouble({
      canonicalizePath:
        options.canonicalizePath ??
        ((path) =>
          path === "/missing"
            ? Effect.fail(new HostOperationError({ operation: "realpath", message: "missing" }))
            : Effect.succeed(path)),
      defaultWorktreeBasePath: () => "/worktrees/workspace",
      defaultRepoWorktreeBasePath: () => "/legacy/repo",
      resolveConfiguredPath: (path) => path,
    }),
    workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
      getRepoConfigByRepoPath: () =>
        Effect.succeed(
          repoConfigSchema.parse({
            workspaceId: "workspace",
            workspaceName: "Workspace",
            repoPath,
            worktreeBasePath: options.worktreeBasePath,
          }),
        ),
    }),
    taskReader: {
      getTaskMetadata: () =>
        Effect.succeed({
          spec: { markdown: "" },
          plan: { markdown: "" },
          agentSessions: [
            {
              externalSessionId: "root",
              runtimeKind,
              workingDirectory: options.sessionWorkingDirectory ?? workingDirectory,
              role: "build",
              startedAt: "2026-09-10T10:00:00.000Z",
              selectedModel: null,
            },
          ],
        }),
    },
    worktreeReads,
    worktreeFiles: {
      resolvePathWithinRoot: () => Effect.die("Unexpected removed-worktree history lookup"),
    },
  });
  return {
    service,
    adapter,
    adapterRegistry,
    worktreeReads,
    calls,
    setBeforeModels: (read: () => Promise<void>) => {
      beforeModels = read;
    },
    setRuntime: (next: RuntimeInstanceSummary | null) => {
      runtime = next;
    },
    runtime: runtime!,
    setSnapshots: (next: AgentSessionLiveSnapshot[]) => {
      snapshots = next;
    },
  };
};

for (const runtimeKind of ["opencode", "claude", "codex"] as const) {
  test(`${runtimeKind} resolves the registered host adapter for a canonical repository`, async () => {
    const h = await harness(runtimeKind);
    await expect(
      Effect.runPromise(
        h.service.loadRuntimeCatalog({
          repoPath: "/alias",
          runtimeKind,
          workingDirectory: repoPath,
        }),
      ),
    ).resolves.toEqual({
      models: {
        status: "available",
        catalog: { models: [], defaultModelsByProvider: {} },
      },
    });
    expect(h.calls).toEqual([{ repoPath, runtimeKind, workingDirectory: repoPath }]);
  });
}

for (const directory of [repoPath, `${repoPath}/nested`, workingDirectory, "/legacy/repo/task"]) {
  test(`accepts workspace directory ${directory}`, async () => {
    const h = await harness();
    await Effect.runPromise(
      h.service.searchFiles({
        repoPath,
        runtimeKind: "opencode",
        workingDirectory: directory,
        query: "src",
      }),
    );
    expect(h.calls).toEqual([
      { repoPath, runtimeKind: "opencode", workingDirectory: directory, query: "src" },
    ]);
  });
}

for (const directory of ["/missing", "/unrelated", "/remote/repository"]) {
  test(`rejects invalid directory ${directory} before dispatch`, async () => {
    const h = await harness();
    const failure = await Effect.runPromise(
      Effect.flip(
        h.service.searchFiles({
          repoPath,
          runtimeKind: "opencode",
          workingDirectory: directory,
          query: "",
        }),
      ),
    );
    expect(failure.failure.code).toBe("scope_mismatch");
    expect(h.calls).toHaveLength(0);
  });
}

for (const runtime of [
  { runtimeKind: "opencode", runtimePolicy: { kind: "opencode" } },
  {
    runtimeKind: "codex",
    runtimePolicy: {
      kind: "codex",
      policy: {
        sandboxMode: "workspace-write",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        commandNetworkAccess: false,
        approvalsReviewerApplies: true,
      },
    },
  },
] as const) {
  const { runtimeKind } = runtime;
  for (const worktreeBasePath of [undefined, "/configured/worktrees"]) {
    test(`${runtimeKind} reads legacy sessions when the ${worktreeBasePath === undefined ? "default" : "configured"} worktree base is absent`, async () => {
      const legacyDirectory = "/legacy/repo/task";
      const missingBase = worktreeBasePath ?? "/worktrees/workspace";
      const h = await harness(runtimeKind, {
        sessionWorkingDirectory: legacyDirectory,
        worktreeBasePath,
        canonicalizePath: (path) =>
          path === missingBase || path === "/missing"
            ? Effect.fail(
                new HostOperationError({
                  operation: "settingsConfig.canonicalizePath",
                  message: "Worktree base does not exist",
                  cause: Object.assign(new Error("No such directory"), { code: "ENOENT" }),
                }),
              )
            : Effect.succeed(path),
      });
      const historyInput = {
        ...runtime,
        repoPath,
        workingDirectory: legacyDirectory,
        externalSessionId: "root",
        sessionScope: { kind: "workflow", taskId: "task", role: "build" },
      } as const;
      const searchInput = {
        repoPath,
        runtimeKind,
        workingDirectory: legacyDirectory,
        query: "src",
      };

      expect(await Effect.runPromise(h.service.loadSessionHistory(historyInput))).toEqual([]);
      expect(await Effect.runPromise(h.service.searchFiles(searchInput))).toEqual([]);
      expect(h.calls).toEqual([historyInput, searchInput]);

      const failure = await Effect.runPromise(
        Effect.flip(
          h.service.loadSessionHistory({ ...historyInput, externalSessionId: "unowned" }),
        ),
      );
      expect(failure.failure.code).toBe("scope_mismatch");
      for (const directory of ["/missing", "/unrelated"]) {
        const directoryFailure = await Effect.runPromise(
          Effect.flip(h.service.searchFiles({ ...searchInput, workingDirectory: directory })),
        );
        expect(directoryFailure.failure.code).toBe("scope_mismatch");
      }
      expect(h.calls).toHaveLength(2);
    });
  }
}

test("rejects a runtime that is not ready or a mismatched binding without starting another runtime", async () => {
  const h = await harness();
  for (const runtime of [null, { ...h.runtime, runtimeId: "replacement" }]) {
    h.setRuntime(runtime);
    const error = await Effect.runPromise(
      Effect.flip(
        h.service.loadRuntimeCatalog({
          repoPath,
          runtimeKind: "opencode",
          workingDirectory: repoPath,
        }),
      ),
    );
    expect(error.failure.code).toBe("runtime_unavailable");
    if (runtime === null) {
      expect(error.failure.detail).toBe(
        "The opencode runtime is not ready yet. Wait for the runtime to start, or check Diagnostics.",
      );
    }
  }
  expect(h.calls).toHaveLength(0);
});

test("rejects a read that overlaps replacement and resolves the new adapter on the next read", async () => {
  const h = await harness();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  h.setBeforeModels(async () => {
    entered.resolve();
    await release.promise;
  });
  const pending = Effect.runPromise(
    Effect.flip(
      h.service.loadRuntimeCatalog({
        repoPath,
        runtimeKind: "opencode",
        workingDirectory: repoPath,
      }),
    ),
  );
  await entered.promise;
  await Effect.runPromise(h.adapterRegistry.remove("runtime-1"));
  const replacement = createAgentSessionRuntimeAdapterTestDouble(
    { ...h.adapter.binding, runtimeId: "runtime-2" },
    {
      queries: {
        ...unexpectedRuntimeQueries,
        loadRuntimeCatalog: () =>
          Effect.succeed({
            models: {
              status: "available" as const,
              catalog: { models: [], defaultModelsByProvider: { native: "new" } },
            },
          }),
      },
    },
  );
  h.setRuntime({ ...h.runtime, runtimeId: "runtime-2" });
  await Effect.runPromise(h.adapterRegistry.register(replacement));
  release.resolve();
  expect((await pending).failure.code).toBe("runtime_unavailable");
  expect(
    await Effect.runPromise(
      h.service.loadRuntimeCatalog({
        repoPath,
        runtimeKind: "opencode",
        workingDirectory: repoPath,
      }),
    ),
  ).toEqual({
    models: {
      status: "available",
      catalog: { models: [], defaultModelsByProvider: { native: "new" } },
    },
  });
});

const historyRef = {
  repoPath,
  workingDirectory,
  runtimeKind: "opencode",
  externalSessionId: "root",
  runtimePolicy: { kind: "opencode" },
} as const;

test.each(["history", "child ancestry", "diff", "import inspection"] as const)(
  "OpenCode session reads finish under the host worktree guard: %s",
  async (operation) => {
    const h = await harness();
    const server = createServer((request, reply) => {
      reply.setHeader("access-control-allow-origin", "*");
      reply.setHeader("access-control-allow-headers", "authorization,content-type");
      if (request.method === "OPTIONS") {
        reply.writeHead(204);
        return reply.end();
      }
      const path = new URL(request.url!, "http://127.0.0.1").pathname;
      const respond = (data: JSONType) => {
        reply.writeHead(200, { "content-type": "application/json" });
        reply.end(JSON.stringify(data));
      };
      if (path === "/api/info")
        return respond({ version: "2.0.24", pid: 42, urls: [], paths: { tmp: "/tmp" } });
      if (path.endsWith("/migration/v1")) return respond({ status: "completed" });
      if (path.endsWith("/instructions/entries")) return respond({ data: [] });
      if (path.endsWith("/message"))
        return respond({
          data: [
            {
              id: "msg_retained",
              type: "user",
              time: { created: 1 },
              text: "Retained conversation",
            },
          ],
          cursor: { next: null, prev: null },
        });
      if (path.endsWith("/diff")) return respond({ data: [] });
      if (path.startsWith("/api/session/")) {
        const id = path.split("/").at(-1)!;
        const data = {
          id,
          projectID: "project-1",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 2 },
          location: { directory: workingDirectory },
          model: { providerID: "test", id: "test-model" },
        } satisfies Awaited<ReturnType<OpencodeSdkAdapter["readNativeSession"]>>;
        if (id === "cold-child") return respond({ data: { ...data, parentID: "root" } });
        return respond({ data });
      }
      reply.writeHead(500);
      reply.end("Unexpected native request");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = z.object({ port: z.number().int().positive() }).parse(server.address());
    const connection = {
      runtimeId: h.runtime.runtimeId,
      endpoint: `http://127.0.0.1:${address.port}`,
      authentication: {
        type: "basic" as const,
        username: "opencode" as const,
        password: "test-password",
      },
    };
    const controller = new OpencodeSdkAdapter(
      connection,
      {
        resolveCreationSettings: async () => ({ defaults: [], role: [] }),
      },
      {
        readDirectory: (directory, read) =>
          Effect.runPromise(h.worktreeReads.runWorktreeRead(directory, Effect.promise(read))),
        ensureMcp: async () => {},
        admitted: () => {},
      },
    );
    controller.client.event.subscribe = ({ signal } = {}) => ({
      async *[Symbol.asyncIterator]() {
        const stopped = Promise.withResolvers<void>();
        const stop = () => stopped.resolve();
        signal?.addEventListener("abort", stop, { once: true });
        try {
          yield { id: "connected", type: "server.connected" as const, data: {} };
          await stopped.promise;
        } finally {
          signal?.removeEventListener("abort", stop);
        }
      },
    });
    const prepareRuntime = createPrepareOpencodeSessionRuntime({
      ...controller.options,
      createClient: () => controller.client,
      readDirectory: controller.hooks.readDirectory,
      resolveMcpServerConfig: async () => {
        throw new Error("A native read must not install MCP");
      },
    });
    let runtime: PreparedOpencodeSessionRuntime | undefined;
    try {
      runtime = await prepareRuntime({
        runtimeId: connection.runtimeId,
        runtimeEndpoint: connection.endpoint,
        connection,
      });
      Object.assign(h.adapter.queries, createRuntimeQueryAdapter(runtime.queries));
      if (operation === "diff") {
        expect(
          await Effect.runPromise(
            h.service.loadSessionDiff(historyRef).pipe(Effect.timeout("2 seconds")),
          ),
        ).toEqual([]);
      } else if (operation === "import inspection") {
        const importPort = runtime.sessionImport;
        const source = await Effect.runPromise(
          h.worktreeReads
            .runWorktreeRead(
              workingDirectory,
              Effect.promise(() => importPort.inspectSession(historyRef)),
            )
            .pipe(Effect.timeout("2 seconds")),
        );
        expect(source.metadata).toMatchObject({
          externalSessionId: "root",
          workingDirectory,
          runtimeKind: "opencode",
        });
      } else {
        const history = await Effect.runPromise(
          h.service
            .loadSessionHistory({
              ...historyRef,
              externalSessionId: operation === "child ancestry" ? "cold-child" : "root",
              sessionScope: { kind: "workflow", taskId: "task", role: "build" },
            })
            .pipe(Effect.timeout("2 seconds")),
        );
        expect(history).toMatchObject([
          { messageId: "msg_retained", text: "Retained conversation" },
        ]);
      }
    } finally {
      await runtime?.release();
      controller.close();
      await new Promise<void>((resolve, reject) =>
        server.close((cause) => (cause ? reject(cause) : resolve())),
      );
    }
  },
);

test("reads cold history without a live snapshot and requires task ownership when scope is supplied", async () => {
  const h = await harness();
  await Effect.runPromise(h.service.loadSessionHistory(historyRef));
  await Effect.runPromise(
    h.service.loadSessionHistory({
      ...historyRef,
      sessionScope: { kind: "workflow", taskId: "task", role: "build" },
    }),
  );
  for (const input of [
    {
      ...historyRef,
      externalSessionId: "unowned",
      sessionScope: { kind: "workflow", taskId: "task", role: "build" },
    },
    { ...historyRef, sessionScope: { kind: "workflow", taskId: "task", role: "qa" } },
  ] as const) {
    expect(
      (await Effect.runPromise(Effect.flip(h.service.loadSessionHistory(input)))).failure.code,
    ).toBe("scope_mismatch");
  }
  expect(h.calls).toHaveLength(2);
});

test("accepts retained child ancestry backed by an ODT root record", async () => {
  const h = await harness();
  h.setSnapshots([
    {
      ref: { ...historyRef, externalSessionId: "child" },
      parentExternalSessionId: "root",
      activity: "idle",
      title: "Child",
      startedAt: h.runtime.startedAt,
      pendingApprovals: [],
      pendingQuestions: [],
      contextUsage: null,
    },
  ]);
  await Effect.runPromise(
    h.service.loadSessionHistory({
      ...historyRef,
      externalSessionId: "child",
      sessionScope: { kind: "workflow", taskId: "task", role: "build" },
    }),
  );
  expect(h.calls).toHaveLength(1);
});

test("rejects retained child ancestry without an ODT ownership record", async () => {
  const h = await harness();
  h.setSnapshots([
    {
      ref: { ...historyRef, externalSessionId: "child" },
      parentExternalSessionId: "unowned-root",
      activity: "idle",
      title: "Child",
      startedAt: h.runtime.startedAt,
      pendingApprovals: [],
      pendingQuestions: [],
      contextUsage: null,
    },
  ]);
  const failure = await Effect.runPromise(
    Effect.flip(
      h.service.loadSessionHistory({
        ...historyRef,
        externalSessionId: "child",
        sessionScope: { kind: "workflow", taskId: "task", role: "build" },
      }),
    ),
  );
  expect(failure.failure.code).toBe("scope_mismatch");
  expect(h.calls).toHaveLength(0);
});

test("reports unsupported operations without invoking the native query", async () => {
  const h = await harness("claude");
  expect(
    (
      await Effect.runPromise(
        Effect.flip(h.service.loadSessionDiff({ ...historyRef, runtimeKind: "claude" })),
      )
    ).failure.code,
  ).toBe("unsupported_operation");
  expect(h.calls).toHaveLength(0);
});

test("reads cold child history through native lineage and an existing ODT ownership record", async () => {
  const h = await harness();
  await Effect.runPromise(
    h.service.loadSessionHistory({
      ...historyRef,
      externalSessionId: "cold-child",
      sessionScope: { kind: "workflow", taskId: "task", role: "build" },
    }),
  );
  expect(h.calls).toHaveLength(1);
});
