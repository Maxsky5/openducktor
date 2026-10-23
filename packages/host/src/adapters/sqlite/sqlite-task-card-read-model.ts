import {
  gitTargetBranchSchema,
  pullRequestSchema,
  sourceIssueReferenceSchema,
  type TaskCard,
  type TaskArtifactSummary,
  taskCardSchema,
} from "@openducktor/contracts";
import { type SQL, inArray, gte, ne, or } from "drizzle-orm";
import { Effect } from "effect";
import { deriveAvailableActions } from "../../domain/task/task-action-policy";
import type { TaskStoreListTasksInput } from "../../ports/task-repository-ports";
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

export const getTaskCard = (
  session: TaskStoreSession,
  taskId: string,
  repoPath: string,
): Effect.Effect<TaskCard, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const row = yield* requireTaskRow(session, taskId, repoPath);
    return yield* rowToTaskCard(session, row);
  });

export const findTaskCard = (
  session: TaskStoreSession,
  taskId: string,
): Effect.Effect<TaskCard | null, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const row = yield* getTaskRow(session, taskId);
    return row === null ? null : yield* rowToTaskCard(session, row);
  });

export const listTasksInDatabase = (
  session: TaskStoreSession,
  input: TaskStoreListTasksInput,
  now: () => Date,
): Effect.Effect<TaskCard[], SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    if (input.taskIds !== undefined) {
      return yield* readChangedCards(session, input.taskIds, input.doneVisibleDays, now);
    }
    let where: SQL | undefined;
    if (input.doneVisibleDays !== undefined) {
      const cutoff = new Date(now().getTime() - input.doneVisibleDays * 24 * 60 * 60 * 1000);
      where =
        input.doneVisibleDays > 0
          ? or(ne(tasks.status, "closed"), gte(tasks.updatedAt, cutoff))
          : ne(tasks.status, "closed");
    }
    const rows = yield* taskRows(session, where);
    const summaries = yield* artifactSummariesByTaskId(
      session,
      rows.map((row) => row.id),
    );
    const cards = yield* Effect.forEach(rows, (row) =>
      rowToTaskCard(session, row, summaries.get(row.id)),
    );
    return finalizeTaskCards(cards);
  });

/** Read full cards for changed tasks and parents, but only child fields needed for actions. */
const readChangedCards = (
  session: TaskStoreSession,
  taskIds: readonly string[],
  doneVisibleDays: number | undefined,
  now: () => Date,
): Effect.Effect<TaskCard[], SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    if (taskIds.length === 0) return [];
    const changedRows = yield* taskRows(session, inArray(tasks.id, [...taskIds]));
    const cardIds = [
      ...new Set([
        ...taskIds,
        ...changedRows.flatMap((row) => (row.parentId ? [row.parentId] : [])),
      ]),
    ];
    const rows = yield* taskRows(session, inArray(tasks.id, cardIds));
    const children = yield* session.execute(
      (database) =>
        database
          .select({
            id: tasks.id,
            parentId: tasks.parentId,
            status: tasks.status,
            updatedAt: tasks.updatedAt,
          })
          .from(tasks)
          .where(inArray(tasks.parentId, cardIds)),
      "sqliteTaskStore.listChangedCards.selectChildren",
    );
    const summaries = yield* artifactSummariesByTaskId(session, cardIds);
    const cards = yield* Effect.forEach(rows, (row) =>
      rowToTaskCard(session, row, summaries.get(row.id)),
    );
    const cutoff =
      doneVisibleDays === undefined ? null : now().getTime() - doneVisibleDays * 86400000;
    const childStatuses = children.map((child) => ({
      id: child.id,
      status: child.status,
      parentId: child.parentId ?? undefined,
    }));
    return cards.map((card) => ({
      ...card,
      subtaskIds: children
        .filter(
          (child) =>
            child.parentId === card.id &&
            (cutoff === null ||
              child.status !== "closed" ||
              (doneVisibleDays! > 0 && child.updatedAt.getTime() >= cutoff)),
        )
        .map((child) => child.id)
        .sort(),
      availableActions: deriveAvailableActions(card, childStatuses),
    }));
  });

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
  savedSummary?: TaskArtifactSummary,
): Effect.Effect<TaskCard, SqliteTaskStoreReadError> =>
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
    const summary = savedSummary ?? (yield* artifactSummary(session, row.id));
    const taskCard: TaskCard = {
      aiReviewEnabled: row.qaRequired === 1,
      agentWorkflows: {
        spec: { required: false, canSkip: true, available: false, completed: false },
        planner: { required: false, canSkip: true, available: false, completed: false },
        builder: { required: true, canSkip: false, available: false, completed: false },
        qa: { required: false, canSkip: true, available: false, completed: false },
      },
      availableActions: [],
      createdAt: row.createdAt.toISOString(),
      description: row.description ?? "",
      artifactSummary: summary,
      id: row.id,
      issueType: row.issueType,
      labels,
      parentId: row.parentId ?? undefined,
      priority: row.priority,
      pullRequest,
      sourceIssue,
      status: row.status,
      subtaskIds: [],
      targetBranch,
      title: row.title,
      updatedAt: row.updatedAt.toISOString(),
    };
    return yield* validateWithSchema(taskCardSchema, taskCard, "task card read model", {
      taskId: row.id,
    });
  });
