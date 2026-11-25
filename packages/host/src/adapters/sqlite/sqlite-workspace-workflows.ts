import { TASK_CLOSED_STATE } from "@openducktor/contracts";
import {
  specPlanBuildWorkflow,
  taskWorkflowDescriptor,
  workflowReferenceKey,
  type TaskWorkflow,
} from "@openducktor/workflows";
import { and, asc, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { roleCatalogOf } from "../../application/tasks/task-workflows";
import {
  composeWorkspaceWorkflows,
  type DisplayVersionRange,
  displayVersionRanges,
  orderAvailableWorkflows,
} from "../../application/workflow-library/workspace-workflow-composition";
import { HostResourceError, HostValidationError } from "../../effect/host-errors";
import type {
  TaskWorkflowVersionCache,
  WorkspaceWorkflowPort,
} from "../../ports/task-workflow-port";
import { type HostDatabaseSession, tasks } from "./sqlite-host-database-schema";
import type {
  SqliteHostDatabaseProvider,
  SqliteTaskRepositoryContextProvider,
} from "./sqlite-task-repository-context";
import { mapSqliteTaskStoreAdapterError } from "./sqlite-task-store-errors";
import {
  loadWorkflowVersions,
  refreshTaskWorkflowRoles,
  taskVersionPublishedAtMs,
} from "./sqlite-task-workflow-versions";
import {
  isLatestVersion,
  readAvailability,
  readCustomRoles,
  readDefaultWorkflowId,
} from "./sqlite-workflow-library-store";
import { workflows, workflowVersions } from "./sqlite-workflow-library-schema";

/**
 * The compiled latest version of each custom workflow that the library lists, by workflow ID. A
 * deleted workflow keeps versions only for the closed tasks that use them, and the task reads load
 * those. It reads the version numbers and stamps, and only the documents that the cache lacks or
 * holds from another stored version.
 */
const readLatestWorkflows = (session: HostDatabaseSession, cache: TaskWorkflowVersionCache) =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (db) =>
        db
          .select({
            workflowId: workflowVersions.workflowId,
            workflowVersion: workflowVersions.version,
            workflowPublishedAtMs: workflowVersions.publishedAtMs,
          })
          .from(workflowVersions)
          .innerJoin(workflows, eq(workflows.workflowId, workflowVersions.workflowId))
          .where(and(isLatestVersion, isNull(workflows.deletedAtMs)))
          .orderBy(asc(workflowVersions.workflowId)),
      "workspaceWorkflows.latestVersions",
    );
    yield* loadWorkflowVersions(session, cache, rows);
    return new Map(rows.map((row) => [row.workflowId, cache.forTask(row)] as const));
  });

/** The versions of the display ranges. Most boards have no range and read nothing. */
const readDisplayVersions = (
  session: HostDatabaseSession,
  cache: TaskWorkflowVersionCache,
  ranges: readonly DisplayVersionRange[],
) =>
  Effect.gen(function* () {
    if (ranges.length === 0) return [];
    const rows = yield* session.execute(
      (db) =>
        db
          .select({
            workflowId: workflowVersions.workflowId,
            workflowVersion: workflowVersions.version,
            workflowPublishedAtMs: workflowVersions.publishedAtMs,
          })
          .from(workflowVersions)
          .where(
            or(
              ...ranges.map(({ workflowId, after, before }) =>
                and(
                  eq(workflowVersions.workflowId, workflowId),
                  gt(workflowVersions.version, after),
                  lt(workflowVersions.version, before),
                ),
              ),
            ),
          ),
      "workspaceWorkflows.context.displayVersions",
    );
    yield* loadWorkflowVersions(session, cache, rows);
    return rows.map((row) => cache.forTask(row));
  });

/** The workflows that a workspace offers for a new task, the default first, then by name. */
const readAvailableWorkflows = (
  session: HostDatabaseSession,
  workspaceId: string,
  builtin: TaskWorkflow,
  latest: ReadonlyMap<string, TaskWorkflow>,
) =>
  Effect.gen(function* () {
    const [defaultWorkflowId, rules, listed] = yield* Effect.all([
      readDefaultWorkflowId(session),
      readAvailability(session),
      session.execute(
        (db) =>
          db
            .select({ id: workflows.workflowId })
            .from(workflows)
            .where(isNull(workflows.deletedAtMs)),
        "workspaceWorkflows.listedWorkflows",
      ),
    ]);
    return yield* orderAvailableWorkflows(
      workspaceId,
      { defaultWorkflowId, rules, listedIds: new Set(listed.map(({ id }) => id)) },
      builtin,
      latest,
    );
  });

