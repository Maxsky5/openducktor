import type { TaskArtifactState, TaskArtifactSummary } from "@openducktor/contracts";
import { sql } from "drizzle-orm";
import type { TaskWorkflow } from "@openducktor/workflows";
import { Effect } from "effect";
import { sqliteBatches } from "./sqlite-parameters";
import {
  SqliteTaskStoreDataError,
  type SqliteTaskStoreReadError,
} from "./sqlite-task-store-errors";
import {
  type TaskArtifactRow,
  type HostDatabaseSession,
  taskArtifacts,
} from "./sqlite-host-database-schema";

export type WorkflowArtifactRow = Pick<
  TaskArtifactRow,
  "code" | "revision" | "updatedAt" | "verdict"
> & { markdown: string };

export const latestWorkflowArtifactRows = (
  session: HostDatabaseSession,
  workspaceId: string,
  taskId: string,
  codes: readonly string[],
): Effect.Effect<WorkflowArtifactRow[], SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    if (codes.length === 0) return [];
    const artifacts: WorkflowArtifactRow[] = [];
    for (const batch of sqliteBatches([...new Set(codes)], 2, 1)) {
      const pairs = batch.map((code) => sql`(${taskId}, ${code})`);
      const rows = yield* session.execute(
        (database) =>
          database
            .select({
              code: taskArtifacts.code,
              markdown: taskArtifacts.markdown,
              revision: taskArtifacts.revision,
              updatedAt: taskArtifacts.updatedAt,
              verdict: taskArtifacts.verdict,
            })
            .from(sql`(values ${sql.join(pairs, sql`, `)}) as requested`)
            .innerJoin(taskArtifacts, latestRequestedArtifact(workspaceId)),
        "sqliteTaskStore.latestWorkflowArtifactRows.selectArtifacts",
      );
      for (const row of rows) {
        if (row.markdown === null) {
          return yield* new SqliteTaskStoreDataError({
            message:
              "The stored workflow artifact has no Markdown. Restore the task store from a valid backup.",
            field: "markdown",
            details: { taskId },
          });
        }
        artifacts.push({ ...row, markdown: row.markdown });
      }
    }
    return artifacts;
  });

/**
 * The summary of a task has an entry for each artifact of its workflow. A stored code outside that
 * workflow is left out.
 */
export const artifactSummariesByTaskId = (
  session: HostDatabaseSession,
  workspaceId: string,
  workflowsByTaskId: ReadonlyMap<string, TaskWorkflow>,
): Effect.Effect<Map<string, TaskArtifactSummary>, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const summaries = new Map<string, TaskArtifactSummary>(
      [...workflowsByTaskId].map(([taskId, workflow]) => [taskId, workflow.emptyArtifactSummary()]),
    );
    const requested = [...summaries].flatMap(([taskId, summary]) =>
      Object.keys(summary).map((code) => [taskId, code] as const),
    );
    for (const batch of sqliteBatches(requested, 2, 1)) {
      const pairs = batch.map(([taskId, code]) => sql`(${taskId}, ${code})`);
      const rows = yield* session.execute(
        (database) =>
          database
            .select({
              code: taskArtifacts.code,
              taskId: taskArtifacts.taskId,
              updatedAt: taskArtifacts.updatedAt,
              verdict: taskArtifacts.verdict,
            })
            .from(sql`(values ${sql.join(pairs, sql`, `)}) as requested`)
            .innerJoin(taskArtifacts, latestRequestedArtifact(workspaceId)),
        "sqliteTaskStore.artifactSummariesByTaskId.selectLatestArtifacts",
      );
      for (const row of rows) {
        const state: TaskArtifactState = { present: true, updatedAt: toIso(row.updatedAt) };
        if (row.verdict !== null) state.verdict = row.verdict;
        summaries.get(row.taskId)![row.code] = state;
      }
    }
    return summaries;
  });

// Each requested task/code pair seeks one row through the workflow revision index.
const latestRequestedArtifact = (workspaceId: string) => sql`${taskArtifacts}.rowid = (
  select rowid from task_artifacts
  where workspace_id = ${workspaceId}
    and task_id = requested.column1 and code = requested.column2
    and classification = 'workflow'
  order by revision desc limit 1
)`;

const toIso = (value: Date | null): string | undefined => {
  if (value === null) {
    return undefined;
  }
  return value.toISOString();
};
