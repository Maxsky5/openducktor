import {
  directMergeRecordSchema,
  gitTargetBranchSchema,
  pullRequestSchema,
  type QaWorkflowVerdict,
  type TaskMetadataArtifact,
  type TaskMetadataPayload,
  taskMetadataPayloadSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  agentSessionsFromRow,
  decodeWithSchema,
  optionalJsonFromRow,
  validateWithSchema,
} from "./sqlite-json-codecs";
import {
  latestWorkflowArtifactRow,
  type WorkflowArtifactRow,
} from "./sqlite-task-workflow-artifact-queries";
import type { SqliteTaskStoreReadError } from "./sqlite-task-store-errors";
import type { TaskRow, TaskStoreSession } from "./sqlite-task-store-schema";

const toIso = (value: Date | null): string | undefined => {
  if (value === null) {
    return undefined;
  }
  return value.toISOString();
};

const toMetadataArtifact = (row: WorkflowArtifactRow | null): TaskMetadataArtifact => ({
  markdown: row?.markdown ?? "",
  revision: row?.revision,
  updatedAt: toIso(row?.updatedAt ?? null),
});

const toQaMetadataArtifact = (
  row: WorkflowArtifactRow | null,
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
    const spec = yield* latestWorkflowArtifactRow(session, row.id, "spec");
    const plan = yield* latestWorkflowArtifactRow(session, row.id, "implementation_plan");
    const qaReport = yield* latestWorkflowArtifactRow(session, row.id, "qa_report");
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
    return yield* validateWithSchema(
      taskMetadataPayloadSchema,
      {
        agentSessions,
        directMerge,
        plan: toMetadataArtifact(plan),
        pullRequest,
        qaReport: toQaMetadataArtifact(qaReport),
        spec: toMetadataArtifact(spec),
        targetBranch,
      },
      "task metadata read model",
      { taskId: row.id },
    );
  });