export const createSqliteWorkspaceWorkflows = ({
  withDatabase,
  withHostDatabase,
  databasePath,
  cache,
  hostInstanceId,
  builtin = specPlanBuildWorkflow,
}: {
  withDatabase: SqliteTaskRepositoryContextProvider;
  withHostDatabase: SqliteHostDatabaseProvider;
  databasePath: string;
  cache: TaskWorkflowVersionCache;
  hostInstanceId: string;
  builtin?: TaskWorkflow;
}): WorkspaceWorkflowPort => {
  const readHost = <A>(
    operation: string,
    use: (session: HostDatabaseSession) => Effect.Effect<A, unknown>,
  ) =>
    withHostDatabase(operation, (session) => session.readTransaction(operation, use)).pipe(
      Effect.mapError((cause) => mapSqliteTaskStoreAdapterError(operation, databasePath, cause)),
    );
  return {
    context: (scope) =>
      withDatabase(scope, "workspaceWorkflows.context", ({ session, workspaceId }) =>
        session.readTransaction("workspaceWorkflows.context", (transaction) =>
          Effect.gen(function* () {
            const latest = yield* readLatestWorkflows(transaction, cache);
            const available = yield* readAvailableWorkflows(
              transaction,
              workspaceId,
              builtin,
              latest,
            );
            const used = yield* transaction.execute(
              (db) =>
                db
                  .select({
                    workflowId: tasks.workflowId,
                    workflowVersion: tasks.workflowVersion,
                    workflowPublishedAtMs: taskVersionPublishedAtMs,
                    active: sql<number>`max(${tasks.status} <> ${TASK_CLOSED_STATE})`,
                  })
                  .from(tasks)
                  .where(eq(tasks.workspaceId, workspaceId))
                  .groupBy(tasks.workflowId, tasks.workflowVersion),
              "workspaceWorkflows.context.usedVersions",
            );
            yield* loadWorkflowVersions(transaction, cache, used);
            const active = used.filter((row) => row.active === 1).map(cache.forTask);
            return {
              hostInstanceId,
              ...composeWorkspaceWorkflows({
                builtin,
                latest,
                available,
                used: used.map(cache.forTask),
                active,
                displayVersions: yield* readDisplayVersions(
                  transaction,
                  cache,
                  displayVersionRanges(active, latest),
                ),
              }),
            };
          }),
        ),
      ),
    newTaskWorkflow: (scope, workflowId) =>
      withDatabase(scope, "workspaceWorkflows.newTaskWorkflow", ({ session, workspaceId }) =>
        session.readTransaction("workspaceWorkflows.newTaskWorkflow", (transaction) =>
          Effect.gen(function* () {
            const latest = yield* readLatestWorkflows(transaction, cache);
            const available = yield* readAvailableWorkflows(
              transaction,
              workspaceId,
              builtin,
              latest,
            );
            if (workflowId === undefined) return available[0]!;
            const chosen = available.find(({ reference }) => reference.id === workflowId);
            if (!chosen)
              return yield* new HostValidationError({
                field: "workflowId",
                message: `Workflow "${workflowId}" is not available in this repository. Choose one of ${available.map(({ reference }) => `"${reference.id}"`).join(", ")}, or change its availability on the Workflows page.`,
                details: { workspaceId, workflowId },
              });
            return chosen;
          }),
        ),
      ),
    catalog: () =>
      readHost("workspaceWorkflows.catalog", (session) =>
        Effect.gen(function* () {
          const roles = yield* readCustomRoles(session);
          const latest = yield* readLatestWorkflows(session, cache);
          const used = yield* session.execute(
            (db) =>
              db
                .selectDistinct({
                  workflowId: tasks.workflowId,
                  workflowVersion: tasks.workflowVersion,
                  workflowPublishedAtMs: taskVersionPublishedAtMs,
                })
                .from(tasks)
                .where(isNotNull(tasks.workflowVersion)),
            "workspaceWorkflows.catalog.usedVersions",
          );
          yield* loadWorkflowVersions(session, cache, used);
          const custom = new Map<string, TaskWorkflow>();
          for (const workflow of [
            ...latest.values(),
            ...used.map((assignment) => cache.forTask(assignment)),
          ])
            custom.set(workflowReferenceKey(workflow.reference), workflow);
          return {
            hostInstanceId,
            roles: roleCatalogOf(roles.map(({ role }) => role)),
            workflows: [builtin, ...custom.values()].map((workflow) =>
              taskWorkflowDescriptor(workflow),
            ),
          };
        }),
      ),
    settingsOwners: () =>
      readHost("workspaceWorkflows.settingsOwners", (session) =>
        Effect.gen(function* () {
          const latest = yield* readLatestWorkflows(session, cache);
          const roles = yield* readCustomRoles(session);
          return {
            latest: [builtin, ...latest.values()],
            roles: roleCatalogOf(roles.map(({ role }) => role)),
          };
        }),
      ),
    sessionTaskWorkflow: (scope) =>
      withDatabase(scope, "workspaceWorkflows.sessionTaskWorkflow", ({ session, workspaceId }) =>
        Effect.gen(function* () {
          const [task] = yield* session.execute(
            (db) =>
              db
                .select({
                  workspaceId: tasks.workspaceId,
                  id: tasks.id,
                  workflowId: tasks.workflowId,
                  workflowVersion: tasks.workflowVersion,
                  workflowPublishedAtMs: taskVersionPublishedAtMs,
                })
                .from(tasks)
                .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.id, scope.taskId))),
            "workspaceWorkflows.sessionTaskWorkflow.readTask",
          );
          if (!task)
            return yield* new HostResourceError({
              resource: "task",
              operation: "workspaceWorkflows.sessionTaskWorkflow",
              message: `Task not found: ${scope.taskId}`,
              details: { repoPath: scope.repoPath, taskId: scope.taskId },
            });
          yield* refreshTaskWorkflowRoles(session, cache, task);
          return cache.forTask(task);
        }),
      ),
  };
};
