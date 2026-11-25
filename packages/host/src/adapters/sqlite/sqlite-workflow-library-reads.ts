import {
  agentRoleDefinitionSchema,
  workflowDocumentSchema,
  workflowVersionDocumentSchema,
} from "@openducktor/contracts";
import { and, asc, count, eq, exists, isNotNull, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";
import type { z } from "zod";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import type {
  StoredWorkflowDraft,
  StoredWorkflowRole,
  StoredWorkflowAvailability,
  StoredWorkflowVersion,
  WorkflowLibraryReads,
} from "../../ports/workflow-library-store-port";
import { type HostDatabaseSession, tasks } from "./sqlite-host-database-schema";
import { hostSettings, workspaces } from "./sqlite-host-settings-schema";
import {
  workflowAvailability,
  workflowAvailabilityWorkspaces,
  workflowDrafts,
  workflowRoles,
  workflowVersions,
  workflows,
} from "./sqlite-workflow-library-schema";

type StoredRowDetails = Record<string, string | number>;

const describe = (details: StoredRowDetails) =>
  Object.entries(details)
    .map(([key, value]) => `${key} "${value}"`)
    .join(", ");

const corruptRow = (field: string, details: StoredRowDetails, problem: string, cause: unknown) =>
  new HostOperationError({
    operation: "workflowLibrary.parseStoredRow",
    message: `The stored ${field} of ${describe(details)} is invalid: ${problem} Restore the host database from a valid backup.`,
    cause,
    details,
  });

/** Parses a stored JSON column with its schema. A corrupt row fails the read and names the row. */
const parseStored = <Output>(
  schema: z.ZodType<Output>,
  text: string,
  field: string,
  details: StoredRowDetails,
) =>
  Effect.try({
    try: () => schema.parse(JSON.parse(text)),
    catch: (cause) => corruptRow(field, details, errorMessage(cause), cause),
  });

/** Parses a stored version row. */
export const storedVersionOf = (row: typeof workflowVersions.$inferSelect) =>
  parseStored(workflowVersionDocumentSchema, row.documentJson, "workflow version", {
    workflow: row.workflowId,
    version: row.version,
  }).pipe(
    Effect.map((document): StoredWorkflowVersion => ({
      workflowId: row.workflowId,
      version: row.version,
      publishedAtMs: row.publishedAtMs,
      document,
    })),
  );

const storedDraftOf = (row: typeof workflowDrafts.$inferSelect) =>
  parseStored(workflowDocumentSchema, row.documentJson, "workflow draft", {
    workflow: row.workflowId,
  }).pipe(
    Effect.map((document): StoredWorkflowDraft => ({
      workflowId: row.workflowId,
      updatedAtMs: row.updatedAtMs,
      document,
    })),
  );

/** Every custom role, ordered by role ID. */
export const readCustomRoles = (session: HostDatabaseSession) =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (db) => db.select().from(workflowRoles).orderBy(asc(workflowRoles.roleId)),
      "workflowLibrary.roles",
    );
    return yield* Effect.forEach(rows, (row) =>
      parseStored(agentRoleDefinitionSchema, row.definitionJson, "workflow role", {
        role: row.roleId,
      }).pipe(Effect.map((role): StoredWorkflowRole => ({ role, updatedAtMs: row.updatedAtMs }))),
    );
  });

/** Whether a `workflow_versions` row is the latest version of its workflow. */
export const isLatestVersion = eq(
  workflowVersions.version,
  sql`(select max(latest.version) from workflow_versions latest where latest.workflow_id = ${workflowVersions.workflowId})`,
);

/** The latest version of each custom workflow, ordered by workflow ID. */
const readLatestVersions = (session: HostDatabaseSession) =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (db) =>
        db
          .select()
          .from(workflowVersions)
          .where(isLatestVersion)
          .orderBy(asc(workflowVersions.workflowId)),
      "workflowLibrary.latestVersions",
    );
    return yield* Effect.forEach(rows, storedVersionOf);
  });

