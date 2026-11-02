import { and, eq, notInArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import type { TaskSearchInput } from "../../ports/task-repository-ports";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import { listTasksInDatabase } from "./sqlite-task-card-read-model";
import { hostTerminalStates } from "./sqlite-task-repository-context";
import { tasks, type HostDatabaseSession } from "./sqlite-host-database-schema";

export const searchTasksInDatabase = (
  session: HostDatabaseSession,
  workspaceId: string,
  input: TaskSearchInput,
  taskWorkflows: TaskWorkflowResolver,
) =>
  Effect.gen(function* () {
    const tags = input.tags?.map(searchKey) ?? [];
    // A state can be terminal in one workflow and active in another.
    const terminalStates = hostTerminalStates(taskWorkflows).filter((state) =>
      taskWorkflows.workflows.every((workflow) => workflow.isTerminalState(state)),
    );
    const rows = yield* session.execute(
      (db) =>
        db
          .select({
            id: tasks.id,
            title: tasks.title,
            updatedAt: tasks.updatedAt,
            status: tasks.status,
            issueType: tasks.issueType,
            labels:
              tags.length === 0
                ? sql<null>`null`
                : sql<
                    string[]
                  >`(select json_group_array(label) from task_labels where workspace_id = ${tasks.workspaceId} and task_id = ${tasks.id})`.mapWith(
                    JSON.parse,
                  ),
          })
          .from(tasks)
          .where(
            and(
              eq(tasks.workspaceId, workspaceId),
              notInArray(tasks.status, terminalStates),
              input.priority === undefined ? undefined : eq(tasks.priority, input.priority),
              input.issueType === undefined ? undefined : eq(tasks.issueType, input.issueType),
              input.status === undefined ? undefined : eq(tasks.status, input.status),
            ),
          ),
      "sqliteTaskStore.searchTasks.selectCandidates",
    );
    const title = input.title === undefined ? undefined : searchKey(input.title);
    const matches = rows
      .filter((task) => {
        if (taskWorkflows.forTask(task).isTerminalState(task.status)) return false;
        if (title !== undefined && !searchKey(task.title).includes(title)) return false;
        if (tags.length === 0) return true;
        const labels = new Set(task.labels!.map(searchKey));
        return tags.every((tag) => labels.has(tag));
      })
      .map((task) => ({ id: task.id, updatedAt: task.updatedAt.toISOString() }));
    matches.sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
    );
    const selected = matches.slice(0, input.limit);
    const cards = yield* listTasksInDatabase(
      session,
      workspaceId,
      { ...input, taskIds: selected.map(({ id }) => id) },
      () => new Date(),
      taskWorkflows,
    );
    const byId = new Map(cards.map((card) => [card.id, card]));
    return { tasks: selected.map(({ id }) => byId.get(id)!), totalCount: matches.length };
  });

const searchKey = (value: string): string => value.trim().toLowerCase();
