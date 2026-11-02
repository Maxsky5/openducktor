import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { HostValidationError } from "../../effect/host-errors";
import {
  createSqliteHostDatabaseManager,
  type SqliteWorkspacesReadProvider,
} from "./sqlite-task-repository-context";
import { createSqliteTaskOwnershipReader } from "./sqlite-workspace-ownership-reads";
import { createSqliteWorkspaceSessionStore } from "./sqlite-workspace-session-store";
import { encodeWorkspaceSessionRecord } from "./sqlite-workspace-session-reads";
import { workspaceSessions } from "./sqlite-workspace-session-schema";
import { taskSessions } from "./sqlite-host-database-schema";
import { workspaces, workspaceRemovals } from "./sqlite-host-settings-schema";
import { tasks, taskAssets, taskArtifacts } from "./sqlite-host-database-schema";

const temporaryDirectories = new Set<string>();
const workspace = (workspaceId: string, repoPath = `/repos/${workspaceId}`) => ({
  workspaceId,
  workspaceName: workspaceId,
  repoPath,
  branchPrefix: "task",
  defaultTargetBranch: "main",
  closed: false,
});
const task = (workspaceId: string) => ({
  workspaceId,
  id: "same-task",
  title: workspaceId,
  status: "open",
  issueType: "task",
  priority: 2,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});
const createHarness = async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), "odt-host-database-"));
  temporaryDirectories.add(configDir);
  const manager = createSqliteHostDatabaseManager({
    configDir,
    taskWorkflows: builtinTaskWorkflows,
  });
  await Effect.runPromise(
    manager.withHostDatabase("test.seed", (session) =>
      session.execute(
        (db) => db.insert(workspaces).values([workspace("alpha"), workspace("beta")]),
        "test.seed",
      ),
    ),
  );
  return manager;
};
afterEach(async () => {
  await Promise.all(
    [...temporaryDirectories].map((directory) => rm(directory, { force: true, recursive: true })),
  );
  temporaryDirectories.clear();
});

test("nested repository operations share one cross-workspace transaction", async () => {
  const manager = await createHarness();
  try {
    const result = await Effect.runPromise(
      Effect.result(
        manager.withHostDatabase("test.outer", (session) =>
          session.transaction("test.outer", () =>
            Effect.gen(function* () {
              yield* manager.withDatabase(
                { workspaceId: "alpha", repoPath: "/repos/alpha" },
                "test.alpha",
                ({ session }) =>
                  session.transaction("test.alpha", (transaction) =>
                    transaction.execute(
                      (db) => db.insert(tasks).values(task("alpha")),
                      "test.insert",
                    ),
                  ),
              );
              yield* manager.withDatabase(
                { workspaceId: "beta", repoPath: "/repos/beta" },
                "test.beta",
                ({ session }) =>
                  session.transaction("test.beta", (transaction) =>
                    transaction.execute(
                      (db) => db.insert(tasks).values(task("beta")),
                      "test.insert",
                    ),
                  ),
              );
              return yield* Effect.fail("reject both");
            }),
          ),
        ),
      ),
    );
    expect(result._tag).toBe("Failure");
    const saved = await Effect.runPromise(
      manager.withHostDatabase("test.read", (session) =>
        session.execute((db) => db.select().from(tasks), "test.read"),
      ),
    );
    expect(saved).toEqual([]);
  } finally {
    await Effect.runPromise(manager.dispose());
  }
});

test("current registration and lifecycle reject stale workspace access", async () => {
  const manager = await createHarness();
  try {
    await Effect.runPromise(
      manager.withHostDatabase("test.close", (session) =>
        session.execute(
          (db) =>
            db.update(workspaces).set({ closed: true }).where(eq(workspaces.workspaceId, "alpha")),
          "test.close",
        ),
      ),
    );
    const closed = await Effect.runPromise(
      Effect.result(
        manager.withDatabase(
          { workspaceId: "alpha", repoPath: "/repos/alpha" },
          "test.closed",
          () => Effect.void,
        ),
      ),
    );
    expect(closed._tag).toBe("Failure");
    const administrative = await Effect.runPromise(
      manager.withDatabase(
        { workspaceId: "alpha", repoPath: "/repos/alpha", access: "administrative" },
        "test.admin",
        ({ workspaceId }) => Effect.succeed(workspaceId),
      ),
    );
    expect(administrative).toBe("alpha");
    await Effect.runPromise(
      manager.withHostDatabase("test.replace", (session) =>
        session.transaction("test.replace", (transaction) =>
          Effect.gen(function* () {
            yield* transaction.execute(
              (db) => db.delete(workspaces).where(eq(workspaces.workspaceId, "alpha")),
              "test.delete",
            );
            yield* transaction.execute(
              (db) => db.insert(workspaces).values(workspace("replacement", "/repos/alpha")),
              "test.replace",
            );
          }),
        ),
      ),
    );
    const stale = await Effect.runPromise(
      Effect.result(
        manager.withDatabase(
          { workspaceId: "alpha", repoPath: "/repos/alpha" },
          "test.stale",
          () => Effect.void,
        ),
      ),
    );
    expect(stale._tag).toBe("Failure");
  } finally {
    await Effect.runPromise(manager.dispose());
  }
});