/** The availability rules with their workspaces, ordered by workflow ID. */
export const readAvailability = (session: HostDatabaseSession) =>
  Effect.gen(function* () {
    const [rules, listed] = yield* Effect.all([
      session.execute(
        (db) =>
          db.select().from(workflowAvailability).orderBy(asc(workflowAvailability.workflowId)),
        "workflowLibrary.availability",
      ),
      session.execute(
        (db) =>
          db
            .select()
            .from(workflowAvailabilityWorkspaces)
            .orderBy(asc(workflowAvailabilityWorkspaces.workspaceId)),
        "workflowLibrary.availabilityWorkspaces",
      ),
    ]);
    return rules.map(({ workflowId, mode }): StoredWorkflowAvailability => ({
      workflowId,
      mode,
      workspaceIds: listed
        .filter((row) => row.workflowId === workflowId)
        .map((row) => row.workspaceId),
    }));
  });

/** The workflow of a new task, from the host settings. */
export const readDefaultWorkflowId = (session: HostDatabaseSession) =>
  session
    .execute(
      (db) => db.select({ id: hostSettings.defaultWorkflowId }).from(hostSettings),
      "workflowLibrary.defaultWorkflowId",
    )
    .pipe(
      Effect.flatMap((rows) =>
        rows[0]
          ? Effect.succeed(rows[0].id)
          : Effect.fail(
              new HostOperationError({
                operation: "workflowLibrary.defaultWorkflowId",
                message:
                  "The host settings have no row. Restart OpenDucktor so that it writes them again.",
              }),
            ),
      ),
    );

const latestVersionSql = sql<
  number | null
>`(select max(${workflowVersions.version}) from ${workflowVersions} where ${workflowVersions.workflowId} = ${workflows.workflowId})`;

const readWorkflowRows = (session: HostDatabaseSession, workflowId?: string) =>
  session.execute(
    (db) =>
      db
        .select({
          workflowId: workflows.workflowId,
          createdAtMs: workflows.createdAtMs,
          latestVersion: latestVersionSql,
          draftUpdatedAtMs: workflowDrafts.updatedAtMs,
          deletedAtMs: workflows.deletedAtMs,
        })
        .from(workflows)
        .leftJoin(workflowDrafts, eq(workflowDrafts.workflowId, workflows.workflowId))
        .where(workflowId === undefined ? undefined : eq(workflows.workflowId, workflowId))
        .orderBy(asc(workflows.workflowId)),
    "workflowLibrary.workflows",
  );

/**
 * The tasks on a published version that match `where`, with their repository name, ordered by
 * workspace then task ID. Only a task of the built-in workflow has no version.
 */
const selectWorkflowTasks = (session: HostDatabaseSession, label: string, ...where: SQL[]) =>
  session
    .execute(
      (db) =>
        db
          .select({
            workspaceId: tasks.workspaceId,
            repoName: workspaces.workspaceName,
            taskId: tasks.id,
            title: tasks.title,
            status: tasks.status,
            issueType: tasks.issueType,
            version: tasks.workflowVersion,
          })
          .from(tasks)
          .innerJoin(workspaces, eq(workspaces.workspaceId, tasks.workspaceId))
          .where(and(isNotNull(tasks.workflowVersion), ...where))
          .orderBy(asc(tasks.workspaceId), asc(tasks.id)),
      label,
    )
    .pipe(
      Effect.map((rows) =>
        rows.flatMap(({ version, ...row }) => (version === null ? [] : [{ ...row, version }])),
      ),
    );

const bindsRole = (documentJson: AnySQLiteColumn, roleId: string) =>
  sql`exists (select 1 from json_each(${documentJson}, '$.definition.roles') where json_extract(value, '$.id') = ${roleId})`;

