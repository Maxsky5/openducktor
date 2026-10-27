import {
  directMergeRecordSchema,
  gitTargetBranchSchema,
  pullRequestSchema,
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
import type { TaskWorkflow } from "@openducktor/workflows";
import type { TaskRow, TaskStoreSession } from "./sqlite-task-store-schema";

const toIso = (value: Date | null): string | undefined => {
  if (value === null) {
    return undefined;
  }
  return value.toISOString();
};

const toMetadataArtifact = (row: WorkflowArtifactRow): TaskMetadataArtifact => {
  const artifact: TaskMetadataArtifact = {
    markdown: row.markdown,
    revision: row.revision,
    updatedAt: toIso(row.updatedAt),
  };
  if (row.verdict !== null) artifact.verdict = row.verdict;
  return artifact;
};

export const taskMetadata = (
  session: TaskStoreSession,
  row: TaskRow,
  workflow: TaskWorkflow,
): Effect.Effect<TaskMetadataPayload, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const artifacts: Record<string, TaskMetadataArtifact> = {};
    for (const { id: code } of workflow.definition.artifacts) {
      const artifactRow = yield* latestWorkflowArtifactRow(session, row.id, code);
      if (artifactRow) artifacts[code] = toMetadataArtifact(artifactRow);
    }
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
        artifacts,
        directMerge,
        pullRequest,
        targetBranch,
      },
      "task metadata read model",
      { taskId: row.id },
    );
  });
