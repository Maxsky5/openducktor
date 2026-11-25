import { and, eq, inArray, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { compileWorkflowVersion } from "../../application/tasks/task-workflows";
import { HostResourceError, HostValidationError } from "../../effect/host-errors";
import type {
  StampedTaskWorkflowAssignment,
  TaskWorkflowVersionCache,
  WorkflowVersionKey,
} from "../../ports/task-workflow-port";
import type {
  StoredWorkflowRole,
  StoredWorkflowVersion,
} from "../../ports/workflow-library-store-port";
import type { HostDatabaseSession } from "./sqlite-host-database-schema";
import { sqliteValues } from "./sqlite-parameters";
import { readCustomRoles, storedVersionOf } from "./sqlite-workflow-library-store";
import { workflowRoles, workflowVersions } from "./sqlite-workflow-library-schema";

/** Each query names at most this many versions, to stay within the SQLite bind limit. */
const VERSION_BATCH = 100;

/**
 * The `published_at_ms` of the stored version of a task row, as a column of a `tasks` read. Null
 * for the built-in workflow. Each row costs one primary key lookup in the same statement.
 */
export const taskVersionPublishedAtMs = sql<number | null>`(${sql.raw(
  // Each column names its table: a single-table select drops the table names of Drizzle columns,
  // so the subquery would compare the version columns with themselves.
  `select "stored_version"."published_at_ms" from "workflow_versions" as "stored_version" where "stored_version"."workflow_id" = "tasks"."workflow_id" and "stored_version"."version" = "tasks"."workflow_version"`,
)})`;

/** A task row with the stamp of its stored version. */
type StampedTask = StampedTaskWorkflowAssignment & {
  readonly workspaceId: string;
  readonly id: string;
};

const rolesById = (roles: readonly StoredWorkflowRole[]) =>
  new Map(roles.map((stored) => [stored.role.id, stored]));

const compile = (version: StoredWorkflowVersion, roles: ReadonlyMap<string, StoredWorkflowRole>) =>
  Effect.try({
    try: () => compileWorkflowVersion(version, roles),
    catch: (cause) =>
      cause instanceof HostValidationError
        ? cause
        : new HostValidationError({ field: "workflow", message: String(cause), cause }),
  });

/**
 * Compiles the versions that the cache lacks or holds from another stored version, and returns the
 * compiled workflow of each version.
 */
const compileStoredVersions = (
  cache: TaskWorkflowVersionCache,
  versions: readonly StoredWorkflowVersion[],
  roles: readonly StoredWorkflowRole[],
) =>
  Effect.gen(function* () {
    const byId = rolesById(roles);
    return yield* Effect.forEach(versions, (version) =>
      Effect.gen(function* () {
        const key = { workflowId: version.workflowId, version: version.version };
        const cached = cache.cached(key);
        if (cached?.publishedAtMs === version.publishedAtMs) return cached.workflow;
        const entry = yield* compile(version, byId);
        cache.put(key, entry);
        return entry.workflow;
      }),
    );
  });

const readVersions = (session: HostDatabaseSession, keys: readonly WorkflowVersionKey[]) =>
  Effect.gen(function* () {
    const rows: (typeof workflowVersions.$inferSelect)[] = [];
    for (let start = 0; start < keys.length; start += VERSION_BATCH) {
      const batch = keys.slice(start, start + VERSION_BATCH);
      rows.push(
        ...(yield* session.execute(
          (db) =>
            db
              .select()
              .from(workflowVersions)
              .where(
                or(
                  ...batch.map(({ workflowId, version }) =>
                    and(
                      eq(workflowVersions.workflowId, workflowId),
                      eq(workflowVersions.version, version),
                    ),
                  ),
                ),
              ),
          "sqliteTaskStore.readWorkflowVersions",
        )),
      );
    }
    const found = new Set(rows.map(({ workflowId, version }) => `${workflowId}@${version}`));
    const absent = keys.find(({ workflowId, version }) => !found.has(`${workflowId}@${version}`));
    if (absent)
      return yield* new HostResourceError({
        resource: "workflow",
        operation: "sqliteTaskStore.readWorkflowVersions",
        message: `Workflow "${absent.workflowId}" version ${absent.version} does not exist in the host database. Move its tasks to a published version.`,
        details: { workflowId: absent.workflowId, version: absent.version },
      });
    return yield* Effect.forEach(rows, storedVersionOf);
  });

/**
 * Loads the custom versions of these tasks that the cache lacks or holds from another stored
 * version, in the database session that read the tasks. Then the resolver resolves each task.
 */
export const loadTaskWorkflowVersions = (
  session: HostDatabaseSession,
  cache: TaskWorkflowVersionCache,
  stamped: readonly StampedTask[],
) => loadWorkflowVersions(session, cache, stamped).pipe(Effect.map(() => cache.noteTasks(stamped)));

/**
 * Loads the custom versions of these assignments that the cache lacks or holds from another stored
 * version. The stamps come from the read that gave the assignments, so a cache hit costs no query.
 */
export const loadWorkflowVersions = (
  session: HostDatabaseSession,
  cache: TaskWorkflowVersionCache,
  assignments: Iterable<StampedTaskWorkflowAssignment>,
) =>
  Effect.gen(function* () {
    const missing = cache.missing(assignments);
    if (missing.length === 0) return;
    const versions = yield* readVersions(session, missing);
    yield* compileStoredVersions(cache, versions, yield* readCustomRoles(session));
  });

/**
 * Recompiles the cached version of the task when a custom role that it binds changed after the
 * compile. A session start calls it, so a role save reaches the sessions that start after it.
 */
export const refreshTaskWorkflowRoles = (
  session: HostDatabaseSession,
  cache: TaskWorkflowVersionCache,
  task: StampedTask,
) =>
  Effect.gen(function* () {
    if (task.workflowVersion === null) return;
    yield* loadTaskWorkflowVersions(session, cache, [task]);
    const key = { workflowId: task.workflowId, version: task.workflowVersion };
    const entry = cache.cached(key);
    if (!entry || entry.roleStamps.size === 0) return;
    const stamps = yield* session.execute(
      (db) =>
        db
          .select({ roleId: workflowRoles.roleId, updatedAtMs: workflowRoles.updatedAtMs })
          .from(workflowRoles)
          .where(inArray(workflowRoles.roleId, sqliteValues([...entry.roleStamps.keys()]))),
      "sqliteTaskStore.readRoleStamps",
    );
    if (
      stamps.length === entry.roleStamps.size &&
      stamps.every(({ roleId, updatedAtMs }) => entry.roleStamps.get(roleId) === updatedAtMs)
    )
      return;
    const [version] = yield* readVersions(session, [key]);
    const compiled = yield* compile(version!, rolesById(yield* readCustomRoles(session)));
    cache.put(key, compiled);
  });

/** The workflow of a task row. It loads the version first when the cache lacks it. */
export const resolveTaskWorkflow = (
  session: HostDatabaseSession,
  cache: TaskWorkflowVersionCache,
  task: StampedTask,
) => loadTaskWorkflowVersions(session, cache, [task]).pipe(Effect.map(() => cache.forTask(task)));
