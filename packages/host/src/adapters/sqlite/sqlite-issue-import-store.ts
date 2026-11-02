import { sqliteValues } from "./sqlite-parameters";
import type { SourceIssueReference } from "@openducktor/contracts";
import { and, eq, inArray, ne } from "drizzle-orm";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { TaskRecord } from "../../ports/task-repository-ports";
import type { IssueImportStorePort } from "../../ports/issue-import-store-port";
import { recordCommittedTaskMutation } from "../../ports/task-status-changes";
import { commitTaskMutation } from "./sqlite-task-mutation";
import { getTaskRecord } from "./sqlite-task-card-read-model";
import { insertTaskFromCreateInput } from "./sqlite-task-create";
import type { SqliteTaskRepositoryContextProvider } from "./sqlite-task-repository-context";
import { type HostDatabaseSession, taskIssueLinks, tasks } from "./sqlite-host-database-schema";

const linkedTask = (
  session: HostDatabaseSession,
  workspaceId: string,
  source: SourceIssueReference,
) =>
  session
    .execute(
      (db) =>
        db
          .select({ id: taskIssueLinks.taskId })
          .from(taskIssueLinks)
          .where(
            and(
              eq(taskIssueLinks.workspaceId, workspaceId),
              eq(taskIssueLinks.providerId, source.providerId),
              eq(taskIssueLinks.providerScope, source.scope),
              eq(taskIssueLinks.externalId, source.sourceId),
            ),
          )
          .limit(1),
      "sqliteIssueImportStore.linkedTask",
    )
    .pipe(Effect.map((rows) => rows[0]?.id));