export const createWorkflowLibraryReads = (session: HostDatabaseSession): WorkflowLibraryReads => ({
  workflows: () => readWorkflowRows(session),
  workflow: (workflowId) =>
    readWorkflowRows(session, workflowId).pipe(Effect.map((rows) => rows[0] ?? null)),
  draft: (workflowId) =>
    Effect.gen(function* () {
      const rows = yield* session.execute(
        (db) => db.select().from(workflowDrafts).where(eq(workflowDrafts.workflowId, workflowId)),
        "workflowLibrary.draft",
      );
      return rows[0] ? yield* storedDraftOf(rows[0]) : null;
    }),
  drafts: () =>
    Effect.gen(function* () {
      const rows = yield* session.execute(
        (db) => db.select().from(workflowDrafts).orderBy(asc(workflowDrafts.workflowId)),
        "workflowLibrary.drafts",
      );
      return yield* Effect.forEach(rows, storedDraftOf);
    }),
  versions: (workflowId) =>
    session.execute(
      (db) =>
        // A join keeps the table names in the query. A single-table select drops them, so a
        // correlated subquery would compare the task columns with themselves.
        db
          .select({
            version: workflowVersions.version,
            publishedAtMs: workflowVersions.publishedAtMs,
            taskCount: count(tasks.id),
          })
          .from(workflowVersions)
          .leftJoin(
            tasks,
            and(
              eq(tasks.workflowId, workflowVersions.workflowId),
              eq(tasks.workflowVersion, workflowVersions.version),
            ),
          )
          .where(eq(workflowVersions.workflowId, workflowId))
          .groupBy(workflowVersions.version, workflowVersions.publishedAtMs)
          .orderBy(asc(workflowVersions.version)),
      "workflowLibrary.versions",
    ),
  version: (workflowId, version) =>
    Effect.gen(function* () {
      const rows = yield* session.execute(
        (db) =>
          db
            .select()
            .from(workflowVersions)
            .where(
              and(
                eq(workflowVersions.workflowId, workflowId),
                eq(workflowVersions.version, version),
              ),
            ),
        "workflowLibrary.version",
      );
      return rows[0] ? yield* storedVersionOf(rows[0]) : null;
    }),
  latestVersions: () => readLatestVersions(session),
  roles: () => readCustomRoles(session),
  availability: () => readAvailability(session),
  defaultWorkflowId: () => readDefaultWorkflowId(session),
  workspaceIds: () =>
    session
      .execute(
        (db) =>
          db
            .select({ id: workspaces.workspaceId })
            .from(workspaces)
            .orderBy(asc(workspaces.workspaceId)),
        "workflowLibrary.workspaceIds",
      )
      .pipe(Effect.map((rows) => rows.map(({ id }) => id))),
  tasksBelowVersion: (workflowId, belowVersion) =>
    selectWorkflowTasks(
      session,
      "workflowLibrary.tasksBelowVersion",
      eq(tasks.workflowId, workflowId),
      lt(tasks.workflowVersion, belowVersion),
    ),
  tasksOfWorkflow: (workflowId) =>
    selectWorkflowTasks(
      session,
      "workflowLibrary.tasksOfWorkflow",
      eq(tasks.workflowId, workflowId),
    ),
  roleBindings: (roleId) =>
    Effect.gen(function* () {
      const versions = yield* session.execute(
        (db) =>
          db
            .select({ workflowId: workflowVersions.workflowId, version: workflowVersions.version })
            .from(workflowVersions)
            .innerJoin(workflows, eq(workflows.workflowId, workflowVersions.workflowId))
            .where(
              and(
                bindsRole(workflowVersions.documentJson, roleId),
                // A deleted workflow keeps a version only for the tasks that still use it.
                or(
                  isNull(workflows.deletedAtMs),
                  exists(
                    db
                      .select({ id: tasks.id })
                      .from(tasks)
                      .where(
                        and(
                          eq(tasks.workflowId, workflowVersions.workflowId),
                          eq(tasks.workflowVersion, workflowVersions.version),
                        ),
                      ),
                  ),
                ),
              ),
            )
            .orderBy(asc(workflowVersions.workflowId), asc(workflowVersions.version)),
        "workflowLibrary.roleBindings.versions",
      );
      const drafts = yield* session.execute(
        (db) =>
          db
            .select({ workflowId: workflowDrafts.workflowId })
            .from(workflowDrafts)
            .where(bindsRole(workflowDrafts.documentJson, roleId)),
        "workflowLibrary.roleBindings.drafts",
      );
      const bindings = new Map<string, { versions: number[]; draft: boolean }>();
      const binding = (workflowId: string) => {
        const known = bindings.get(workflowId) ?? { versions: [], draft: false };
        bindings.set(workflowId, known);
        return known;
      };
      for (const { workflowId, version } of versions) binding(workflowId).versions.push(version);
      for (const { workflowId } of drafts) binding(workflowId).draft = true;
      return [...bindings]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([workflowId, known]) => ({ workflowId, ...known }));
    }),
});
