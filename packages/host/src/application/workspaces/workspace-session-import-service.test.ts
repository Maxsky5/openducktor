import { afterEach, describe, expect, test } from "bun:test";
import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  repoConfigSchema,
  type WorkspaceSessionExternal,
} from "@openducktor/contracts";
import { Deferred, Effect, Fiber } from "effect";
import { createSqliteTaskStoreHarness } from "../../adapters/sqlite/sqlite-task-store-test-support";
import { createSqliteWorkspaceSessionStore } from "../../adapters/sqlite/sqlite-workspace-session-store";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import {
  createAgentSessionRuntimeAdapterTestDouble,
  createGitPortTestDouble,
} from "../../test-support/service-test-doubles";
import { HostOperationError } from "../../effect/host-errors";
import { createTaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import { createWorkspaceSessionImportService } from "./workspace-session-import-service";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const failure = (message: string) => new HostOperationError({ operation: "test.import", message });
const setup = async () => {
  const database = await createSqliteTaskStoreHarness({ repoPath: "/repo" });
  cleanups.push(database.cleanup);
  const store = createSqliteWorkspaceSessionStore(database.contextProvider);
  const registry = createLiveSessionAdapterRegistry();
  const calls: string[] = [];
  type ImportTestState = {
    failPrepare: boolean;
    failSave: boolean;
    failCommit: boolean;
    detached: boolean;
    rows: WorkspaceSessionExternal[];
    signal: AbortSignal | null;
  };
  const state: ImportTestState = {
    failPrepare: false,
    failSave: false,
    failCommit: false,
    detached: false,
    rows: [],
    signal: null,
  };
  const row = (id: string, directory = "/repo"): WorkspaceSessionExternal => ({
    externalSessionId: id,
    runtimeKind: "opencode",
    workingDirectory: directory,
    title: `Native ${id}`,
    updatedAt: 123,
  });
  const adapter = createAgentSessionRuntimeAdapterTestDouble(
    { runtimeId: "runtime-1", repoPath: "/repo", runtimeKind: "opencode" },
    {
      externalSessions: {
        list: ({ cursor, signal }) =>
          Effect.sync(() => {
            calls.push("list");
            state.signal = signal;
            const offset = Number(cursor ?? 0);
            return {
              sessions: state.rows.slice(offset, offset + 100),
              nextCursor: offset + 100 < state.rows.length ? String(offset + 100) : null,
            };
          }),
        inspect: (ref) =>
          Effect.sync(() => {
            calls.push("inspect");
            return row(ref.externalSessionId, ref.workingDirectory);
          }),
        prepare: (ref) =>
          Effect.suspend(() => {
            calls.push("prepare");
            if (state.failPrepare) return Effect.fail(failure("preparation failed"));
            return Effect.succeed({
              metadata: {
                ...row(ref.externalSessionId, ref.workingDirectory),
                title: "Native title ".repeat(30),
              },
              commit: Effect.suspend(() => {
                calls.push("commit");
                return state.failCommit ? Effect.fail(failure("publication failed")) : Effect.void;
              }),
              dispose: Effect.sync(() => {
                calls.push("dispose");
              }),
            });
          }),
      },
    },
  );
  await Effect.runPromise(registry.register(adapter));
  const lifecycle = createTaskSessionLifecycleCoordinator();
  const service = createWorkspaceSessionImportService({
    store: {
      ...store,
      importSession: (input) =>
        Effect.suspend(() => {
          calls.push("save");
          return state.failSave ? Effect.fail(failure("save failed")) : store.importSession(input);
        }),
    },
    settings: {
      getRepoConfig: () =>
        Effect.succeed(
          repoConfigSchema.parse({
            workspaceId: "fairnest",
            workspaceName: "Fairnest",
            repoPath: "/repo",
          }),
        ),
    },
    runtime: {
      runtimeEnsure: () =>
        Effect.succeed({
          kind: "opencode",
          runtimeId: "runtime-1",
          repoPath: "/repo",
          taskId: null,
          role: "workspace",
          workingDirectory: "/repo",
          runtimeRoute: { type: "local_http", endpoint: "http://localhost:1234" },
          startedAt: "2026-09-20T00:00:00Z",
          descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
        }),
    },
    git: createGitPortTestDouble({
      canonicalizePath: (path) => Effect.succeed(path === "/alias" ? "/tree" : path),
      listWorktrees: () =>
        Effect.succeed([
          { worktreePath: "/tree", branch: "feature", head: "abc", detached: false },
        ]),
      isGitRepository: () => Effect.succeed(true),
      shareGitCommonDirectory: () => Effect.succeed(true),
      isRegisteredWorktree: (_repo, path) => Effect.succeed(path === "/tree"),
      getCurrentBranch: () =>
        Effect.succeed({ name: state.detached ? undefined : "feature", detached: state.detached }),
    }),
    registry,
    lifecycle,
    publishUpdated: () =>
      Effect.sync(() => {
        calls.push("publish");
      }),
  });
  cleanups.push(() => Effect.runPromise(service.shutdown()));
  const input = {
    workspaceId: "fairnest",
    runtimeKind: "opencode" as const,
    externalSessionId: "native",
    workingDirectory: "/repo",
  };
  const list = {
    workspaceId: "fairnest",
    runtimeKind: "opencode" as const,
    catalogRequestId: crypto.randomUUID(),
    search: "",
    pageSize: 50,
  };
  return { service, store, state, row, calls, input, list, registry, adapter, lifecycle };
};

describe("external workspace session import", () => {
  test("searches all metadata pages and retains only workspace roots", async () => {
    const h = await setup();
    h.state.rows = Array.from({ length: 3000 }, (_, index) =>
      h.row(`id-${index.toString().padStart(4, "0")}`),
    );
    h.state.rows.push(
      h.row("alias", "/alias"),
      h.row("other", "/other"),
      h.row("subdirectory", "/repo/src"),
    );
    const first = await Effect.runPromise(h.service.list(h.list));
    expect(first.sessions).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const searched = await Effect.runPromise(
      h.service.list({ ...h.list, search: "NATIVE ID-2999" }),
    );
    expect(searched.sessions.map((row) => row.externalSessionId)).toEqual(["id-2999"]);
    const alias = await Effect.runPromise(h.service.list({ ...h.list, search: "/alias" }));
    expect(alias.sessions[0]?.workingDirectory).toBe("/alias");
    expect(
      (await Effect.runPromise(h.service.list({ ...h.list, search: "other" }))).sessions,
    ).toEqual([]);
    expect(h.calls).not.toContain("prepare");
    expect(h.calls.filter((call) => call === "list")).toHaveLength(31);
    await expect(
      Effect.runPromise(
        h.service.list({ ...h.list, search: "changed", cursor: first.nextCursor! }),
      ),
    ).rejects.toThrow("cursor");
    await Effect.runPromise(h.service.release(h.list));
    expect(h.state.signal?.aborted).toBe(true);
  });

  test("saves original metadata before live admission and deduplicates concurrent imports", async () => {
    const h = await setup();
    const [first, second] = await Promise.all([
      Effect.runPromise(h.service.importSession(h.input)),
      Effect.runPromise(h.service.importSession(h.input)),
    ]);
    expect(first.session.id).toBe(second.session.id);
    expect([first.created, second.created]).toEqual([true, false]);
    expect(first.session).toMatchObject({
      externalSessionId: "native",
      roleSnapshot: null,
      selectedModel: null,
      manualTitle: "Native title ".repeat(30),
    });
    expect(h.calls).toEqual(["inspect", "prepare", "save", "commit", "publish", "dispose"]);
    await Effect.runPromise(
      h.store.archive({
        workspaceId: "fairnest",
        repoPath: "/repo",
        sessionId: first.session.id,
        archivedAt: 10,
      }),
    );
    await expect(Effect.runPromise(h.service.importSession(h.input))).rejects.toThrow(
      "archived chat",
    );
  });

  test.each(["failPrepare", "failSave"] as const)(
    "does not admit or persist on %s",
    async (flag) => {
      const h = await setup();
      h.state[flag] = true;
      await expect(Effect.runPromise(h.service.importSession(h.input))).rejects.toThrow();
      expect(
        await Effect.runPromise(h.store.listActive({ workspaceId: "fairnest", repoPath: "/repo" })),
      ).toEqual([]);
      expect(h.calls).not.toContain("commit");
      if (flag === "failSave") expect(h.calls).toContain("dispose");
    },
  );

  test("keeps the saved record after live publication fails", async () => {
    const h = await setup();
    h.state.failCommit = true;
    const result = await Effect.runPromise(h.service.importSession(h.input));
    expect(result.openError).toContain("publication failed");
    expect((await Effect.runPromise(h.service.importSession(h.input))).session.id).toBe(
      result.session.id,
    );
    expect(h.calls.filter((call) => call === "save")).toHaveLength(1);
  });

  test("imports a detached worktree and preserves its native alias", async () => {
    const h = await setup();
    h.state.detached = true;
    const result = await Effect.runPromise(
      h.service.importSession({ ...h.input, workingDirectory: "/alias" }),
    );
    expect(result.session.executionTarget).toEqual({
      kind: "local_worktree",
      workingDirectory: "/alias",
      branchName: null,
      worktreeState: "present",
    });
  });

  test("release interrupts an in-flight catalog without admitting a session", async () => {
    const h = await setup();
    const entered = Effect.runSync(Deferred.make<void>());
    h.adapter.externalSessions.list = ({ signal }) =>
      Effect.sync(() => {
        h.state.signal = signal;
      }).pipe(Effect.zipRight(Deferred.succeed(entered, undefined)), Effect.zipRight(Effect.never));
    const fiber = Effect.runFork(h.service.list(h.list));
    await Effect.runPromise(Deferred.await(entered));
    await Effect.runPromise(h.service.release(h.list));
    expect((await Effect.runPromise(Fiber.await(fiber)))._tag).toBe("Failure");
    expect(h.state.signal?.aborted).toBe(true);
  });
});
