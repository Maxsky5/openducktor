import type { QaReportVerdict, TaskMetadataDocument } from "@openducktor/contracts";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { requireTaskRow } from "./sqlite-task-queries";
import {
  SqliteTaskStoreDataError,
  type SqliteTaskStoreWriteError,
} from "./sqlite-task-store-errors";
import {
  TASK_DOCUMENT_FORMAT_PLAIN_TEXT,
  type TaskDocumentInsert,
  type TaskDocumentKind,
  type TaskStoreSession,
  taskDocuments,
} from "./sqlite-task-store-schema";

const ODT_SET_SPEC_SOURCE_TOOL = "odt_set_spec";
const ODT_SET_PLAN_SOURCE_TOOL = "odt_set_plan";
const ODT_QA_APPROVED_SOURCE_TOOL = "odt_qa_approved";
const ODT_QA_REJECTED_SOURCE_TOOL = "odt_qa_rejected";

const nextDocumentRevision = (
  session: TaskStoreSession,
  taskId: string,
  kind: TaskDocumentKind,
): Effect.Effect<number, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (database) =>
        database
          .select({ revision: sql<number | null>`max(${taskDocuments.revision})` })
          .from(taskDocuments)
          .where(and(eq(taskDocuments.taskId, taskId), eq(taskDocuments.kind, kind)))
          .limit(1),
      "sqliteTaskStore.nextDocumentRevision.selectRevision",
      { kind, taskId },
    );
    const revision = rows[0]?.revision ?? null;
    if (revision === null) {
      return 1;
    }
    if (typeof revision !== "number") {
      return yield* new SqliteTaskStoreDataError({
        message: "SQLite task document revision must be a number.",
        field: "revision",
        details: { kind, taskId, value: revision },
      });
    }
    return revision + 1;
  });

export const insertDocument = (
  session: TaskStoreSession,
  input: {
    kind: TaskDocumentKind;
    markdown: string;
    sourceTool: string;
    taskId: string;
    updatedAt: Date;
    updatedBy: string;
    verdict?: QaReportVerdict | undefined;
  },
): Effect.Effect<TaskMetadataDocument, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    const revision = yield* nextDocumentRevision(session, input.taskId, input.kind);
    const markdown = input.markdown.trim();
    const document: TaskDocumentInsert = {
      format: TASK_DOCUMENT_FORMAT_PLAIN_TEXT,
      kind: input.kind,
      markdown,
      revision,
      sourceTool: input.sourceTool,
      taskId: input.taskId,
      updatedAt: input.updatedAt,
      updatedBy: input.updatedBy,
      verdict: input.verdict ?? null,
    };
    yield* session.execute(
      (database) => database.insert(taskDocuments).values(document),
      "sqliteTaskStore.insertDocument.insertDocument",
      { kind: input.kind, taskId: input.taskId },
    );
    return {
      markdown,
      revision,
      updatedAt: input.updatedAt.toISOString(),
    };
  });

export const clearQaReportDocuments = (
  session: TaskStoreSession,
  taskId: string,
  repoPath: string,
): Effect.Effect<boolean, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    yield* requireTaskRow(session, taskId, repoPath);
    yield* session.execute(
      (database) =>
        database
          .delete(taskDocuments)
          .where(and(eq(taskDocuments.taskId, taskId), eq(taskDocuments.kind, "qa_report"))),
      "sqliteTaskRepository.clearQaReports.deleteDocuments",
    );
    return true;
  });

export const clearWorkflowDocuments = (
  session: TaskStoreSession,
  taskId: string,
  repoPath: string,
): Effect.Effect<boolean, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    yield* requireTaskRow(session, taskId, repoPath);
    yield* session.execute(
      (database) =>
        database
          .delete(taskDocuments)
          .where(
            and(
              eq(taskDocuments.taskId, taskId),
              inArray(taskDocuments.kind, ["implementation_plan", "qa_report", "spec"]),
            ),
          ),
      "sqliteTaskRepository.clearWorkflowDocuments.deleteDocuments",
    );
    return true;
  });

export const qaReportSourceTool = (verdict: QaReportVerdict): string =>
  verdict === "approved" ? ODT_QA_APPROVED_SOURCE_TOOL : ODT_QA_REJECTED_SOURCE_TOOL;

export const specSourceTool = ODT_SET_SPEC_SOURCE_TOOL;
export const planSourceTool = ODT_SET_PLAN_SOURCE_TOOL;