export const createSqliteIssueImportStore = ({
  contextProvider: withDatabase,
  now = () => new Date(),
}: {
  contextProvider: SqliteTaskRepositoryContextProvider;
  now?: () => Date;
}): IssueImportStorePort => {
  return {
    getSourceIssue: (input) =>
      withDatabase(input, "sqliteIssueImportStore.getSourceIssue", ({ session, workspaceId }) =>
        session
          .execute(
            (db) =>
              db
                .select({
                  providerId: taskIssueLinks.providerId,
                  scope: taskIssueLinks.providerScope,
                  sourceId: taskIssueLinks.externalId,
                  number: taskIssueLinks.displayNumber,
                  url: taskIssueLinks.url,
                  description: tasks.description,
                })
                .from(taskIssueLinks)
                .innerJoin(
                  tasks,
                  and(
                    eq(tasks.workspaceId, taskIssueLinks.workspaceId),
                    eq(tasks.id, taskIssueLinks.taskId),
                  ),
                )
                .where(
                  and(
                    eq(taskIssueLinks.workspaceId, workspaceId),
                    eq(taskIssueLinks.taskId, input.taskId),
                  ),
                )
                .limit(1),
            "sqliteIssueImportStore.getSourceIssue.query",
          )
          .pipe(Effect.map((rows) => rows[0])),
      ),
    findLinkedTaskIds: (input) =>
      input.sourceIds.length === 0
        ? Effect.succeed({})
        : withDatabase(
            input,
            "sqliteIssueImportStore.findLinkedTaskIds",
            ({ session, workspaceId }) =>
              session
                .execute(
                  (db) =>
                    db
                      .select({ id: taskIssueLinks.taskId, sourceId: taskIssueLinks.externalId })
                      .from(taskIssueLinks)
                      .where(
                        and(
                          eq(taskIssueLinks.workspaceId, workspaceId),
                          eq(taskIssueLinks.providerId, input.providerId),
                          eq(taskIssueLinks.providerScope, input.scope),
                          inArray(taskIssueLinks.externalId, sqliteValues(input.sourceIds)),
                        ),
                      ),
                  "sqliteIssueImportStore.findLinkedTaskIds.query",
                )
                .pipe(
                  Effect.map((rows) =>
                    Object.fromEntries(rows.map((row) => [row.sourceId, row.id])),
                  ),
                ),
          ),
    findSourceScopes: (input) =>
      input.sourceIds.length === 0
        ? Effect.succeed([])
        : withDatabase(
            input,
            "sqliteIssueImportStore.findSourceScopes",
            ({ session, workspaceId }) =>
              session
                .execute(
                  (db) =>
                    db
                      .selectDistinct({ scope: taskIssueLinks.providerScope })
                      .from(taskIssueLinks)
                      .where(
                        and(
                          eq(taskIssueLinks.workspaceId, workspaceId),
                          eq(taskIssueLinks.providerId, input.providerId),
                          ne(taskIssueLinks.providerScope, input.scope),
                          inArray(taskIssueLinks.externalId, sqliteValues(input.sourceIds)),
                        ),
                      ),
                  "sqliteIssueImportStore.findSourceScopes.query",
                )
                .pipe(Effect.map((rows) => rows.map(({ scope }) => scope))),
          ),
    replaceSourceScope(input) {
      if (input.sourceIds.length === 0 || input.oldScope === input.scope) return Effect.void;
      return withDatabase(input, "sqliteIssueImportStore.replaceSourceScope", (context) =>
        context.session.transaction("sqliteIssueImportStore.replaceSourceScope", (session) =>
          Effect.gen(function* () {
            const old = and(
              eq(taskIssueLinks.workspaceId, context.workspaceId),
              eq(taskIssueLinks.providerId, input.providerId),
              eq(taskIssueLinks.providerScope, input.oldScope),
              inArray(taskIssueLinks.externalId, sqliteValues(input.sourceIds)),
            );
            const oldRows = yield* session.execute(
              (db) =>
                db
                  .select({ taskId: taskIssueLinks.taskId, sourceId: taskIssueLinks.externalId })
                  .from(taskIssueLinks)
                  .where(old),
              "sqliteIssueImportStore.replaceSourceScope.oldRows",
            );
            if (oldRows.length === 0) return undefined;
            const collisions = yield* session.execute(
              (db) =>
                db
                  .select({ taskId: taskIssueLinks.taskId })
                  .from(taskIssueLinks)
                  .where(
                    and(
                      eq(taskIssueLinks.workspaceId, context.workspaceId),
                      eq(taskIssueLinks.providerId, input.providerId),
                      eq(taskIssueLinks.providerScope, input.scope),
                      inArray(
                        taskIssueLinks.externalId,
                        sqliteValues(oldRows.map((row) => row.sourceId)),
                      ),
                    ),
                  ),
              "sqliteIssueImportStore.replaceSourceScope.collisions",
            );
            if (collisions.length > 0)
              return yield* new HostValidationError({
                field: "sourceScope",
                message:
                  "Two Tasks are linked to the same GitHub Issue. Remove one linked Task before importing again.",
              });
            yield* session.execute(
              (db) => db.update(taskIssueLinks).set({ providerScope: input.scope }).where(old),
              "sqliteIssueImportStore.replaceSourceScope.update",
            );
            yield* session.afterCommit(
              recordCommittedTaskMutation({
                taskIds: oldRows.map((row) => row.taskId),
                removedTaskIds: [],
                artifactChanges: [],
              }),
            );
          }),
        ),
      );
    },
    createImportedTask: (input) =>
      withDatabase(input, "sqliteIssueImportStore.createImportedTask", (context) =>
        commitTaskMutation<
          { outcome: "created"; task: TaskRecord } | { outcome: "duplicate"; taskId: string },
          unknown
        >(context, "sqliteIssueImportStore.createImportedTask", (session) =>
          Effect.gen(function* () {
            const existing = yield* linkedTask(session, context.workspaceId, input.sourceIssue);
            if (existing) return { value: { outcome: "duplicate" as const, taskId: existing } };
            const taskId = yield* insertTaskFromCreateInput({
              createdAt: now(),
              session,
              status: input.status,
              task: input.task,
              workspaceId: context.workspaceId,
            });
            yield* session.execute(
              (db) =>
                db.insert(taskIssueLinks).values({
                  workspaceId: context.workspaceId,
                  taskId,
                  providerId: input.sourceIssue.providerId,
                  providerScope: input.sourceIssue.scope,
                  externalId: input.sourceIssue.sourceId,
                  displayNumber: input.sourceIssue.number,
                  url: input.sourceIssue.url,
                }),
              "sqliteIssueImportStore.createImportedTask.link",
            );
            const task = yield* getTaskRecord(
              session,
              context.workspaceId,
              taskId,
              input.repoPath,
              context.taskWorkflows,
            );
            return { value: { outcome: "created" as const, task }, taskId };
          }),
        ),
      ),
  };
};
