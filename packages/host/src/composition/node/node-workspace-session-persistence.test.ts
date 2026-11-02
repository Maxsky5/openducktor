import { expect, test } from "bun:test";
import type { AgentSessionLiveEnvelope, AgentSessionLiveRef } from "@openducktor/contracts";
import { Effect, Result } from "effect";
import { createSqliteTaskRepository } from "../../adapters/sqlite/sqlite-task-repository";
import { createSqliteHostDatabaseManager } from "../../adapters/sqlite/sqlite-task-repository-context";
import { replaceTaskSessions } from "../../adapters/sqlite/sqlite-task-relations";
import { tasks, workspaces } from "../../adapters/sqlite/sqlite-host-database-schema";
import {
  createSqliteTaskStoreHarness,
  openHostDatabaseTestConnection,
} from "../../adapters/sqlite/sqlite-task-store-test-support";
import { createSqliteWorkspaceSessionStore } from "../../adapters/sqlite/sqlite-workspace-session-store";
import { createHostEventBus } from "../../events/host-event-bus";
import { createAgentSessionRecord } from "../../ports/task-store-port-contract-fixtures";
import { createGitPortTestDouble } from "../../test-support/service-test-doubles";
import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import {
  workspaceSessionCatalog,
  workspaceSessionOwnership,
} from "../../test-support/workspace-session-ownership";
import { createNodeWorkspaceSessionPersistence } from "./node-workspace-session-persistence";

test("activity still saves after another host closes the running session's task", async () => {
  const fixture = await createHarness();
  const { database, session, ref, records, observe } = fixture;
  const secondHost = createSqliteHostDatabaseManager({
    configDir: database.configDir,
    taskWorkflows: builtinTaskWorkflows,
    openConnection: openHostDatabaseTestConnection,
  });
  const secondStore = createSqliteTaskRepository({
    contextProvider: secondHost.withDatabase,
    now: () => new Date("2026-06-10T10:02:00.000Z"),
  });
  try {
    const task = await Effect.runPromise(
      database.store.createTask({
        ...database.scope,
        status: "open",
        task: { title: "Running session", issueType: "task", priority: 2 },
      }),
    );
    await Effect.runPromise(
      database.store.upsertAgentSession({
        ...database.scope,
        taskId: task.id,
        session,
        ownershipScope: workspaceSessionOwnership(database.scope),
      }),
    );
    const firstAt = Date.parse("2026-06-10T10:01:00.000Z");
    await observe(firstAt);
    expect(
      await Effect.runPromise(
        database.store.listAgentSessionsForTasks({
          ...database.scope,
          taskIds: [task.id],
        }),
      ),
    ).toEqual([{ taskId: task.id, agentSessions: [{ ...session, lastActivityAt: firstAt }] }]);
    expect(records).toEqual([
      {
        type: "task_session_records_updated",
        ...database.scope,
        taskId: task.id,
        agentSessions: [{ ...session, lastActivityAt: firstAt }],
      },
    ]);

    await Effect.runPromise(
      secondStore.transitionTask({
        ...database.scope,
        taskId: task.id,
        decide: () => Result.succeed({ status: "closed", workflowId: "openducktor" }),
      }),
    );
    const closed = await Effect.runPromise(
      secondStore.getTask({ ...database.scope, taskId: task.id }),
    );
    const laterAt = Date.parse("2026-06-10T10:03:00.000Z");
    await observe(laterAt);
    expect(
      await Effect.runPromise(
        secondStore.listAgentSessionsForTasks({
          ...database.scope,
          taskIds: [task.id],
        }),
      ),
    ).toEqual([{ taskId: task.id, agentSessions: [{ ...session, lastActivityAt: laterAt }] }]);
    expect(records).toEqual([
      expect.objectContaining({ agentSessions: [{ ...session, lastActivityAt: firstAt }] }),
      {
        type: "task_session_records_updated",
        ...database.scope,
        taskId: task.id,
        agentSessions: [{ ...session, lastActivityAt: laterAt }],
      },
    ]);
    await observe(laterAt);
    await observe(firstAt);
    await observe(laterAt + 1, { ...ref, externalSessionId: "not-saved" });
    await observe(laterAt + 2, ref, "baseline");
    expect(records).toHaveLength(2);
    expect(
      await Effect.runPromise(
        secondStore.listAgentSessionsForTasks({ ...database.scope, taskIds: [task.id] }),
      ),
    ).toEqual([{ taskId: task.id, agentSessions: [{ ...session, lastActivityAt: laterAt }] }]);
    expect(
      await Effect.runPromise(database.store.getTask({ ...database.scope, taskId: task.id })),
    ).toEqual(closed);
  } finally {
    await Effect.runPromise(secondHost.dispose());
    await fixture.cleanup();
  }
});

