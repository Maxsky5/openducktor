import type { QaReportVerdict, TaskMetadataArtifact } from "@openducktor/contracts";
import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { requireTaskRow } from "./sqlite-task-queries";
import {
  SqliteTaskStoreDataError,
  type SqliteTaskStoreWriteError,
} from "./sqlite-task-store-errors";
import {
  TASK_WORKFLOW_ARTIFACT_FORMAT_PLAIN_TEXT,
  type TaskArtifactInsert,
  type WorkflowArtifactKind,
  type TaskStoreSession,
  taskArtifacts,
} from "./sqlite-task-store-schema";

const ODT_SET_SPEC_SOURCE_TOOL = "odt_set_spec";
const ODT_SET_PLAN_SOURCE_TOOL = "odt_set_plan";
const ODT_QA_APPROVED_SOURCE_TOOL = "odt_qa_approved";
const ODT_QA_REJECTED_SOURCE_TOOL = "odt_qa_rejected";

const workflowArtifactNames = {
  spec: "Specification",
  implementation_plan: "Implementation Plan",
  qa_report: "QA Report",
} satisfies Record<WorkflowArtifactKind, string>;

export const insertWorkflowArtifact = (
  session: TaskStoreSession,
  input: {
    kind: WorkflowArtifactKind;
    markdown: string;
    sourceTool: string;
    taskId: string;
    updatedAt: Date;
    updatedBy: string;
    verdict?: QaReportVerdict | undefined;
  },
): Effect.Effect<TaskMetadataArtifact, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    const revision = yield* nextWorkflowArtifactRevision(session, input.taskId, input.kind);
    const markdown = input.markdown.trim();
    const artifact: TaskArtifactInsert = {
      artifactId: `workflow:${input.taskId}:${input.kind}`,
      classification: "workflow",
      name: workflowArtifactNames[input.kind],
      format: TASK_WORKFLOW_ARTIFACT_FORMAT_PLAIN_TEXT,
      workflowKind: input.kind,
      markdown,
      revision,
      sourceTool: input.sourceTool,
      taskId: input.taskId,
      updatedAt: input.updatedAt,
      updatedBy: input.updatedBy,
      verdict: input.verdict ?? null,
    };
    yield* session.execute(
      (database) => database.insert(taskArtifacts).values(artifact),
      "sqliteTaskStore.insertWorkflowArtifact.insertWorkflowArtifact",
      { kind: input.kind, taskId: input.taskId },
    );
    return {
      markdown,
      revision,
      updatedAt: input.updatedAt.toISOString(),
    };
  });

export const clearQaReportArtifacts = (
  session: TaskStoreSession,
  taskId: string,
  repoPath: string,
): Effect.Effect<boolean, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    yield* requireTaskRow(session, taskId, repoPath);
    yield* session.execute(
      (database) =>
        database
          .delete(taskArtifacts)
          .where(
            and(
              eq(taskArtifacts.taskId, taskId),
              eq(taskArtifacts.classification, "workflow"),
              eq(taskArtifacts.workflowKind, "qa_report"),
            ),
          ),
      "sqliteTaskRepository.clearQaReports.deleteArtifacts",
    );
    return true;
  });

export const clearTaskArtifacts = (
  session: TaskStoreSession,
  taskId: string,
  repoPath: string,
): Effect.Effect<boolean, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    yield* requireTaskRow(session, taskId, repoPath);
    yield* session.execute(
      (database) => database.delete(taskArtifacts).where(eq(taskArtifacts.taskId, taskId)),
      "sqliteTaskRepository.clearTaskArtifacts.deleteArtifacts",
    );
    return true;
  });

export const qaReportSourceTool = (verdict: QaReportVerdict): string =>
  verdict === "approved" ? ODT_QA_APPROVED_SOURCE_TOOL : ODT_QA_REJECTED_SOURCE_TOOL;

export const specSourceTool = ODT_SET_SPEC_SOURCE_TOOL;
export const planSourceTool = ODT_SET_PLAN_SOURCE_TOOL;

const nextWorkflowArtifactRevision = (
  session: TaskStoreSession,
  taskId: string,
  kind: WorkflowArtifactKind,
): Effect.Effect<number, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (database) =>
        database
          .select({ revision: sql<number | null>`max(${taskArtifacts.revision})` })
          .from(taskArtifacts)
          .where(
            and(
              eq(taskArtifacts.taskId, taskId),
              eq(taskArtifacts.classification, "workflow"),
              eq(taskArtifacts.workflowKind, kind),
            ),
          )
          .limit(1),
      "sqliteTaskStore.nextWorkflowArtifactRevision.selectRevision",
      { kind, taskId },
    );
    const revision = rows[0]?.revision ?? null;
    if (revision === null) {
      return 1;
    }
    const parsedRevision = z.number().safeParse(revision);
    if (!parsedRevision.success) {
      return yield* new SqliteTaskStoreDataError({
        message: "SQLite workflow artifact revision must be a number.",
        field: "revision",
        details: { kind, taskId, value: revision },
      });
    }
    return parsedRevision.data + 1;
  });
