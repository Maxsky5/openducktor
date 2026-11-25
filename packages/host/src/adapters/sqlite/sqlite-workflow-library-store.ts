import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { TaskWorkflowVersionCache } from "../../ports/task-workflow-port";
import type {
  WorkflowLibraryStorePort,
  WorkflowLibraryTransaction,
  WorkflowLibraryWrites,
} from "../../ports/workflow-library-store-port";
import { globalPromptAppends, globalPromptOverrides } from "./sqlite-global-prompt-schema";
import { type HostDatabaseSession, tasks } from "./sqlite-host-database-schema";
import {
  autopilotRules,
  hostSettings,
  workspacePromptAppends,
  workspacePromptOverrides,
  workspaceRoleDefaults,
} from "./sqlite-host-settings-schema";
import { agentRuntimeSettings } from "./sqlite-runtime-settings-schema";
import type { SqliteHostDatabaseProvider } from "./sqlite-task-repository-context";
import { mapSqliteTaskStoreAdapterError } from "./sqlite-task-store-errors";
import { createWorkflowLibraryReads } from "./sqlite-workflow-library-reads";
import {
  workflowAvailability,
  workflowAvailabilityWorkspaces,
  workflowDrafts,
  workflowRoles,
  workflowVersions,
  workflows,
} from "./sqlite-workflow-library-schema";

export {
  isLatestVersion,
  readCustomRoles,
  readAvailability,
  readDefaultWorkflowId,
  storedVersionOf,
} from "./sqlite-workflow-library-reads";

const deleteOwnerSettings = (
  session: HostDatabaseSession,
  ownerKind: "role" | "workflow",
  ownerId: string,
  operation: string,
) =>
  Effect.gen(function* () {
    for (const table of [
      globalPromptOverrides,
      globalPromptAppends,
      workspacePromptOverrides,
      workspacePromptAppends,
    ])
      yield* session.execute(
        (db) =>
          db.delete(table).where(and(eq(table.ownerKind, ownerKind), eq(table.ownerId, ownerId))),
        operation,
      );
  });

/** Deletes the availability rule of a workflow. Its listed workspaces go with it. */
const deleteAvailability = (session: HostDatabaseSession, workflowId: string, operation: string) =>
  session.execute(
    (db) => db.delete(workflowAvailability).where(eq(workflowAvailability.workflowId, workflowId)),
    operation,
  );

/** Deletes the availability, the prompt settings, and the Autopilot rules of a workflow. */
const deleteWorkflowSettings = (
  session: HostDatabaseSession,
  workflowId: string,
  operation: string,
) =>
  Effect.gen(function* () {
    yield* deleteAvailability(session, workflowId, operation);
    yield* deleteOwnerSettings(session, "workflow", workflowId, operation);
    yield* session.execute(
      (db) => db.delete(autopilotRules).where(eq(autopilotRules.workflowId, workflowId)),
      operation,
    );
  });

/** Removes the overrides of the role from each stored runtime policy, as a JSON merge patch. */
const deleteRuntimeRoleOverrides = (session: HostDatabaseSession, roleId: string) =>
  session.execute(
    (db) =>
      db
        .update(agentRuntimeSettings)
        .set({
          policyJson: sql`json_patch(${agentRuntimeSettings.policyJson}, json_object('roleOverrides', json_object(${roleId}, json('null'))))`,
        })
        .where(
          sql`exists (select 1 from json_each(${agentRuntimeSettings.policyJson}, '$.roleOverrides') where key = ${roleId})`,
        ),
    "workflowLibrary.deleteRole.runtimeOverrides",
  );

/**
 * A write role cannot keep a read-only Codex sandbox, so a saved write role loses that override,
 * as a JSON merge patch. Otherwise each later settings read would fail on the override.
 */
const clearReadOnlyCodexSandbox = (session: HostDatabaseSession, roleId: string) =>
  session.execute(
    (db) =>
      db
        .update(agentRuntimeSettings)
        .set({
          policyJson: sql`json_patch(${agentRuntimeSettings.policyJson}, json_object('roleOverrides', json_object(${roleId}, json_object('sandboxMode', json('null')))))`,
        })
        .where(
          and(
            eq(agentRuntimeSettings.runtimeKind, "codex"),
            sql`exists (select 1 from json_each(${agentRuntimeSettings.policyJson}, '$.roleOverrides') where key = ${roleId} and json_extract(value, '$.sandboxMode') = 'read-only')`,
          ),
        ),
    "workflowLibrary.saveRole.codexSandbox",
  );