test("activity updates each matching saved association", async () => {
  const fixture = await createHarness();
  const { database, catalog, records, session, ref, observe } = fixture;
  const scopes = [
    database.scope,
    { ...database.scope, workspaceId: "same-repo" },
    { ...database.scope, workspaceId: "different-directory" },
    { workspaceId: "other-repo", repoPath: "/repos/Other" },
    { ...database.scope, workspaceId: "not-open" },
  ];
  const taskId = "same-task";
  try {
    // Existing databases can contain several saved associations for one physical session.
    await Effect.runPromise(
      database.withHostDatabase("test.seedAssociations", (connection) =>
        connection.transaction("test.seedAssociations", (transaction) =>
          Effect.gen(function* () {
            yield* transaction.execute(
              (db) =>
                db.insert(workspaces).values(
                  scopes.slice(1).map((scope) => ({
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
                  scopes.map((scope) => ({
                    workspaceId: scope.workspaceId,
                    id: taskId,
                    title: "Saved association",
                    status: "open",
                    issueType: "task",
                    priority: 2,
                    createdAt: new Date(0),
                    updatedAt: new Date(0),
                  })),
                ),
              "test.tasks",
            );
            for (const scope of scopes) {
              yield* replaceTaskSessions(transaction, scope.workspaceId, taskId, [
                {
                  ...session,
                  workingDirectory:
                    scope.workspaceId === "different-directory"
                      ? "/elsewhere"
                      : session.workingDirectory,
                },
              ]);
            }
          }),
        ),
      ),
    );
    for (const scope of scopes.slice(1, 4))
      catalog.openWorkspaces.push(...workspaceSessionCatalog(scope).openWorkspaces);
    const alias = {
      ...ref,
      repoPath: `${ref.repoPath}/`,
      workingDirectory: `${ref.workingDirectory}/`,
    };
    const firstAt = Date.parse("2026-06-10T10:01:00.000Z");
    await observe(firstAt, alias);
    const laterAt = Date.parse("2026-06-10T10:02:00.000Z");
    await observe(laterAt, alias);
    expect(records).toEqual(
      [firstAt, laterAt].flatMap((at) =>
        scopes.slice(0, 2).map((scope) => ({
          type: "task_session_records_updated",
          repoPath: alias.repoPath,
          workspaceId: scope.workspaceId,
          taskId,
          agentSessions: [{ ...session, lastActivityAt: at }],
        })),
      ),
    );
    for (const [index, scope] of scopes.entries()) {
      const expected = {
        ...session,
        workingDirectory:
          scope.workspaceId === "different-directory" ? "/elsewhere" : session.workingDirectory,
      };
      if (index < 2) expected.lastActivityAt = laterAt;
      expect(
        await Effect.runPromise(
          database.store.listAgentSessionsForTasks({ ...scope, taskIds: [taskId] }),
        ),
      ).toEqual([{ taskId, agentSessions: [expected] }]);
    }
    await observe(laterAt + 1, { ...alias, externalSessionId: "no-saved-owner" });
    expect(records).toHaveLength(4);
  } finally {
    await fixture.cleanup();
  }
});

const createHarness = async () => {
  const database = await createSqliteTaskStoreHarness();
  const catalog = workspaceSessionCatalog(database.scope);
  const records: Extract<AgentSessionLiveEnvelope, { type: "task_session_records_updated" }>[] = [];
  const eventBus = createHostEventBus({
    report: (failure) => {
      throw failure.cause;
    },
  });
  const unsubscribe = eventBus.subscribe("openducktor://agent-session-live-event", (envelope) => {
    if (
      envelope.channel === "openducktor://agent-session-live-event" &&
      envelope.payload.type === "task_session_records_updated"
    )
      records.push(envelope.payload);
  });
  const { persistence } = createNodeWorkspaceSessionPersistence({
    taskStore: database.store,
    store: createSqliteWorkspaceSessionStore(database),
    settings: { getWorkspaceCatalog: () => Effect.succeed(catalog) },
    git: createGitPortTestDouble({}),
    eventBus,
    faultLog: () => Effect.void,
    updateRuntimeSessionTitle: () => Effect.succeed({ status: "renamed" }),
  });
  const session = createAgentSessionRecord({
    externalSessionId: "running-session",
    workingDirectory: `${database.repoPath}/worktree`,
  });
  const ref: AgentSessionLiveRef = { ...session, repoPath: database.repoPath };
  const observe = (at: number, identity = ref, provenance: "baseline" | "live" = "live") =>
    Effect.runPromise(
      persistence.observe(
        {
          type: "transcript_event",
          event: {
            type: "session_error",
            externalSessionId: identity.externalSessionId,
            sessionRef: identity,
            timestamp: new Date(at).toISOString(),
            message: "Runtime error",
          },
        },
        provenance,
      ),
    );
  return {
    database,
    catalog,
    records,
    session,
    ref,
    observe,
    cleanup: async () => {
      unsubscribe();
      await Effect.runPromise(persistence.shutdown());
      await database.cleanup();
    },
  };
};
