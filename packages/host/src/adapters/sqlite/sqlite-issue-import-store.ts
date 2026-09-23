import type { SourceIssueReference } from "@openducktor/contracts";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import type { IssueImportStorePort } from "../../ports/issue-import-store-port";
import { getTaskCard } from "./sqlite-task-card-read-model";
import { taskInsertFromCreateInput } from "./sqlite-task-create";
import {
  firstTaskIdHashLength,
  taskIdCandidates,
  taskIdExhaustedError,
  taskIdPrefixForWorkspaceId,
} from "./sqlite-task-ids";
import type { SqliteTaskRepositoryContextProvider } from "./sqlite-task-repository-context";
import { type TaskStoreSession, tasks } from "./sqlite-task-store-schema";

const linkedTask = (session: TaskStoreSession, source: SourceIssueReference) =>
  session
    .execute(
      (database) =>
        database
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            and(
              eq(tasks.sourceProviderId, source.providerId),
              eq(tasks.sourceScope, source.scope),
              eq(tasks.sourceId, source.sourceId),
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
}): IssueImportStorePort => ({
  findLinkedTaskIds(input) {
    if (input.sourceIds.length === 0) return Effect.succeed({});
    return withDatabase(input.repoPath, "sqliteIssueImportStore.findLinkedTaskIds", ({ session }) =>
      session
        .execute(
          (database) =>
            database
              .select({ id: tasks.id, sourceId: tasks.sourceId })
              .from(tasks)
              .where(
                and(
                  eq(tasks.sourceProviderId, input.providerId),
                  eq(tasks.sourceScope, input.scope),
                  inArray(tasks.sourceId, input.sourceIds),
                ),
              ),
          "sqliteIssueImportStore.findLinkedTaskIds.query",
        )
        .pipe(
          Effect.map((rows) =>
            Object.fromEntries(
              rows.flatMap((row) => (row.sourceId === null ? [] : [[row.sourceId, row.id]])),
            ),
          ),
        ),
    );
  },
  createImportedTask(input) {
    return withDatabase(
      input.repoPath,
      "sqliteIssueImportStore.createImportedTask",
      ({ session, workspaceId }) =>
        session.transaction("sqliteIssueImportStore.createImportedTask", (transaction) =>
          Effect.gen(function* () {
            const existing = yield* linkedTask(transaction, input.sourceIssue);
            if (existing) return { outcome: "duplicate" as const, taskId: existing };
            const createdAt = now();
            const prefix = taskIdPrefixForWorkspaceId(workspaceId);
            const firstLength = yield* firstTaskIdHashLength(transaction, prefix);
            const candidates = taskIdCandidates({
              createdAt,
              description: input.task.description,
              firstLength,
              prefix,
              title: input.task.title,
            });
            for (const taskId of candidates) {
              const row = {
                ...taskInsertFromCreateInput(input.task, taskId, createdAt),
                sourceProviderId: input.sourceIssue.providerId,
                sourceScope: input.sourceIssue.scope,
                sourceId: input.sourceIssue.sourceId,
                sourceNumber: input.sourceIssue.number,
                sourceUrl: input.sourceIssue.url,
              };
              const inserted = yield* transaction.execute(
                (database) =>
                  database
                    .insert(tasks)
                    .values(row)
                    .onConflictDoNothing()
                    .returning({ id: tasks.id }),
                "sqliteIssueImportStore.createImportedTask.insert",
                { taskId },
              );
              if (inserted.length > 0) {
                const task = yield* getTaskCard(transaction, taskId, input.repoPath);
                return { outcome: "created" as const, task };
              }
              const concurrent = yield* linkedTask(transaction, input.sourceIssue);
              if (concurrent) return { outcome: "duplicate" as const, taskId: concurrent };
            }
            return yield* taskIdExhaustedError(prefix);
          }),
        ),
    );
  },
});
