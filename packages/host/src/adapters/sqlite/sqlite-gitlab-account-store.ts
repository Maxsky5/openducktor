import type { GitlabAccount, GitlabAuthKind } from "@openducktor/contracts";
import { and, eq, inArray, isNotNull, notExists } from "drizzle-orm";
import { Effect } from "effect";
import { type HostError, isHostError, toHostOperationError } from "../../effect/host-errors";
import type { SqliteDrizzleExecutor } from "../../infrastructure/sqlite/sqlite-drizzle-client";
import type { hostDatabaseSchema } from "./sqlite-host-database-schema";
import { gitlabAccounts, workspaceGitlabConfig } from "./sqlite-host-settings-schema";
import type { SqliteHostDatabaseManager } from "./sqlite-task-repository-context";

const operation = "gitlabAccounts";

export type GitlabAccountFields = {
  instanceUrl: string;
  userId: number;
  username: string;
  displayName: string;
  authKind: GitlabAuthKind;
  tokenExpiresAt: string | null;
};

/** Saved GitLab account metadata. The secrets stay in the OS secure store. */
export type GitlabAccountStore = {
  listByInstance(instanceUrl: string): Effect.Effect<GitlabAccount[], HostError>;
  get(accountId: string): Effect.Effect<GitlabAccount | null, HostError>;
  /** The saved account of this GitLab user on this instance. */
  findByUser(instanceUrl: string, userId: number): Effect.Effect<GitlabAccount | null, HostError>;
  /**
   * Saves the account of this GitLab user on this instance. A new account gets `accountId`. An
   * existing account keeps its ID.
   */
  upsert(fields: GitlabAccountFields, accountId: string): Effect.Effect<GitlabAccount, HostError>;
  /** Deletes the account row. A workspace link blocks the delete. */
  delete(accountId: string): Effect.Effect<void, HostError>;
  /** The accounts, among the candidates or all of them, that no workspace links. */
  listUnreferenced(candidates?: readonly string[]): Effect.Effect<string[], HostError>;
  /** The instance URLs of saved accounts and configured GitLab projects. */
  listKnownInstances(): Effect.Effect<string[], HostError>;
};

type AccountRow = typeof gitlabAccounts.$inferSelect;
type HostDatabaseExecutor = SqliteDrizzleExecutor<typeof hostDatabaseSchema>;

const toAccount = (row: AccountRow): GitlabAccount => ({
  accountId: row.accountId,
  instanceUrl: row.instanceUrl,
  userId: row.userId,
  username: row.username,
  displayName: row.displayName,
  authKind: row.authKind,
  tokenExpiresAt: row.tokenExpiresAt === null ? null : new Date(row.tokenExpiresAt).toISOString(),
});

export const createSqliteGitlabAccountStore = (
  database: Pick<SqliteHostDatabaseManager, "withHostDatabase">,
): GitlabAccountStore => {
  /** Runs one query on the host database. */
  const query = <A>(
    run: (db: HostDatabaseExecutor) => PromiseLike<A>,
  ): Effect.Effect<A, HostError> =>
    database
      .withHostDatabase(operation, (session) => session.execute(run, operation))
      .pipe(
        Effect.mapError((cause) =>
          isHostError(cause) ? cause : toHostOperationError(cause, operation),
        ),
      );
  const firstAccount = (rows: AccountRow[]) => (rows[0] ? toAccount(rows[0]) : null);

  return {
    listByInstance: (instanceUrl) =>
      query((db) =>
        db
          .select()
          .from(gitlabAccounts)
          .where(eq(gitlabAccounts.instanceUrl, instanceUrl))
          .orderBy(gitlabAccounts.username),
      ).pipe(Effect.map((rows) => rows.map(toAccount))),
    get: (accountId) =>
      query((db) =>
        db.select().from(gitlabAccounts).where(eq(gitlabAccounts.accountId, accountId)),
      ).pipe(Effect.map(firstAccount)),
    findByUser: (instanceUrl, userId) =>
      query((db) =>
        db
          .select()
          .from(gitlabAccounts)
          .where(
            and(eq(gitlabAccounts.instanceUrl, instanceUrl), eq(gitlabAccounts.userId, userId)),
          ),
      ).pipe(Effect.map(firstAccount)),
    upsert: (fields, accountId) => {
      const now = Date.now();
      const values = {
        username: fields.username,
        displayName: fields.displayName,
        authKind: fields.authKind,
        tokenExpiresAt: fields.tokenExpiresAt === null ? null : Date.parse(fields.tokenExpiresAt),
        updatedAt: now,
      };
      return query((db) =>
        db
          .insert(gitlabAccounts)
          .values({
            accountId,
            instanceUrl: fields.instanceUrl,
            userId: fields.userId,
            createdAt: now,
            ...values,
          })
          .onConflictDoUpdate({
            target: [gitlabAccounts.instanceUrl, gitlabAccounts.userId],
            set: values,
          })
          .returning(),
      ).pipe(Effect.map((rows) => toAccount(rows[0]!)));
    },
    delete: (accountId) =>
      query((db) => db.delete(gitlabAccounts).where(eq(gitlabAccounts.accountId, accountId))).pipe(
        Effect.asVoid,
      ),
    listUnreferenced: (candidates) =>
      query((db) =>
        db
          .select({ accountId: gitlabAccounts.accountId })
          .from(gitlabAccounts)
          .where(
            and(
              candidates === undefined
                ? undefined
                : inArray(gitlabAccounts.accountId, [...candidates]),
              notExists(
                db
                  .select({ accountId: workspaceGitlabConfig.accountId })
                  .from(workspaceGitlabConfig)
                  .where(eq(workspaceGitlabConfig.accountId, gitlabAccounts.accountId)),
              ),
            ),
          ),
      ).pipe(Effect.map((rows) => rows.map((row) => row.accountId))),
    listKnownInstances: () =>
      query((db) =>
        Promise.all([
          db.selectDistinct({ instanceUrl: gitlabAccounts.instanceUrl }).from(gitlabAccounts),
          db
            .selectDistinct({ instanceUrl: workspaceGitlabConfig.instanceUrl })
            .from(workspaceGitlabConfig)
            .where(isNotNull(workspaceGitlabConfig.instanceUrl)),
        ]),
      ).pipe(
        Effect.map(([accounts, projects]) => [
          ...new Set(
            [...accounts, ...projects].flatMap(({ instanceUrl }) =>
              instanceUrl === null ? [] : [instanceUrl],
            ),
          ),
        ]),
      ),
  };
};
