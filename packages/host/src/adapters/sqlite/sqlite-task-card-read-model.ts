import {
  gitTargetBranchSchema,
  pullRequestSchema,
  type TaskCard,
  type TaskDocumentSummary,
  taskCardSchema,
} from "@openducktor/contracts";
import { gte, ne, or } from "drizzle-orm";
import { Effect } from "effect";
import type { TaskStoreListTasksInput } from "../../ports/task-repository-ports";
import {
  agentSessionsFromRow,
  decodeWithSchema,
  labelsFromRow,
  optionalJsonFromRow,
} from "./sqlite-json-codecs";
import { documentSummariesByTaskId, documentSummary } from "./sqlite-task-document-queries";
import { requireTaskRow, taskRows } from "./sqlite-task-queries";
import type { SqliteTaskStoreReadError } from "./sqlite-task-store-errors";
import { type TaskRow, type TaskStoreSession, tasks } from "./sqlite-task-store-schema";

const finalizeTaskCards = (tasks: TaskCard[]): TaskCard[] => {
  const subtasksByParent = new Map<string, string[]>();
  for (const task of tasks) {
    if (task.parentId !== undefined) {
      const subtasks = subtasksByParent.get(task.parentId) ?? [];
      subtasks.push(task.id);
      subtasksByParent.set(task.parentId, subtasks);
    }
  }
  return tasks.map((task) => ({
    ...task,
    subtaskIds: [...(subtasksByParent.get(task.id) ?? [])].sort(),
  }));
};

const rowToTaskCard = (
  session: TaskStoreSession,
  row: TaskRow,
  documentSummaryOverride?: TaskDocumentSummary,
): Effect.Effect<TaskCard, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const targetBranch = yield* optionalJsonFromRow(row, "targetBranchJson", (value) =>
      decodeWithSchema(gitTargetBranchSchema, value, "target_branch_json", { taskId: row.id }),
    );
    const pullRequest = yield* optionalJsonFromRow(row, "pullRequestJson", (value) =>
      decodeWithSchema(pullRequestSchema, value, "pull_request_json", { taskId: row.id }),
    );
    const agentSessions = yield* agentSessionsFromRow(row);
    const labels = yield* labelsFromRow(row);
    const summary = documentSummaryOverride ?? (yield* documentSummary(session, row.id));
    return yield* decodeWithSchema(
      taskCardSchema,
      {
        agentSessions,
        aiReviewEnabled: row.qaRequired === 1,
        availableActions: [],
        createdAt: row.createdAt.toISOString(),
        description: row.description ?? "",
        documentSummary: summary,
        id: row.id,
        issueType: row.issueType,
        labels,
        parentId: row.parentId ?? undefined,
        priority: row.priority,
        pullRequest,
        status: row.status,
        subtaskIds: [],
        targetBranch,
        title: row.title,
        updatedAt: row.updatedAt.toISOString(),
      },
      "task card read model",
      { taskId: row.id },
    );
  });

export const getTaskCard = (
  session: TaskStoreSession,
  taskId: string,
  repoPath: string,
): Effect.Effect<TaskCard, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const row = yield* requireTaskRow(session, taskId, repoPath);
    return yield* rowToTaskCard(session, row);
  });

export const listTasksInDatabase = (
  session: TaskStoreSession,
  input: TaskStoreListTasksInput,
  now: () => Date,
): Effect.Effect<TaskCard[], SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    if (input.doneVisibleDays === undefined) {
      const rows = yield* taskRows(session);
      const summaries = yield* documentSummariesByTaskId(
        session,
        rows.map((row) => row.id),
      );
      const cards = yield* Effect.forEach(rows, (row) =>
        rowToTaskCard(session, row, summaries.get(row.id)),
      );
      return finalizeTaskCards(cards);
    }
    const cutoff = new Date(now().getTime() - input.doneVisibleDays * 24 * 60 * 60 * 1000);
    const where =
      input.doneVisibleDays > 0
        ? or(ne(tasks.status, "closed"), gte(tasks.updatedAt, cutoff))
        : ne(tasks.status, "closed");
    const rows = yield* taskRows(session, where);
    const summaries = yield* documentSummariesByTaskId(
      session,
      rows.map((row) => row.id),
    );
    const cards = yield* Effect.forEach(rows, (row) =>
      rowToTaskCard(session, row, summaries.get(row.id)),
    );
    return finalizeTaskCards(cards);
  });
