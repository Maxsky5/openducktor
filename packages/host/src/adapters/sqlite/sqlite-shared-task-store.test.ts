import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { Deferred, Effect, Result } from "effect";
import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { createAgentSessionRecord } from "../../ports/task-store-port-contract.test-support";
import { createSqliteHostDatabaseManager } from "./sqlite-task-repository-context";
import { createSqliteTaskRepository } from "./sqlite-task-repository";
import { createSqliteIssueImportStore } from "./sqlite-issue-import-store";
import { createSqliteTaskAssetRegistry } from "./sqlite-task-asset-registry";
import { createSqliteWorkspaceSessionStore } from "./sqlite-workspace-session-store";
import { hostSettings, workspaces } from "./sqlite-host-settings-schema";
import { hostMetadata, tasks, taskAssets, taskIssueLinks } from "./sqlite-host-database-schema";
import { replaceTaskSessions } from "./sqlite-task-relations";
import { insertTaskIfAbsent } from "./sqlite-task-writes";
import { collectTaskStatusChanges } from "../../ports/task-status-changes";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const alpha = { workspaceId: "sameprefix-alpha", repoPath: "/repos/alpha" };
const beta = { workspaceId: "sameprefix-beta", repoPath: "/repos/beta" };
const createHarness = async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), "odt-shared-tasks-"));
  const managers = [0, 1].map(() =>
    createSqliteHostDatabaseManager({
      configDir,
      taskWorkflows: builtinTaskWorkflows,
    }),
  );
  const first = managers[0]!;
  const second = managers[1]!;
  cleanups.push(async () => {
    for (const manager of managers) await Effect.runPromise(manager.dispose());
    await rm(configDir, { recursive: true, force: true });
  });
  await Effect.runPromise(
    first.withHostDatabase("test.seed", (session) =>
      session.transaction("test.seed", (transaction) =>
        Effect.gen(function* () {
          yield* transaction.execute(
            (db) =>
              db.insert(hostSettings).values({
                singletonId: 1,
                hostId: "host",
                defaultMergeMethod: "merge_commit",
                removeWorktreeOnClose: true,
                alwaysStartQaReviewsFresh: false,
                remoteAccessEnabled: false,
              }),
            "test.host",
          );
          yield* transaction.execute(
            (db) =>
              db
                .insert(hostMetadata)
                .values({ singletonId: 1, importComplete: true, catalogRevision: 1 }),
            "test.metadata",
          );
          yield* transaction.execute(
            (db) =>
              db.insert(workspaces).values(
                [alpha, beta].map((scope) => ({
                  ...scope,
                  workspaceName: scope.workspaceId,
                  branchPrefix: "task",
                  defaultTargetBranch: "main",
                  closed: false,
                })),
              ),
            "test.workspaces",
          );
          yield* transaction.execute(
            (db) =>
              db.insert(tasks).values(
                [alpha, beta].map((scope) => ({
                  workspaceId: scope.workspaceId,
                  id: "same-task",
                  title: scope.workspaceId,
                  status: "open",
                  issueType: "task",
                  priority: 2,
                  createdAt: new Date(0),
                  updatedAt: new Date(0),
                })),
              ),
            "test.tasks",
          );
          for (const scope of [alpha, beta]) {
            yield* replaceTaskSessions(transaction, scope.workspaceId, "same-task", [
              createAgentSessionRecord({
                externalSessionId: "same-session",
                workingDirectory: scope.repoPath,
              }),
            ]);
            yield* transaction.execute(
              (db) =>
                db.insert(taskAssets).values({
                  workspaceId: scope.workspaceId,
                  taskId: "same-task",
                  id: "same-asset",
                  scope: "description",
                  originalName: scope.workspaceId,
                  mediaType: "image/png",
                  byteSize: 3,
                  createdAt: new Date(0),
                }),
              "test.assets",
            );
            yield* transaction.execute(
              (db) =>
                db.insert(taskIssueLinks).values({
                  workspaceId: scope.workspaceId,
                  taskId: "same-task",
                  providerId: "github",
                  providerScope: "acme/repo",
                  externalId: "issue",
                  displayNumber: "7",
                  url: "https://github.com/acme/repo/issues/7",
                }),
              "test.issue",
            );
          }
        }),
      ),
    ),
  );
  return {
    first,
    second,
    store: createSqliteTaskRepository({
      contextProvider: first.withDatabase,
    }),
    other: createSqliteTaskRepository({
      contextProvider: second.withDatabase,
    }),
  };
};
const decide = (status?: string) => (current: { status: string }) =>
  Result.succeed({
    status: status ?? current.status,
    workflowId: "openducktor-research-plan-implement",
  });

