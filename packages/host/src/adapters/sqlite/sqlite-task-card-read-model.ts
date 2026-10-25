import {
  gitTargetBranchSchema,
  pullRequestSchema,
  sourceIssueReferenceSchema,
  type TaskArtifactSummary,
  taskCardSchema,
} from "@openducktor/contracts";
import { type SQL, inArray, gte, or, notInArray } from "drizzle-orm";
import type { TaskWorkflow } from "@openducktor/workflows";
import { Effect } from "effect";
import type { TaskRecord, TaskStoreListTasksInput } from "../../ports/task-repository-ports";
import {
  decodeWithSchema,
  labelsFromRow,
  optionalJsonFromRow,
  validateWithSchema,
} from "./sqlite-json-codecs";
import {
  artifactSummariesByTaskId,
  artifactSummary,
} from "./sqlite-task-workflow-artifact-queries";
import { getTaskRow, requireTaskRow, taskRows } from "./sqlite-task-queries";
import type { SqliteTaskStoreReadError } from "./sqlite-task-store-errors";
import { type TaskRow, type TaskStoreSession, tasks } from "./sqlite-task-store-schema";

const taskRecordSchema = taskCardSchema.omit({ availableActions: true, agentWorkflows: true });

export const getTaskRecord = (
  session: TaskStoreSession,
  taskId: string,
  repoPath: string,
  workflow: TaskWorkflow,
): Effect.Effect<TaskRecord, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const row = yield* requireTaskRow(session, taskId, repoPath);
    return yield* rowToTaskRecord(session, row, workflow);
  });

export const findTaskRecord = (
  session: TaskStoreSession,
  taskId: string,
  workflow: TaskWorkflow,
): Effect.Effect<TaskRecord | null, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const row = yield* getTaskRow(session, taskId);
    return row === null ? null : yield* rowToTaskRecord(session, row, workflow);
  });

/** A Kanban list hides tasks in terminal states after the done visible days. */
export const listTasksInDatabase = (
  session: TaskStoreSession,
  input: TaskStoreListTasksInput,
  now: () => Date,
  workflow: TaskWorkflow,
): Effect.Effect<TaskRecord[], SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    if (input.taskIds !== undefined) {
      return yield* readChangedCards(session, input.taskIds, workflow);
    }
    let where: SQL | undefined;
    if (input.doneVisibleDays !== undefined) {
      const cutoff = new Date(now().getTime() - input.doneVisibleDays * 24 * 60 * 60 * 1000);
      const open = notInArray(tasks.status, [...workflow.terminalStates]);
      where = input.doneVisibleDays > 0 ? or(open, gte(tasks.updatedAt, cutoff)) : open;
    }
    const rows = yield* taskRows(session, where);
    const summaries = yield* artifactSummariesByTaskId(
      session,
      rows.map((row) => row.id),
      workflow,
    );
    const cards = yield* Effect.forEach(rows, (row) =>
      rowToTaskRecord(session, row, workflow, summaries.get(row.id)),
    );
    return cards;
  });

/** Read full cards for changed tasks. */
const readChangedCards = (
  session: TaskStoreSession,
  taskIds: readonly string[],
  workflow: TaskWorkflow,
): Effect.Effect<TaskRecord[], SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    if (taskIds.length === 0) return [];
    const rows = yield* taskRows(session, inArray(tasks.id, [...taskIds]));
    const summaries = yield* artifactSummariesByTaskId(
      session,
      rows.map((row) => row.id),
      workflow,
    );
    const cards = yield* Effect.forEach(rows, (row) =>
      rowToTaskRecord(session, row, workflow, summaries.get(row.id)),
    );
    return cards;
  });

const rowToTaskRecord = (
  session: TaskStoreSession,
  row: TaskRow,
  workflow: TaskWorkflow,
  savedSummary?: TaskArtifactSummary,
): Effect.Effect<TaskRecord, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const targetBranch = yield* optionalJsonFromRow(row, "targetBranchJson", (value) =>
      decodeWithSchema(gitTargetBranchSchema, value, "target_branch_json", { taskId: row.id }),
    );
    const pullRequest = yield* optionalJsonFromRow(row, "pullRequestJson", (value) =>
      decodeWithSchema(pullRequestSchema, value, "pull_request_json", { taskId: row.id }),
    );
    const sourceIssue =
      row.sourceProviderId === null
        ? undefined
        : yield* validateWithSchema(
            sourceIssueReferenceSchema,
            {
              providerId: row.sourceProviderId,
              scope: row.sourceScope,
              sourceId: row.sourceId,
              number: row.sourceNumber,
              url: row.sourceUrl,
            },
            "source issue reference",
            { taskId: row.id },
          );
    const labels = yield* labelsFromRow(row);
    const summary = savedSummary ?? (yield* artifactSummary(session, row.id, workflow));
    const taskCard: TaskRecord = {
      createdAt: row.createdAt.toISOString(),
      description: row.description ?? "",
      artifactSummary: summary,
      id: row.id,
      issueType: row.issueType,
      labels,
      priority: row.priority,
      pullRequest,
      sourceIssue,
      status: row.status,
      targetBranch,
      title: row.title,
      updatedAt: row.updatedAt.toISOString(),
    };
    return yield* validateWithSchema(taskRecordSchema, taskCard, "task card read model", {
      taskId: row.id,
    });
  });
