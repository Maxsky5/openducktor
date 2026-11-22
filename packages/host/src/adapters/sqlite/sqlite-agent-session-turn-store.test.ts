import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";
import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { createSqliteAgentSessionTurnStore } from "./sqlite-agent-session-turn-store";
import { importHostDatabase } from "./sqlite-host-database-import";
import { workspaces } from "./sqlite-host-settings-schema";
import { createSqliteHostDatabaseManager } from "./sqlite-task-repository-context";

const session = { runtimeKind: "codex" as const, externalSessionId: "session-1" };

const withStore = async (
  use: (input: {
    store: ReturnType<typeof createSqliteAgentSessionTurnStore>;
    removeWorkspace: () => Promise<void>;
    workspaceId: string;
  }) => Promise<void>,
) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "odt-session-turns-"));
  const repo = repoConfigFixture({ repoPath: path.join(root, "repo") });
  const manager = createSqliteHostDatabaseManager({
    configDir: root,
    taskWorkflows: builtinTaskWorkflows,
  });
  try {
    const config = createDefaultGlobalConfig();
    config.workspaces[repo.workspaceId] = repo;
    await Effect.runPromise(
      manager.withHostDatabase("test.initialize", (database) =>
        importHostDatabase({ session: database, configRoot: root, config }),
      ),
    );
    await use({
      store: createSqliteAgentSessionTurnStore(manager),
      workspaceId: repo.workspaceId,
      removeWorkspace: () =>
        Effect.runPromise(
          manager
            .withHostDatabase("test.removeWorkspace", (database) =>
              database.execute(
                (db) => db.delete(workspaces).where(eq(workspaces.workspaceId, repo.workspaceId)),
                "test.removeWorkspace",
              ),
            )
            .pipe(Effect.asVoid),
        ),
    });
  } finally {
    await Effect.runPromise(manager.dispose());
    await rm(root, { recursive: true, force: true });
  }
};

test("saves the start and end of each turn and lists them in start order", async () => {
  await withStore(async ({ store, workspaceId }) => {
    const model = {
      runtimeKind: "codex" as const,
      providerId: "openai",
      modelId: "gpt-5",
      variant: "low",
    };
    for (const [userMessageId, startedAt] of [
      ["message-2", "2026-11-22T10:00:01.000Z"],
      ["message-1", "2026-11-22T10:00:00.000Z"],
    ] as const) {
      await Effect.runPromise(
        store.recordTurnStart({
          ...session,
          workspaceId,
          userMessageId,
          userMessageHash: `hash-${userMessageId}`,
          startedAt,
          model,
        }),
      );
    }
    await Effect.runPromise(
      store.recordTurnEnd(
        { ...session, userMessageId: "message-2" },
        {
          completedAt: "2026-11-22T10:00:05.000Z",
          outcome: "interrupted",
          durationMs: 5000,
          interruption: { messageId: "stop-1", message: "Session stopped at your request." },
        },
      ),
    );

    expect(await Effect.runPromise(store.listTurns(session))).toEqual([
      {
        ...session,
        userMessageId: "message-1",
        userMessageHash: "hash-message-1",
        startedAt: "2026-11-22T10:00:00.000Z",
        model,
      },
      {
        ...session,
        userMessageId: "message-2",
        userMessageHash: "hash-message-2",
        startedAt: "2026-11-22T10:00:01.000Z",
        model,
        end: {
          completedAt: "2026-11-22T10:00:05.000Z",
          outcome: "interrupted",
          durationMs: 5000,
          interruption: { messageId: "stop-1", message: "Session stopped at your request." },
        },
      },
    ]);
  });
});

test("keeps the first start of a turn and drops the turns of a removed workspace", async () => {
  await withStore(async ({ store, workspaceId, removeWorkspace }) => {
    const start = {
      ...session,
      workspaceId,
      userMessageId: "message-1",
      startedAt: "2026-11-22T10:00:00.000Z",
    };
    await Effect.runPromise(store.recordTurnStart({ ...start, userMessageHash: "first" }));
    await Effect.runPromise(
      store.recordTurnStart({
        ...start,
        userMessageHash: "second",
        startedAt: "2026-11-22T10:00:09.000Z",
      }),
    );

    expect(await Effect.runPromise(store.listTurns(session))).toEqual([
      {
        ...session,
        userMessageId: "message-1",
        userMessageHash: "first",
        startedAt: "2026-11-22T10:00:00.000Z",
      },
    ]);

    await removeWorkspace();
    expect(await Effect.runPromise(store.listTurns(session))).toEqual([]);
  });
});
