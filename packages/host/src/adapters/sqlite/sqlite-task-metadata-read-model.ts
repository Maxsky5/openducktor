import {
  directMergeRecordSchema,
  gitTargetBranchSchema,
  pullRequestSchema,
  type QaWorkflowVerdict,
  type TaskMetadataDocument,
  type TaskMetadataPayload,
  taskMetadataPayloadSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { agentSessionsFromRow, decodeWithSchema, optionalJsonFromRow } from "./sqlite-json-codecs";
import { latestDocumentRow } from "./sqlite-task-document-queries";
import type { SqliteTaskStoreReadError } from "./sqlite-task-store-errors";
import type { TaskDocumentRow, TaskRow, TaskStoreSession } from "./sqlite-task-store-schema";

const toIso = (value: Date | null): string | undefined => {
  if (value === null) {
    return undefined;
  }
  return value.toISOString();
};

const toMetadataDocument = (row: TaskDocumentRow | null): TaskMetadataDocument => ({
  markdown: row?.markdown ?? "",
  revision: row?.revision,
  updatedAt: toIso(row?.updatedAt ?? null),
});

const toQaMetadataDocument = (
  row: TaskDocumentRow | null,
): TaskMetadataPayload["qaReport"] | undefined => {
  if (!row) {
    return undefined;
  }
  const verdict: QaWorkflowVerdict =
    row.verdict === "approved" || row.verdict === "rejected" ? row.verdict : "not_reviewed";
  return {
    markdown: row.markdown,
    revision: row.revision,
    updatedAt: toIso(row.updatedAt),
    verdict,
  };
};

export const taskMetadata = (
  session: TaskStoreSession,
  row: TaskRow,
): Effect.Effect<TaskMetadataPayload, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const spec = yield* latestDocumentRow(session, row.id, "spec");
    const plan = yield* latestDocumentRow(session, row.id, "implementation_plan");
    const qaReport = yield* latestDocumentRow(session, row.id, "qa_report");
    const agentSessions = yield* agentSessionsFromRow(row);
    const directMerge = yield* optionalJsonFromRow(row, "directMergeJson", (value) =>
      decodeWithSchema(directMergeRecordSchema, value, "direct_merge_json", { taskId: row.id }),
    );
    const pullRequest = yield* optionalJsonFromRow(row, "pullRequestJson", (value) =>
      decodeWithSchema(pullRequestSchema, value, "pull_request_json", { taskId: row.id }),
    );
    const targetBranch = yield* optionalJsonFromRow(row, "targetBranchJson", (value) =>
      decodeWithSchema(gitTargetBranchSchema, value, "target_branch_json", { taskId: row.id }),
    );
    return yield* decodeWithSchema(
      taskMetadataPayloadSchema,
      {
        agentSessions,
        directMerge,
        plan: toMetadataDocument(plan),
        pullRequest,
        qaReport: toQaMetadataDocument(qaReport),
        spec: toMetadataDocument(spec),
        targetBranch,
      },
      "task metadata read model",
      { taskId: row.id },
    );
  });
