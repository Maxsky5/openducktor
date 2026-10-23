import type { TaskArtifactSummary } from "@openducktor/contracts";
import { and, desc, eq, gt, inArray, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";
import {
  SqliteTaskStoreDataError,
  type SqliteTaskStoreReadError,
} from "./sqlite-task-store-errors";
import {
  type WorkflowArtifactKind,
  type TaskArtifactRow,
  type TaskStoreSession,
  taskArtifacts,
} from "./sqlite-task-store-schema";

export type WorkflowArtifactRow = TaskArtifactRow & { markdown: string };

export const latestWorkflowArtifactRow = (
  session: TaskStoreSession,
  taskId: string,
  kind: WorkflowArtifactKind,
): Effect.Effect<WorkflowArtifactRow | null, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (database) =>
        database
          .select()
          .from(taskArtifacts)
          .where(
            and(
              eq(taskArtifacts.taskId, taskId),
              eq(taskArtifacts.classification, "workflow"),
              eq(taskArtifacts.workflowKind, kind),
            ),
          )
          .orderBy(desc(taskArtifacts.revision))
          .limit(1),
      "sqliteTaskStore.latestWorkflowArtifactRow.selectArtifact",
    );
    const row = rows[0];
    if (!row) return null;
    if (row.markdown === null) {
      return yield* new SqliteTaskStoreDataError({
        message:
          "The stored workflow artifact has no Markdown. Restore the task store from a valid backup.",
        field: "markdown",
        details: { taskId },
      });
    }
    return { ...row, markdown: row.markdown };
  });

export const artifactSummariesByTaskId = (
  session: TaskStoreSession,
  taskIds: readonly string[],
): Effect.Effect<Map<string, TaskArtifactSummary>, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const uniqueTaskIds = Array.from(new Set(taskIds));
    const summaries = new Map<string, TaskArtifactSummary>(
      uniqueTaskIds.map((taskId) => [taskId, emptyArtifactSummary()]),
    );
    if (uniqueTaskIds.length === 0) {
      return summaries;
    }

    const rows = yield* session.execute((database) => {
      const newerTaskArtifacts = alias(taskArtifacts, "newer_tasks_artifacts");

      return database
        .select({
          kind: taskArtifacts.workflowKind,
          taskId: taskArtifacts.taskId,
          updatedAt: taskArtifacts.updatedAt,
          verdict: taskArtifacts.verdict,
        })
        .from(taskArtifacts)
        .where(
          and(
            inArray(taskArtifacts.taskId, uniqueTaskIds),
            eq(taskArtifacts.classification, "workflow"),
            notExists(
              database
                .select({ value: sql<number>`1` })
                .from(newerTaskArtifacts)
                .where(
                  and(
                    eq(newerTaskArtifacts.taskId, taskArtifacts.taskId),
                    eq(newerTaskArtifacts.classification, "workflow"),
                    eq(newerTaskArtifacts.workflowKind, taskArtifacts.workflowKind),
                    gt(newerTaskArtifacts.revision, taskArtifacts.revision),
                  ),
                ),
            ),
          ),
        );
    }, "sqliteTaskStore.artifactSummariesByTaskId.selectLatestArtifacts");

    for (const row of rows) {
      const summary = summaries.get(row.taskId);
      if (summary === undefined) {
        continue;
      }
      if (row.kind === "implementation_plan") {
        summary.plan = { has: true, updatedAt: toIso(row.updatedAt) };
      }
      if (row.kind === "spec") {
        summary.spec = { has: true, updatedAt: toIso(row.updatedAt) };
      }
      if (row.kind === "qa_report") {
        summary.qaReport = {
          has: true,
          updatedAt: toIso(row.updatedAt),
          verdict: row.verdict ?? "not_reviewed",
        };
      }
    }
    return summaries;
  });

export const artifactSummary = (
  session: TaskStoreSession,
  taskId: string,
): Effect.Effect<TaskArtifactSummary, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const summaries = yield* artifactSummariesByTaskId(session, [taskId]);
    return summaries.get(taskId) ?? emptyArtifactSummary();
  });

const emptyArtifactSummary = (): TaskArtifactSummary => ({
  plan: { has: false },
  qaReport: { has: false, verdict: "not_reviewed" },
  spec: { has: false },
});

const toIso = (value: Date | null): string | undefined => {
  if (value === null) {
    return undefined;
  }
  return value.toISOString();
};
