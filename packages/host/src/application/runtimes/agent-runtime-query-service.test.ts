import { expect, test } from "bun:test";
import {
  type AgentSessionLiveSnapshot,
  type RuntimeInstanceSummary,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeKind,
  repoConfigSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import { unexpectedRuntimeQueries } from "../../test-support/runtime-query-test-doubles";
import {
  createAgentSessionRuntimeAdapterTestDouble,
  createSettingsConfigTestDouble,
  createWorkspaceSettingsServiceTestDouble,
} from "../../test-support/service-test-doubles";
import { HostOperationError } from "../../effect/host-errors";
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
    repoPath,
    taskId: null,
    role: "workspace",
    workingDirectory: repoPath,
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
  const adapter = createAgentSessionRuntimeAdapterTestDouble(
    { repoPath, runtimeKind, runtimeId: runtime.runtimeId },
    {
      queries: {
        ...unexpectedRuntimeQueries,
        resolveSessionParent: (ref) =>
          Effect.succeed(ref.externalSessionId === "cold-child" ? "root" : null),
        listAvailableModels: (input) =>
          Effect.promise(async () => {
            await beforeModels();
            calls.push(input);
            return { models: [], defaultModelsByProvider: {} };
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
    runtimeRegistry: { findWorkspaceRuntime: () => Effect.sync(() => runtime) },
    gitPort: {
      canonicalizePath: (path) => Effect.succeed(path === "/alias" ? repoPath : path),
      isGitRepository: (path) => Effect.succeed(path === repoPath),
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
            defaultRuntimeKind: "opencode",
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
    worktreeReads: createTaskSessionLifecycleCoordinator(),
  });
  return {
    service,
    adapter,
    adapterRegistry,
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
      Effect.runPromise(h.service.listAvailableModels({ repoPath: "/alias", runtimeKind })),
    ).resolves.toEqual({ models: [], defaultModelsByProvider: {} });
    expect(h.calls).toEqual([{ repoPath, runtimeKind }]);
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

test("rejects missing and mismatched runtime bindings without starting another runtime", async () => {
  const h = await harness();
  for (const runtime of [null, { ...h.runtime, runtimeId: "replacement" }]) {
    h.setRuntime(runtime);
    const error = await Effect.runPromise(
      Effect.flip(h.service.listAvailableModels({ repoPath, runtimeKind: "opencode" })),
    );
    expect(error.failure.code).toBe("runtime_unavailable");
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
    Effect.flip(h.service.listAvailableModels({ repoPath, runtimeKind: "opencode" })),
  );
  await entered.promise;
  await Effect.runPromise(h.adapterRegistry.remove("runtime-1"));
  const replacement = createAgentSessionRuntimeAdapterTestDouble(
    { ...h.adapter.binding, runtimeId: "runtime-2" },
    {
      queries: {
        ...unexpectedRuntimeQueries,
        listAvailableModels: () =>
          Effect.succeed({ models: [], defaultModelsByProvider: { native: "new" } }),
      },
    },
  );
  h.setRuntime({ ...h.runtime, runtimeId: "runtime-2" });
  await Effect.runPromise(h.adapterRegistry.register(replacement));
  release.resolve();
  expect((await pending).failure.code).toBe("runtime_unavailable");
  expect(
    await Effect.runPromise(h.service.listAvailableModels({ repoPath, runtimeKind: "opencode" })),
  ).toEqual({ models: [], defaultModelsByProvider: { native: "new" } });
});

const historyRef = {
  repoPath,
  workingDirectory,
  runtimeKind: "opencode",
  externalSessionId: "root",
  runtimePolicy: { kind: "opencode" },
} as const;

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