test("a write transaction rejects a workspace that another connection closed", async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), "odt-host-database-"));
  temporaryDirectories.add(configDir);
  const createManager = () =>
    createSqliteHostDatabaseManager({ configDir, taskWorkflows: builtinTaskWorkflows });
  const manager = createManager();
  const other = createManager();
  try {
    await Effect.runPromise(
      manager.withHostDatabase("test.seed", (session) =>
        session.execute((db) => db.insert(workspaces).values(workspace("alpha")), "test.seed"),
      ),
    );
    const closeAlpha = other.withHostDatabase("test.close", (session) =>
      session.execute(
        (db) =>
          db.update(workspaces).set({ closed: true }).where(eq(workspaces.workspaceId, "alpha")),
        "test.close",
      ),
    );
    const failure = await Effect.runPromise(
      manager
        .withDatabase(
          { workspaceId: "alpha", repoPath: "/repos/alpha" },
          "test.write",
          ({ session }) =>
            Effect.promise(() => Effect.runPromise(closeAlpha)).pipe(
              Effect.andThen(session.transaction("test.write", () => Effect.void)),
            ),
        )
        .pipe(Effect.flip),
    );
    expect(failure).toBeInstanceOf(HostValidationError);
    expect(failure.message).toContain("Workspace is closed: alpha");
  } finally {
    await Effect.runPromise(manager.dispose());
    await Effect.runPromise(other.dispose());
  }
});

test("cleanup claims retain closed tasks in a closed workspace with incomplete removal", async () => {
  const manager = await createHarness();
  const scope = { workspaceId: "alpha", repoPath: "/repos/alpha" };
  try {
    await Effect.runPromise(
      manager.withHostDatabase("test.removalClaims", (session) =>
        session.transaction("test.removalClaims", (transaction) =>
          Effect.gen(function* () {
            yield* transaction.execute(
              (db) => db.insert(tasks).values({ ...task("alpha"), status: "closed" }),
              "test.closedTask",
            );
            yield* transaction.execute(
              (db) =>
                db
                  .update(workspaces)
                  .set({ closed: true })
                  .where(eq(workspaces.workspaceId, "alpha")),
              "test.closedWorkspace",
            );
            yield* transaction.execute(
              (db) =>
                db
                  .insert(workspaceRemovals)
                  .values({ workspaceId: "alpha", removeTaskWorktrees: true, phase: "worktrees" }),
              "test.removal",
            );
          }),
        ),
      ),
    );
    const ownership = createSqliteTaskOwnershipReader(manager.readWorkspaces);
    expect(
      await Effect.runPromise(
        ownership.listTaskDirectoriesForWorktreeOwnership({ workspaces: [scope] }),
      ),
    ).toEqual([
      { workspaceId: "alpha", taskId: "same-task", title: "alpha", sessionDirectories: [] },
    ]);
    await expect(
      Effect.runPromise(ownership.listOpenTasksForWorktreeOwnership({ workspaces: [scope] })),
    ).rejects.toThrow("removal is incomplete");
    await expect(
      Effect.runPromise(
        ownership.listTaskDirectoriesForWorktreeOwnership({
          workspaces: [{ ...scope, repoPath: "/replacement" }],
        }),
      ),
    ).rejects.toThrow("no longer matches");
  } finally {
    await Effect.runPromise(manager.dispose());
  }
});

test("full workspace identity selects one of the workspaces at the same path", async () => {
  const manager = await createHarness();
  try {
    await Effect.runPromise(
      manager.withHostDatabase("test.duplicate", (session) =>
        session.execute(
          (db) => db.insert(workspaces).values(workspace("duplicate", "/repos/alpha")),
          "test.duplicate",
        ),
      ),
    );
    const explicit = await Effect.runPromise(
      manager.withDatabase(
        { workspaceId: "alpha", repoPath: "/repos/alpha" },
        "test.explicit",
        ({ workspaceId }) => Effect.succeed(workspaceId),
      ),
    );
    expect(explicit).toBe("alpha");
  } finally {
    await Effect.runPromise(manager.dispose());
  }
});

