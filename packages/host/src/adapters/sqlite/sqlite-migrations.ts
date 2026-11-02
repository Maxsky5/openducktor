import { sql } from "drizzle-orm";
import { type MigrationMeta, readMigrationFiles } from "drizzle-orm/migrator";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import { Effect, Exit } from "effect";
import { z } from "zod";
import { HostOperationError, type HostOperationErrorAggregate } from "../../effect/host-errors";
import type { SqliteDrizzleSession } from "../../infrastructure/sqlite/sqlite-drizzle-client";

const historySchema = z.array(z.tuple([z.string(), z.number()]));

const setForeignKeys = <TSchema extends Record<string, AnySQLiteTable>, TransactionError>(
  session: SqliteDrizzleSession<TSchema, TransactionError>,
  enabled: boolean,
) =>
  session.execute(
    (database) => database.run(sql.raw(`PRAGMA foreign_keys = ${enabled ? "ON" : "OFF"}`)),
    "sqliteMigrations.setForeignKeys",
  );

/**
 * A migration that rebuilds a parent table drops it, and SQLite cascades that drop to child rows
 * while foreign keys are on. The pragma has no effect inside a transaction, so it changes around
 * the migration transaction, as the SQLite schema change procedure requires.
 */
const migrateWithoutForeignKeys = <
  TSchema extends Record<string, AnySQLiteTable>,
  TransactionError,
  E,
>(
  session: SqliteDrizzleSession<TSchema, TransactionError>,
  migrate: Effect.Effect<void, E>,
): Effect.Effect<void, E | HostOperationErrorAggregate> =>
  Effect.gen(function* () {
    yield* setForeignKeys(session, false);
    const migrated = yield* Effect.exit(migrate);
    yield* setForeignKeys(session, true);
    if (Exit.isFailure(migrated)) return yield* Effect.failCause(migrated.cause);
  });

const migrationFailure = (databasePath: string, message: string, cause?: unknown) =>
  new HostOperationError({
    operation: "sqliteMigrations.apply",
    message,
    cause,
    details: { databasePath },
  });

/**
 * How a database history selects the pending migrations.
 *
 * - `exact`: every applied row matches the file at its position. The host database uses it.
 * - `lastApplied`: the drizzle migrator rule that `main` used for workspace task stores. Files
 *   newer than the last applied date run. `main` deleted released migrations, so a legacy store
 *   can hold rows that have no file. A history newer than every file comes from a newer version.
 */
export type MigrationHistoryRule = "exact" | "lastApplied";

const unsupportedHistory = (databasePath: string, cause?: unknown) =>
  migrationFailure(
    databasePath,
    "The database schema does not match this OpenDucktor version. Use a compatible version or restore a compatible backup with all hosts stopped.",
    cause,
  );

/** Rejects a history that this version does not know, then returns the migrations to apply. */
const readPendingMigrations = <TSchema extends Record<string, AnySQLiteTable>, TransactionError>(
  transaction: SqliteDrizzleSession<TSchema, TransactionError>,
  migrations: readonly MigrationMeta[],
  databasePath: string,
  rule: MigrationHistoryRule,
) =>
  Effect.gen(function* () {
    const tables = yield* transaction.execute(
      (db) =>
        db.values<[string]>(
          sql`SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
        ),
      "sqliteMigrations.readTables",
    );
    if (!tables.some(([name]) => name === "__drizzle_migrations")) {
      if (tables.length > 0)
        return yield* migrationFailure(
          databasePath,
          "The database has tables but no supported migration history.",
        );
      yield* transaction.execute(
        (db) =>
          db.run(
            sql`CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC NOT NULL)`,
          ),
        "sqliteMigrations.createHistory",
      );
      return migrations;
    }
    const rows = yield* transaction.execute(
      (db) =>
        db.values(sql`SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at, id`),
      "sqliteMigrations.readHistory",
    );
    const history = historySchema.safeParse(rows);
    if (!history.success) return yield* unsupportedHistory(databasePath, history.error);
    if (rule === "lastApplied") {
      const lastApplied = history.data.at(-1)?.[1];
      if (lastApplied === undefined) return migrations;
      if (lastApplied > (migrations.at(-1)?.folderMillis ?? 0))
        return yield* unsupportedHistory(databasePath);
      return migrations.filter((migration) => migration.folderMillis > lastApplied);
    }
    if (
      history.data.length > migrations.length ||
      history.data.some(
        ([hash, createdAt], index) =>
          migrations[index]?.hash !== hash || migrations[index]?.folderMillis !== createdAt,
      )
    )
      return yield* unsupportedHistory(databasePath);
    return migrations.slice(history.data.length);
  });

/**
 * Applies the pending files of `migrationsFolder` in one transaction and records each one as the
 * drizzle migrator does. A broken reference fails the transaction before commit.
 */
export const applyMigrations = <TSchema extends Record<string, AnySQLiteTable>, TransactionError>(
  session: SqliteDrizzleSession<TSchema, TransactionError>,
  migrationsFolder: string,
  databasePath: string,
  rule: MigrationHistoryRule,
): Effect.Effect<void, HostOperationErrorAggregate | TransactionError> =>
  Effect.gen(function* () {
    const migrations = yield* Effect.try({
      try: () => readMigrationFiles({ migrationsFolder }),
      catch: (cause) =>
        new HostOperationError({
          operation: "sqliteMigrations.read",
          message:
            "The database migrations are unavailable. Reinstall OpenDucktor before retrying.",
          cause,
          details: { databasePath, migrationsFolder },
        }),
    });
    yield* migrateWithoutForeignKeys(
      session,
      session.transaction("sqliteMigrations.apply", (transaction) =>
        Effect.gen(function* () {
          const pending = yield* readPendingMigrations(transaction, migrations, databasePath, rule);
          if (pending.length === 0) return;
          for (const migration of pending) {
            for (const query of migration.sql)
              yield* transaction.execute(
                (db) => db.run(sql.raw(query)),
                "sqliteMigrations.applyMigration",
              );
            yield* transaction.execute(
              (db) =>
                db.run(
                  sql`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`,
                ),
              "sqliteMigrations.recordMigration",
            );
          }
          const violations = yield* transaction.execute(
            (db) => db.all(sql`PRAGMA foreign_key_check`),
            "sqliteMigrations.checkForeignKeys",
          );
          if (violations.length > 0)
            return yield* migrationFailure(
              databasePath,
              `The database migration would leave ${violations.length} rows with a broken reference. Keep the original data and report this migration failure.`,
            );
        }),
      ),
    );
  });
