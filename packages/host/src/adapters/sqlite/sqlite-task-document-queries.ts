import type { QaWorkflowVerdict, TaskDocumentSummary } from "@openducktor/contracts";
import { and, desc, eq, gt, inArray, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";
import type { SqliteTaskStoreReadError } from "./sqlite-task-store-errors";
import {
  type TaskDocumentKind,
  type TaskDocumentRow,
  type TaskStoreSession,
  taskDocuments,
} from "./sqlite-task-store-schema";

const toIso = (value: Date | null): string | undefined => {
  if (value === null) {
    return undefined;
  }
  return value.toISOString();
};

export const latestDocumentRow = (
  session: TaskStoreSession,
  taskId: string,
  kind: TaskDocumentKind,
): Effect.Effect<TaskDocumentRow | null, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (database) =>
        database
          .select()
          .from(taskDocuments)
          .where(and(eq(taskDocuments.taskId, taskId), eq(taskDocuments.kind, kind)))
          .orderBy(desc(taskDocuments.revision))
          .limit(1),
      "sqliteTaskStore.latestDocumentRow.selectDocument",
    );
    return rows[0] ?? null;
  });

const emptyDocumentSummary = (): TaskDocumentSummary => ({
  plan: { has: false },
  qaReport: { has: false, verdict: "not_reviewed" },
  spec: { has: false },
});

const qaReportVerdictFromSummaryRow = (value: "approved" | "rejected" | null): QaWorkflowVerdict =>
  value ?? "not_reviewed";

export const documentSummariesByTaskId = (
  session: TaskStoreSession,
  taskIds: readonly string[],
): Effect.Effect<Map<string, TaskDocumentSummary>, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const uniqueTaskIds = Array.from(new Set(taskIds));
    const summaries = new Map<string, TaskDocumentSummary>(
      uniqueTaskIds.map((taskId) => [taskId, emptyDocumentSummary()]),
    );
    if (uniqueTaskIds.length === 0) {
      return summaries;
    }

    const rows = yield* session.execute((database) => {
      const newerTaskDocuments = alias(taskDocuments, "newer_task_documents");

      return database
        .select({
          kind: taskDocuments.kind,
          taskId: taskDocuments.taskId,
          updatedAt: taskDocuments.updatedAt,
          verdict: taskDocuments.verdict,
        })
        .from(taskDocuments)
        .where(
          and(
            inArray(taskDocuments.taskId, uniqueTaskIds),
            notExists(
              database
                .select({ value: sql<number>`1` })
                .from(newerTaskDocuments)
                .where(
                  and(
                    eq(newerTaskDocuments.taskId, taskDocuments.taskId),
                    eq(newerTaskDocuments.kind, taskDocuments.kind),
                    gt(newerTaskDocuments.revision, taskDocuments.revision),
                  ),
                ),
            ),
          ),
        );
    }, "sqliteTaskStore.documentSummariesByTaskId.selectLatestDocuments");

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
          verdict: qaReportVerdictFromSummaryRow(row.verdict),
        };
      }
    }
    return summaries;
  });

export const documentSummary = (
  session: TaskStoreSession,
  taskId: string,
): Effect.Effect<TaskDocumentSummary, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const summaries = yield* documentSummariesByTaskId(session, [taskId]);
    return summaries.get(taskId) ?? emptyDocumentSummary();
  });