test("workspace cascades preserve identical task artifact and asset IDs elsewhere", async () => {
  const manager = await createHarness();
  try {
    await Effect.runPromise(
      manager.withHostDatabase("test.rows", (session) =>
        session.transaction("test.rows", (transaction) =>
          Effect.gen(function* () {
            yield* transaction.execute(
              (db) => db.insert(tasks).values([task("alpha"), task("beta")]),
              "test.tasks",
            );
            for (const workspaceId of ["alpha", "beta"]) {
              yield* transaction.execute(
                (db) =>
                  db.insert(taskAssets).values({
                    workspaceId,
                    id: "same-asset",
                    taskId: "same-task",
                    scope: "description",
                    originalName: "image.png",
                    mediaType: "image/png",
                    byteSize: 0,
                    createdAt: new Date(0),
                  }),
                "test.assets",
              );
              yield* transaction.execute(
                (db) =>
                  db.insert(taskArtifacts).values({
                    workspaceId,
                    taskId: "same-task",
                    artifactId: "workflow:same-task:spec",
                    classification: "workflow",
                    code: "spec",
                    revision: 1,
                    name: "Spec",
                    markdown: workspaceId,
                    format: "plain_text",
                  }),
                "test.artifacts",
              );
            }
            yield* transaction.execute(
              (db) => db.delete(workspaces).where(eq(workspaces.workspaceId, "beta")),
              "test.remove",
            );
          }),
        ),
      ),
    );
    const result = await Effect.runPromise(
      manager.withHostDatabase("test.read", (session) =>
        Effect.all({
          tasks: session.execute((db) => db.select().from(tasks), "test.tasks"),
          assets: session.execute((db) => db.select().from(taskAssets), "test.assets"),
          artifacts: session.execute((db) => db.select().from(taskArtifacts), "test.artifacts"),
        }),
      ),
    );
    expect(result.tasks.map((row) => row.workspaceId)).toEqual(["alpha"]);
    expect(result.assets.map((row) => row.workspaceId)).toEqual(["alpha"]);
    expect(result.artifacts.map((row) => row.markdown)).toEqual(["alpha"]);
  } finally {
    await Effect.runPromise(manager.dispose());
  }
});

test("workspace access applies one lifecycle policy in the operation transaction", async () => {
  const manager = await createHarness();
  const alpha = { workspaceId: "alpha", repoPath: "/repos/alpha" };
  const beta = { workspaceId: "beta", repoPath: "/repos/beta" };
  const read = (scopes: Parameters<SqliteWorkspacesReadProvider>[0]) =>
    Effect.runPromise(manager.readWorkspaces(scopes, "test.read", () => Effect.succeed("read")));
  try {
    await Effect.runPromise(
      manager.withHostDatabase("test.lifecycle", (session) =>
        session.transaction("test.lifecycle", (transaction) =>
          Effect.gen(function* () {
            yield* transaction.execute(
              (db) =>
                db
                  .update(workspaces)
                  .set({ closed: true })
                  .where(eq(workspaces.workspaceId, "alpha")),
              "test.close",
            );
            yield* transaction.execute(
              (db) =>
                db
                  .insert(workspaceRemovals)
                  .values({ workspaceId: "beta", removeTaskWorktrees: false, phase: "worktrees" }),
              "test.removal",
            );
          }),
        ),
      ),
    );
    await expect(read([{ ...alpha, access: "open" }])).rejects.toThrow(
      "Workspace is closed: alpha",
    );
    expect(await read([{ ...alpha, access: "ownership" }])).toBe("read");
    await expect(
      read([
        { ...alpha, access: "ownership" },
        { ...beta, access: "ownership" },
      ]),
    ).rejects.toThrow("Workspace removal is incomplete for beta");
    expect(
      await read([
        { ...alpha, access: "ownership" },
        { ...beta, access: "administrative" },
      ]),
    ).toBe("read");
    await expect(
      read([{ ...beta, repoPath: "/repos/alpha", access: "administrative" }]),
    ).rejects.toThrow("no longer matches");
  } finally {
    await Effect.runPromise(manager.dispose());
  }
});

