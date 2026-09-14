import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { WorkspaceSession } from "@openducktor/contracts";
import { Effect } from "effect";
import { createSqliteTaskRepositoryContextManager } from "./sqlite-task-repository-context";
import {
  createSqliteTaskStoreHarness,
  type SqliteTaskStoreTestHarness,
} from "./sqlite-task-store-test-support";
import { createSqliteWorkspaceSessionStore } from "./sqlite-workspace-session-store";

const makeSession = (id = "one", updatedAt = 1): WorkspaceSession => ({
  id,
  runtimeKind: "codex",
  externalSessionId: `runtime-${id}`,
  executionTarget: {
    kind: "local_worktree",
    workingDirectory: `/repo/${id}`,
    branchName: `feature/${id}`,
    worktreeState: "present",
  },
  roleSnapshot: { id: "reviewer", name: "Reviewer", systemPrompt: "Review this code." },
  selectedModel: { runtimeKind: "codex", providerId: "openai", modelId: "model", variant: "high" },
  generatedTitle: null,
  manualTitle: null,
  createdAt: 1,
  updatedAt,
  archivedAt: null,
});

describe("SQLite Workspace Session store", () => {
  let harness: SqliteTaskStoreTestHarness;
  beforeEach(async () => {
    harness = await createSqliteTaskStoreHarness();
  });
  afterEach(async () => {
    await harness.cleanup();
  });
  const scope = () => ({ repoPath: harness.repoPath, workspaceId: "fairnest" });
  const ref = (sessionId = "one") => ({ ...scope(), sessionId });
  const store = () => createSqliteWorkspaceSessionStore(harness.contextProvider);

  test("stores worktree removal with the archive and clears it with restoration", async () => {
    const session = makeSession();
    await Effect.runPromise(store().create({ ...scope(), session }));
    const removed = {
      kind: "local_worktree" as const,
      workingDirectory: "/repo/one",
      branchName: "feature/one",
      worktreeState: "removed" as const,
    };
    const archived = await Effect.runPromise(
      store().archive({ ...ref(), archivedAt: 10, executionTarget: removed }),
    );
    expect(archived.executionTarget).toEqual(removed);
    expect(await Effect.runPromise(store().get(ref()))).toEqual({
      ...session,
      executionTarget: removed,
      archivedAt: 10,
    });
    expect(
      await Effect.runPromise(
        store().restore({ ...ref(), executionTarget: session.executionTarget }),
      ),
    ).toEqual(session);
  });

  test.each([false, true])(
    "persists metadata and Role snapshots across connection restarts, draft=%s",
    async (draft) => {
      const session = makeSession();
      if (draft) session.externalSessionId = null;
      await Effect.runPromise(store().create({ ...scope(), session }));
      const reopened = createSqliteTaskRepositoryContextManager({
        processEnv: {},
        resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
        resolveDatabasePath: () => Effect.succeed(harness.databasePath),
      });
      try {
        expect(
          await Effect.runPromise(
            createSqliteWorkspaceSessionStore(reopened.withDatabase).get(ref()),
          ),
        ).toEqual(session);
      } finally {
        await Effect.runPromise(reopened.dispose());
      }
    },
  );

  test("stores multiple drafts and binds each identity only once", async () => {
    const repository = store();
    for (const id of ["one", "two"]) {
      await Effect.runPromise(
        repository.create({ ...scope(), session: { ...makeSession(id), externalSessionId: null } }),
      );
    }
    expect(await Effect.runPromise(repository.listActive(scope()))).toHaveLength(2);
    const bound = await Effect.runPromise(
      repository.bindRuntimeSession({ ...ref(), externalSessionId: "bound-one" }),
    );
    expect(bound.externalSessionId).toBe("bound-one");
    await expect(
      Effect.runPromise(
        repository.bindRuntimeSession({ ...ref(), externalSessionId: "replacement" }),
      ),
    ).rejects.toThrow("active draft");
    await expect(
      Effect.runPromise(
        repository.bindRuntimeSession({ ...ref("two"), externalSessionId: "bound-one" }),
      ),
    ).rejects.toThrow();
    expect((await Effect.runPromise(repository.get(ref("two")))).externalSessionId).toBeNull();
    await Effect.runPromise(repository.archive({ ...ref("two"), archivedAt: 20 }));
    await expect(
      Effect.runPromise(
        repository.bindRuntimeSession({ ...ref("two"), externalSessionId: "bound-two" }),
      ),
    ).rejects.toThrow("active draft");
  });

  test("lists active and archived sessions for internal inventory", async () => {
    const repository = store();
    const active = makeSession("active");
    const archived = { ...makeSession("archived"), archivedAt: 10 };
    await Effect.runPromise(repository.create({ ...scope(), session: active }));
    await Effect.runPromise(repository.create({ ...scope(), session: archived }));

    expect(await Effect.runPromise(repository.listAll(scope()))).toEqual([active, archived]);
  });

  test("migrates existing workspace sessions without changing rows or indexes", async () => {
    const database = new Database(":memory:");
    try {
      database.exec(
        await Bun.file(new URL("./drizzle/0002_workspace_sessions.sql", import.meta.url)).text(),
      );
      database.exec(
        "INSERT INTO workspace_sessions VALUES ('existing', 'codex', 'native-existing', '{}', NULL, NULL, 'Title', 'Manual', 10, 20, 30)",
      );
      const original = database.query("SELECT * FROM workspace_sessions").all();
      database.exec(
        await Bun.file(
          new URL("./drizzle/0003_workspace_session_drafts.sql", import.meta.url),
        ).text(),
      );
      expect(database.query("SELECT * FROM workspace_sessions").all()).toEqual(original);
      expect(
        database
          .query(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_workspace_sessions_%' ORDER BY name",
          )
          .all(),
      ).toEqual([
        { name: "idx_workspace_sessions_active_updated" },
        { name: "idx_workspace_sessions_runtime_identity" },
      ]);
      database.exec(
        "INSERT INTO workspace_sessions VALUES ('draft-one', 'codex', NULL, '{}', NULL, NULL, NULL, NULL, 10, 20, NULL), ('draft-two', 'codex', NULL, '{}', NULL, NULL, NULL, NULL, 10, 20, NULL)",
      );
      expect(
        database
          .query("SELECT id FROM workspace_sessions WHERE external_session_id IS NULL ORDER BY id")
          .all(),
      ).toEqual([{ id: "draft-one" }, { id: "draft-two" }]);
      expect(() =>
        database.exec(
          "UPDATE workspace_sessions SET external_session_id = 'native-existing' WHERE id = 'draft-one'",
        ),
      ).toThrow();
    } finally {
      database.close();
    }
  });

  test("rejects duplicate identities, missing records, and a mismatched Workspace", async () => {
    const repository = store();
    await Effect.runPromise(repository.create({ ...scope(), session: makeSession() }));
    await expect(
      Effect.runPromise(repository.create({ ...scope(), session: makeSession() })),
    ).rejects.toThrow();
    await expect(
      Effect.runPromise(
        repository.create({ ...scope(), session: { ...makeSession(), id: "two" } }),
      ),
    ).rejects.toThrow();
    await expect(Effect.runPromise(repository.get(ref("absent")))).rejects.toThrow(
      "does not exist",
    );
    await expect(
      Effect.runPromise(repository.listActive({ ...scope(), workspaceId: "other" })),
    ).rejects.toThrow("no longer matches");
    expect(
      await Effect.runPromise(
        repository.findByRuntimeSession({
          ...scope(),
          runtimeKind: "codex",
          externalSessionId: "absent",
        }),
      ),
    ).toBeNull();
    expect(
      (
        await Effect.runPromise(
          repository.findByRuntimeSession({
            ...scope(),
            runtimeKind: "codex",
            externalSessionId: "runtime-one",
          }),
        )
      )?.id,
    ).toBe("one");
  });

  test("archives and restores idempotently without changing activity or execution", async () => {
    const repository = store();
    const original = makeSession();
    await Effect.runPromise(repository.create({ ...scope(), session: original }));
    const archived = await Effect.runPromise(repository.archive({ ...ref(), archivedAt: 20 }));
    expect(archived).toEqual({ ...original, archivedAt: 20 });
    expect(await Effect.runPromise(repository.archive({ ...ref(), archivedAt: 30 }))).toEqual(
      archived,
    );
    expect(await Effect.runPromise(repository.listActive(scope()))).toEqual([]);
    expect(await Effect.runPromise(repository.listArchived(scope()))).toEqual([archived]);
    expect(await Effect.runPromise(repository.restore(ref()))).toEqual(original);
    expect(await Effect.runPromise(repository.restore(ref()))).toEqual(original);
    expect(
      (await Effect.runPromise(repository.archive({ ...ref(), archivedAt: 40 }))).archivedAt,
    ).toBe(40);
  });

  test("validates models and titles while keeping activity unchanged", async () => {
    const repository = store();
    await Effect.runPromise(repository.create({ ...scope(), session: makeSession() }));
    expect(
      (await Effect.runPromise(repository.rename({ ...ref(), manualTitle: "  My\n  session " })))
        .manualTitle,
    ).toBe("My session");
    expect(
      (await Effect.runPromise(repository.rename({ ...ref(), manualTitle: " " }))).manualTitle,
    ).toBeNull();
    await expect(
      Effect.runPromise(repository.rename({ ...ref(), manualTitle: "a".repeat(121) })),
    ).rejects.toThrow("Invalid Workspace Session");
    const generated = await Effect.runPromise(
      repository.setGeneratedTitle({ ...ref(), generatedTitle: "Generated title" }),
    );
    expect(generated.updatedAt).toBe(1);
    expect(
      (
        await Effect.runPromise(
          repository.setGeneratedTitle({ ...ref(), generatedTitle: "Replacement" }),
        )
      ).generatedTitle,
    ).toBe("Replacement");
    await expect(
      Effect.runPromise(repository.setGeneratedTitle({ ...ref(), generatedTitle: "" })),
    ).rejects.toThrow();
    await expect(
      Effect.runPromise(
        repository.setSelectedModel({
          ...ref(),
          selectedModel: { runtimeKind: "opencode", providerId: "openai", modelId: "model" },
        }),
      ),
    ).rejects.toThrow("Invalid Workspace Session");
    expect((await Effect.runPromise(repository.get(ref()))).selectedModel?.runtimeKind).toBe(
      "codex",
    );
  });

  test("records activity forward only and orders active sessions by activity", async () => {
    const repository = store();
    await Effect.runPromise(repository.create({ ...scope(), session: makeSession("one", 10) }));
    await Effect.runPromise(repository.create({ ...scope(), session: makeSession("two", 20) }));
    for (const occurredAt of [30, 30, 5]) {
      expect(
        (
          await Effect.runPromise(
            repository.recordActivity({ ...ref(), activity: { type: "user_message", occurredAt } }),
          )
        ).updatedAt,
      ).toBe(30);
    }
    expect(
      (await Effect.runPromise(repository.listActive(scope()))).map((session) => session.id),
    ).toEqual(["one", "two"]);
    expect(
      (
        await Effect.runPromise(
          repository.recordActivity({
            ...ref(),
            activity: { type: "assistant_response", occurredAt: 40 },
          }),
        )
      ).updatedAt,
    ).toBe(40);
  });

  test("saves accepted-message metadata together and does not write unchanged replays", async () => {
    const repository = store();
    const original = { ...makeSession(), manualTitle: "My session" };
    await Effect.runPromise(repository.create({ ...scope(), session: original }));
    const selectedModel = {
      runtimeKind: "codex" as const,
      providerId: "openai",
      modelId: "chosen",
    };
    const saved = await Effect.runPromise(
      repository.recordAcceptedMessage({
        ...ref(),
        generatedTitle: "First message",
        occurredAt: 30,
        selectedModel,
      }),
    );
    expect(saved).toEqual({
      ...original,
      generatedTitle: "First message",
      updatedAt: 30,
      selectedModel,
    });
    const database = new Database(harness.databasePath);
    try {
      database.run(
        "CREATE TRIGGER reject_metadata_write BEFORE UPDATE ON workspace_sessions BEGIN SELECT RAISE(ABORT, 'unexpected metadata write'); END",
      );
      for (const occurredAt of [30, 5]) {
        expect(
          await Effect.runPromise(
            repository.recordAcceptedMessage({
              ...ref(),
              generatedTitle: "Replay title",
              occurredAt,
            }),
          ),
        ).toEqual(saved);
      }
    } finally {
      database.close();
    }
  });

  test.each(["model", "time", "write"] as const)(
    "keeps all fields unchanged after an accepted-message %s failure",
    async (failure) => {
      const repository = store();
      const original = makeSession();
      await Effect.runPromise(repository.create({ ...scope(), session: original }));
      const database = new Database(harness.databasePath);
      try {
        if (failure === "write")
          database.run(
            "CREATE TRIGGER reject_metadata_write BEFORE UPDATE ON workspace_sessions BEGIN SELECT RAISE(ABORT, 'metadata write failed'); END",
          );
        await expect(
          Effect.runPromise(
            repository.recordAcceptedMessage({
              ...ref(),
              generatedTitle: "First message",
              occurredAt: failure === "time" ? Number.NaN : 30,
              selectedModel: {
                runtimeKind: failure === "model" ? "opencode" : "codex",
                providerId: "openai",
                modelId: "chosen",
              },
            }),
          ),
        ).rejects.toThrow();
        expect(await Effect.runPromise(repository.get(ref()))).toEqual(original);
      } finally {
        database.close();
      }
    },
  );

  test("keeps the first committed title when accepted-message calls overlap", async () => {
    const repository = store();
    await Effect.runPromise(repository.create({ ...scope(), session: makeSession() }));
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let calls = 0;
    const paused = createSqliteWorkspaceSessionStore((repoPath, operation, use) => {
      const run = harness.contextProvider(repoPath, operation, use);
      if (operation !== "workspaceSessionStore.recordAcceptedMessage" || ++calls !== 1) return run;
      return Effect.promise(async () => {
        entered.resolve();
        await release.promise;
      }).pipe(Effect.zipRight(run));
    });
    const first = Effect.runPromise(
      paused.recordAcceptedMessage({ ...ref(), generatedTitle: "Delayed", occurredAt: 30 }),
    );
    try {
      await entered.promise;
      await Effect.runPromise(
        paused.recordAcceptedMessage({
          ...ref(),
          generatedTitle: "Committed first",
          occurredAt: 20,
        }),
      );
    } finally {
      release.resolve();
    }
    expect((await first).generatedTitle).toBe("Committed first");
    expect(await Effect.runPromise(repository.get(ref()))).toMatchObject({
      generatedTitle: "Committed first",
      updatedAt: 30,
    });
  });

  test("limits archived sessions to the latest 100 without limiting active sessions", async () => {
    const repository = store();
    for (let index = 0; index < 102; index += 1) {
      await Effect.runPromise(
        repository.create({ ...scope(), session: makeSession(String(index), index) }),
      );
    }
    expect(await Effect.runPromise(repository.listActive(scope()))).toHaveLength(102);
    for (let index = 0; index < 102; index += 1) {
      await Effect.runPromise(repository.archive({ ...ref(String(index)), archivedAt: index }));
    }
    const archived = await Effect.runPromise(repository.listArchived(scope()));
    expect(archived).toHaveLength(100);
    expect(archived[0]?.id).toBe("101");
    expect(archived[99]?.id).toBe("2");
  });

  test("surfaces corrupt stored JSON instead of hiding the record", async () => {
    const repository = store();
    await Effect.runPromise(repository.create({ ...scope(), session: makeSession() }));
    const database = new Database(harness.databasePath);
    try {
      database.run("UPDATE workspace_sessions SET role_snapshot_json = 'broken' WHERE id = 'one'");
    } finally {
      database.close();
    }
    await expect(Effect.runPromise(repository.listActive(scope()))).rejects.toThrow(
      "Stored Workspace Session one is invalid",
    );
  });
});