const createWrites = (
  session: HostDatabaseSession,
  cache: TaskWorkflowVersionCache,
): WorkflowLibraryWrites => ({
  createWorkflow: ({ workflowId, nowMs, document }) =>
    Effect.gen(function* () {
      yield* session.execute(
        (db) => db.insert(workflows).values({ workflowId, createdAtMs: nowMs }),
        "workflowLibrary.createWorkflow",
      );
      yield* session.execute(
        (db) =>
          db
            .insert(workflowDrafts)
            .values({ workflowId, updatedAtMs: nowMs, documentJson: JSON.stringify(document) }),
        "workflowLibrary.createWorkflow.draft",
      );
    }),
  saveDraft: ({ workflowId, nowMs, document }) =>
    session.execute(
      (db) =>
        db
          .insert(workflowDrafts)
          .values({ workflowId, updatedAtMs: nowMs, documentJson: JSON.stringify(document) })
          .onConflictDoUpdate({
            target: workflowDrafts.workflowId,
            set: { updatedAtMs: nowMs, documentJson: JSON.stringify(document) },
          }),
      "workflowLibrary.saveDraft",
    ),
  deleteDraft: (workflowId) =>
    session.execute(
      (db) => db.delete(workflowDrafts).where(eq(workflowDrafts.workflowId, workflowId)),
      "workflowLibrary.deleteDraft",
    ),
  renameWorkflow: ({ from, to }) =>
    Effect.gen(function* () {
      const operation = "workflowLibrary.renameWorkflow";
      yield* session.execute(
        (db) => db.update(workflows).set({ workflowId: to }).where(eq(workflows.workflowId, from)),
        operation,
      );
      // The availability rule has no foreign key to the workflow, so the rename moves it here.
      const [rule] = yield* session.execute(
        (db) =>
          db
            .select({ mode: workflowAvailability.mode })
            .from(workflowAvailability)
            .where(eq(workflowAvailability.workflowId, from)),
        operation,
      );
      if (!rule) return;
      yield* session.execute(
        (db) => db.insert(workflowAvailability).values({ workflowId: to, mode: rule.mode }),
        operation,
      );
      yield* session.execute(
        (db) =>
          db
            .update(workflowAvailabilityWorkspaces)
            .set({ workflowId: to })
            .where(eq(workflowAvailabilityWorkspaces.workflowId, from)),
        operation,
      );
      yield* session.execute(
        (db) => db.delete(workflowAvailability).where(eq(workflowAvailability.workflowId, from)),
        operation,
      );
    }),
  insertVersion: ({ workflowId, version, nowMs, document }) =>
    session.execute(
      (db) =>
        db.insert(workflowVersions).values({
          workflowId,
          version,
          publishedAtMs: nowMs,
          documentJson: JSON.stringify(document),
        }),
      "workflowLibrary.insertVersion",
    ),
  deleteWorkflow: (workflowId) =>
    Effect.gen(function* () {
      const operation = "workflowLibrary.deleteWorkflow";
      yield* session.execute(
        (db) => db.delete(workflows).where(eq(workflows.workflowId, workflowId)),
        operation,
      );
      yield* deleteWorkflowSettings(session, workflowId, operation);
      yield* session.afterCommit(Effect.sync(() => cache.dropWorkflow(workflowId)));
    }),
  deleteWorkflowKeepingVersions: ({ workflowId, nowMs }) =>
    Effect.gen(function* () {
      const operation = "workflowLibrary.deleteWorkflowKeepingVersions";
      yield* session.execute(
        (db) =>
          db
            .update(workflows)
            .set({ deletedAtMs: nowMs })
            .where(eq(workflows.workflowId, workflowId)),
        operation,
      );
      yield* session.execute(
        (db) => db.delete(workflowDrafts).where(eq(workflowDrafts.workflowId, workflowId)),
        operation,
      );
      yield* deleteWorkflowSettings(session, workflowId, operation);
    }),
  moveTasks: ({ workflowId, version, tasks: refs }) =>
    Effect.gen(function* () {
      const moved = [];
      for (const ref of refs) {
        const rows = yield* session.execute(
          (db) =>
            db
              .update(tasks)
              .set({ workflowVersion: version })
              .where(
                and(
                  eq(tasks.workspaceId, ref.workspaceId),
                  eq(tasks.id, ref.taskId),
                  eq(tasks.workflowId, workflowId),
                ),
              )
              .returning({ workspaceId: tasks.workspaceId, taskId: tasks.id }),
          "workflowLibrary.moveTasks",
        );
        moved.push(...rows);
      }
      return moved;
    }),
  saveRole: ({ role, nowMs }) =>
    Effect.gen(function* () {
      const definitionJson = JSON.stringify(role);
      yield* session.execute(
        (db) =>
          db
            .insert(workflowRoles)
            .values({ roleId: role.id, updatedAtMs: nowMs, definitionJson })
            .onConflictDoUpdate({
              target: workflowRoles.roleId,
              set: { updatedAtMs: nowMs, definitionJson },
            }),
        "workflowLibrary.saveRole",
      );
      if (role.workspaceAccess === "write") yield* clearReadOnlyCodexSandbox(session, role.id);
      yield* session.afterCommit(Effect.sync(() => cache.dropRole(role.id)));
    }),
  deleteRole: (roleId) =>
    Effect.gen(function* () {
      const operation = "workflowLibrary.deleteRole";
      yield* session.execute(
        (db) => db.delete(workflowRoles).where(eq(workflowRoles.roleId, roleId)),
        operation,
      );
      yield* deleteOwnerSettings(session, "role", roleId, operation);
      yield* session.execute(
        (db) => db.delete(workspaceRoleDefaults).where(eq(workspaceRoleDefaults.roleId, roleId)),
        operation,
      );
      yield* deleteRuntimeRoleOverrides(session, roleId);
      yield* session.afterCommit(Effect.sync(() => cache.dropRole(roleId)));
    }),
  setAvailability: ({ workflowId, rule }) =>
    Effect.gen(function* () {
      const operation = "workflowLibrary.setAvailability";
      yield* deleteAvailability(session, workflowId, operation);
      if (rule === null) return;
      yield* session.execute(
        (db) => db.insert(workflowAvailability).values({ workflowId, mode: rule.mode }),
        operation,
      );
      if (rule.workspaceIds.length === 0) return;
      yield* session.execute(
        (db) =>
          db
            .insert(workflowAvailabilityWorkspaces)
            .values(rule.workspaceIds.map((workspaceId) => ({ workflowId, workspaceId }))),
        operation,
      );
    }),
  setDefaultWorkflow: (workflowId) =>
    session.execute(
      (db) => db.update(hostSettings).set({ defaultWorkflowId: workflowId }),
      "workflowLibrary.setDefaultWorkflow",
    ),
});