test("cross-workspace ownership reads keep same-path workspaces and same task IDs apart with a fixed query count", async () => {
  const manager = await createHarness();
  // Both workspaces register one repository path and use the same task and chat IDs.
  const alpha = { workspaceId: "alpha", repoPath: "/repos/alpha" };
  const twin = { workspaceId: "twin", repoPath: "/repos/alpha" };
  const chat = (externalSessionId: string) => ({
    id: "same-chat",
    runtimeKind: "codex" as const,
    externalSessionId,
    executionTarget: {
      kind: "local_repo_root" as const,
      workingDirectory: `/trees/${externalSessionId}`,
    },
    roleSnapshot: null,
    selectedModel: null,
    generatedTitle: null,
    manualTitle: externalSessionId,
    targetBranch: null,
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
  });
  const taskSession = (workspaceId: string) => ({
    workspaceId,
    taskId: "same-task",
    position: 0,
    externalSessionId: `${workspaceId}-task`,
    role: "build",
    startedAt: 0,
    runtimeKind: "codex",
    workingDirectory: `/trees/${workspaceId}-task`,
  });
  try {
    await Effect.runPromise(
      manager.withHostDatabase("test.seedTwins", (session) =>
        session.transaction("test.seedTwins", (transaction) =>
          Effect.gen(function* () {
            yield* transaction.execute(
              (db) => db.insert(workspaces).values(workspace("twin", "/repos/alpha")),
              "test.twin",
            );
            yield* transaction.execute(
              (db) => db.insert(tasks).values([task("alpha"), task("twin"), task("beta")]),
              "test.tasks",
            );
            yield* transaction.execute(
              (db) =>
                db
                  .insert(taskSessions)
                  .values([taskSession("alpha"), taskSession("twin"), taskSession("beta")]),
              "test.taskSessions",
            );
            yield* transaction.execute(
              (db) =>
                db
                  .insert(workspaceSessions)
                  .values([
                    encodeWorkspaceSessionRecord("alpha", chat("alpha-chat")),
                    encodeWorkspaceSessionRecord("twin", chat("twin-chat")),
                    encodeWorkspaceSessionRecord("beta", chat("beta-chat")),
                  ]),
              "test.chats",
            );
          }),
        ),
      ),
    );
    let queries = 0;
    const counted: SqliteWorkspacesReadProvider = (scopes, operation, use) =>
      manager.readWorkspaces(scopes, operation, (context) =>
        use({
          ...context,
          session: {
            ...context.session,
            execute: (run, name, details) => {
              queries += 1;
              return context.session.execute(run, name, details);
            },
          },
        }),
      );
    const store = createSqliteWorkspaceSessionStore({
      contextProvider: manager.withDatabase,
      workspacesProvider: counted,
    });
    const ownership = createSqliteTaskOwnershipReader(counted);
    const both = { workspaces: [alpha, twin] };

    const roots = await Effect.runPromise(store.listLiveSessionRoots(both));
    expect(
      roots
        .map(({ sessionScope, externalSessionId }) => [
          sessionScope.kind,
          sessionScope.workspaceId,
          externalSessionId,
        ])
        .sort(),
    ).toEqual([
      ["repository", "alpha", "alpha-chat"],
      ["repository", "twin", "twin-chat"],
      ["workflow", "alpha", "alpha-task"],
      ["workflow", "twin", "twin-task"],
    ]);
    expect(queries).toBe(2);

    queries = 0;
    const chats = await Effect.runPromise(store.listForWorktreeOwnership(both));
    expect(
      chats.map(({ workspaceId, externalSessionId }) => [workspaceId, externalSessionId]).sort(),
    ).toEqual([
      ["alpha", "alpha-chat"],
      ["twin", "twin-chat"],
    ]);
    expect(await Effect.runPromise(ownership.listOpenTasksForWorktreeOwnership(both))).toEqual([
      {
        workspaceId: "alpha",
        taskId: "same-task",
        title: "alpha",
        sessionDirectories: ["/trees/alpha-task"],
      },
      {
        workspaceId: "twin",
        taskId: "same-task",
        title: "twin",
        sessionDirectories: ["/trees/twin-task"],
      },
    ]);
    expect(queries).toBe(2);

    queries = 0;
    expect(
      (
        await Effect.runPromise(
          store.findByRuntimeSession({
            ...both,
            runtimeKind: "codex",
            externalSessionId: "twin-chat",
          }),
        )
      ).map(({ workspaceId, session }) => [workspaceId, session.id]),
    ).toEqual([["twin", "same-chat"]]);
    expect(queries).toBe(1);
    expect(await Effect.runPromise(store.listLiveSessionRoots({ workspaces: [twin] }))).toEqual([
      expect.objectContaining({
        sessionScope: { kind: "repository", workspaceId: "twin" },
        externalSessionId: "twin-chat",
      }),
      expect.objectContaining({
        sessionScope: expect.objectContaining({ kind: "workflow", workspaceId: "twin" }),
        externalSessionId: "twin-task",
      }),
    ]);
  } finally {
    await Effect.runPromise(manager.dispose());
  }
});