test("task reads and writes keep colliding workspace identities separate", async () => {
  const { first, store } = await createHarness();
  const scope = { ...alpha, taskId: "same-task" };
  const foreign = { ...beta, taskId: "same-task" };
  await Effect.runPromise(
    store.saveWorkflowArtifact({
      ...scope,
      code: "spec",
      markdown: "Alpha",
      sourceTool: "test",
      updatedBy: "user",
      decide: decide(),
    }),
  );
  for (let index = 0; index < 3; index++)
    await Effect.runPromise(
      store.saveWorkflowArtifact({
        ...foreign,
        code: "spec",
        markdown: `Beta ${index}`,
        sourceTool: "test",
        updatedBy: "user",
        decide: decide(),
      }),
    );
  expect((await Effect.runPromise(store.getTaskMetadata(scope))).artifacts.spec?.markdown).toBe(
    "Alpha",
  );
  expect((await Effect.runPromise(store.listArtifacts(scope)))[0]?.revision).toBe(1);
  expect((await Effect.runPromise(store.listTasks(alpha))).map((task) => task.title)).toEqual([
    alpha.workspaceId,
  ]);
  expect(
    (
      await Effect.runPromise(store.listAgentSessionsForTasks({ ...alpha, taskIds: ["same-task"] }))
    )[0]?.agentSessions[0]?.workingDirectory,
  ).toBe(alpha.repoPath);
  const assets = createSqliteTaskAssetRegistry({
    contextProvider: first.withDatabase,
  });
  expect(
    (
      await Effect.runPromise(
        assets.getAsset({ ...scope, scope: "description", assetId: "same-asset" }),
      )
    )?.originalName,
  ).toBe(alpha.workspaceId);
  const chats = createSqliteWorkspaceSessionStore({
    contextProvider: first.withDatabase,
    workspacesProvider: first.readWorkspaces,
  });
  expect(await Effect.runPromise(chats.listRuntimeOwners(alpha))).toHaveLength(1);
  const imported = createSqliteIssueImportStore({
    contextProvider: first.withDatabase,
  });
  await Effect.runPromise(
    imported.replaceSourceScope({
      ...alpha,
      providerId: "github",
      oldScope: "acme/repo",
      scope: "github.com/acme/repo",
      sourceIds: ["issue"],
    }),
  );
  expect((await Effect.runPromise(imported.getSourceIssue(scope)))?.scope).toBe(
    "github.com/acme/repo",
  );
  expect((await Effect.runPromise(imported.getSourceIssue(foreign)))?.scope).toBe("acme/repo");
  await Effect.runPromise(store.deleteTask(scope));
  expect(await Effect.runPromise(store.findTask(scope))).toBeNull();
  expect((await Effect.runPromise(store.getTaskMetadata(foreign))).artifacts.spec?.markdown).toBe(
    "Beta 2",
  );
  expect(
    (
      await Effect.runPromise(
        assets.getAsset({ ...foreign, scope: "description", assetId: "same-asset" }),
      )
    )?.originalName,
  ).toBe(beta.workspaceId);
});

test("two hosts merge separate fields and decide transitions from the locked current row", async () => {
  const { first, store, other } = await createHarness();
  const scope = { ...alpha, taskId: "same-task" };
  await Promise.all([
    Effect.runPromise(store.updateTask({ ...scope, patch: { title: "Saved title" } })),
    Effect.runPromise(other.updateTask({ ...scope, patch: { priority: 4 } })),
  ]);
  expect(await Effect.runPromise(store.getTask(scope))).toMatchObject({
    title: "Saved title",
    priority: 4,
  });
  const held = Deferred.makeUnsafe<void>();
  const release = Deferred.makeUnsafe<void>();
  const changing = Effect.runPromise(
    first.withHostDatabase("test.holdWrite", (session) =>
      session.transaction("test.holdWrite", (transaction) =>
        Effect.gen(function* () {
          yield* transaction.execute(
            (db) =>
              db
                .update(tasks)
                .set({ status: "spec_ready" })
                .where(and(eq(tasks.workspaceId, alpha.workspaceId), eq(tasks.id, scope.taskId))),
            "test.changeStatus",
          );
          yield* Deferred.succeed(held, undefined);
          yield* Deferred.await(release);
        }),
      ),
    ),
  );
  await Effect.runPromise(Deferred.await(held));
  let decidedStatus = "";
  const transitioning = Effect.runPromise(
    collectTaskStatusChanges(
      other.transitionTask({
        ...scope,
        decide: (current) => {
          decidedStatus = current.status;
          return Result.succeed({
            status: "ready_for_dev",
            workflowId: "openducktor-research-plan-implement",
            cause: { signal: "plan_ready" },
          });
        },
      }),
    ),
  );
  await Effect.runPromise(Deferred.succeed(release, undefined));
  await changing;
  const captured = await transitioning;
  expect(decidedStatus).toBe("spec_ready");
  expect(captured.result._tag).toBe("Success");
  expect(captured.statusChanges).toMatchObject([
    { previousStatus: "spec_ready", task: { status: "ready_for_dev" } },
  ]);
  const before = await Effect.runPromise(other.getTask(scope));
  const noChange = await Effect.runPromise(
    collectTaskStatusChanges(other.transitionTask({ ...scope, decide: decide() })),
  );
  expect(noChange.result).toEqual(Result.succeed(before));
  expect(noChange.statusChanges).toEqual([]);
});

test("a new task ID that another workspace uses is not available", async () => {
  const { first } = await createHarness();
  const inserted = await Effect.runPromise(
    first.withHostDatabase("test.insert", (session) =>
      session.transaction("test.insert", (transaction) =>
        Effect.gen(function* () {
          const task = (workspaceId: string, title: string) => ({
            workspaceId,
            id: "beta-only",
            title,
            status: "open",
            issueType: "task",
            priority: 2,
            createdAt: new Date(0),
            updatedAt: new Date(0),
          });
          const betaInserted = yield* insertTaskIfAbsent(
            transaction,
            beta.workspaceId,
            task(beta.workspaceId, "Beta"),
          );
          const alphaInserted = yield* insertTaskIfAbsent(
            transaction,
            alpha.workspaceId,
            task(alpha.workspaceId, "Alpha"),
          );
          const owners = yield* transaction.execute(
            (db) =>
              db
                .select({ workspaceId: tasks.workspaceId })
                .from(tasks)
                .where(eq(tasks.id, "beta-only")),
            "test.owners",
          );
          return { beta: betaInserted, alpha: alphaInserted, owners };
        }),
      ),
    ),
  );
  expect(inserted).toEqual({
    beta: true,
    alpha: false,
    owners: [{ workspaceId: beta.workspaceId }],
  });
});