/** Gives a failed query the SQLite message, as the task store does. */
const withQueryErrors = (
  session: HostDatabaseSession,
  databasePath: string,
): HostDatabaseSession => {
  const execute: HostDatabaseSession["execute"] = (run, operation, details) =>
    session.execute(run, operation, details).pipe(
      Effect.mapError((error) => {
        const mapped = mapSqliteTaskStoreAdapterError(operation, databasePath, error);
        return mapped instanceof HostOperationError ? mapped : error;
      }),
    );
  return { ...session, execute };
};

export const createSqliteWorkflowLibraryStore = ({
  withHostDatabase,
  databasePath,
  cache,
}: {
  withHostDatabase: SqliteHostDatabaseProvider;
  databasePath: string;
  cache: TaskWorkflowVersionCache;
}): WorkflowLibraryStorePort => ({
  read: (operation, use) =>
    withHostDatabase(operation, (session) =>
      session.readTransaction(operation, (transaction) =>
        use(createWorkflowLibraryReads(withQueryErrors(transaction, databasePath))),
      ),
    ),
  transact: (operation, use) =>
    withHostDatabase(operation, (session) =>
      session.transaction(operation, (transaction) => {
        const checked = withQueryErrors(transaction, databasePath);
        return use({
          ...createWorkflowLibraryReads(checked),
          ...createWrites(checked, cache),
        } satisfies WorkflowLibraryTransaction);
      }),
    ),
});
