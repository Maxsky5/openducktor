import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { GlobalConfig } from "@openducktor/contracts";
import { eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import {
  HostOperationError,
  errorMessage,
  isPathNotFoundError,
  toHostOperationError,
} from "../../effect/host-errors";
import { openSqliteDatabase } from "../../infrastructure/sqlite/sqlite-driver";
import { openSqliteDrizzleConnection } from "../../infrastructure/sqlite/sqlite-drizzle-client";
import { HostDatabaseImportSourceError } from "./host-database-import-worker-protocol";
import { importHostSharedConfig } from "./sqlite-host-settings-store";
import { ensureLegacySchema } from "./sqlite-legacy-task-store-migrations";
import {
  legacyTaskStoreSchema,
  type LegacyTaskStoreSession,
} from "./sqlite-legacy-task-store-schema";
import { importLegacyWorkspaceTaskData } from "./sqlite-legacy-workspace-import";
import { hostMetadata, type HostDatabaseSession } from "./sqlite-host-database-schema";

const operation = "hostDatabase.import";
const migrationError = (sourcePath: string, cause: unknown) =>
  new HostDatabaseImportSourceError({
    sourcePath,
    message: `Cannot migrate ${sourcePath}. ${errorMessage(cause)} Correct the source error or restore a compatible backup, then restart all upgraded hosts. The original sources are unchanged.`,
    cause,
  });

const existingSource = (sourcePath: string) =>
  Effect.tryPromise({
    try: () => stat(sourcePath),
    catch: (cause) => toHostOperationError(cause, operation, { sourcePath }),
  }).pipe(
    Effect.map(() => true),
    Effect.catchTag("HostOperationError", (error) =>
      isPathNotFoundError(error.cause) ? Effect.succeed(false) : Effect.fail(error),
    ),
  );

const legacyTaskStorePath = (configRoot: string, workspaceId: string) =>
  path.join(configRoot, "task-stores", workspaceId, "database.sqlite");

/** Reports whether the import copies at least one registered legacy task store. */
export const hasLegacyTaskStores = (configRoot: string, config: GlobalConfig) =>
  Effect.gen(function* () {
    for (const workspaceId of Object.keys(config.workspaces))
      if (yield* existingSource(legacyTaskStorePath(configRoot, workspaceId))) return true;
    return false;
  });

/** Snapshots stay on the config root volume. A temporary directory can be small or held in memory. */
export const importSnapshotRoot = (configRoot: string) =>
  path.join(configRoot, ".host-database-import");

const withLegacySnapshot = <A, E>(
  snapshotRoot: string,
  sourcePath: string,
  use: (source: LegacyTaskStoreSession) => Effect.Effect<A, E>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => mkdtemp(path.join(snapshotRoot, "snapshot-")),
          catch: (cause) =>
            toHostOperationError(cause, "hostDatabase.createSnapshotFolder", {
              folderPath: snapshotRoot,
            }),
        }),
        (directory) =>
          Effect.tryPromise({
            try: () => rm(directory, { recursive: true, force: true }),
            catch: (cause) =>
              toHostOperationError(cause, "hostDatabase.removeTemporarySnapshot", { directory }),
          }).pipe(Effect.catch((error) => Effect.logWarning(error.message))),
      );
      const snapshotPath = path.join(directory, "database.sqlite");
      yield* Effect.acquireUseRelease(
        openSqliteDatabase(sourcePath, undefined, { readonly: true }),
        (database) =>
          Effect.acquireUseRelease(
            database.prepare("VACUUM INTO ?"),
            (statement) => statement.run(snapshotPath),
            (statement) => statement.close().pipe(Effect.orDie),
          ),
        (database) => database.close().pipe(Effect.orDie),
      );
      const copy = yield* openSqliteDrizzleConnection({
        databasePath: snapshotPath,
        configureWal: false,
        config: { schema: legacyTaskStoreSchema },
      });
      yield* ensureLegacySchema(copy.session, snapshotPath);
      const checks = yield* copy.session.execute(
        (db) => db.values(sql`PRAGMA quick_check`),
        operation,
      );
      yield* Effect.try({
        try: () =>
          z
            .array(z.tuple([z.literal("ok")]))
            .length(1)
            .parse(checks),
        catch: (cause) =>
          new HostOperationError({
            operation,
            message: `The database integrity check failed: ${errorMessage(cause)}`,
            cause,
          }),
      });
      return yield* use(copy.session);
    }),
  );

const readImportComplete = (session: HostDatabaseSession) =>
  session
    .execute(
      (db) =>
        db
          .select({ importComplete: hostMetadata.importComplete })
          .from(hostMetadata)
          .where(eq(hostMetadata.singletonId, 1)),
      operation,
    )
    .pipe(Effect.map(([metadata]) => metadata?.importComplete === true));

/** Reports whether startup still has to import legacy data. The import checks again under its lock. */
export const isHostDatabaseImportPending = (session: HostDatabaseSession) =>
  readImportComplete(session).pipe(Effect.map((complete) => !complete));

const removeSnapshotRoot = (snapshotRoot: string) =>
  Effect.tryPromise({
    try: () => rm(snapshotRoot, { recursive: true, force: true }),
    catch: (cause) =>
      new HostOperationError({
        operation,
        message: `Cannot remove the import folder ${snapshotRoot}. ${errorMessage(cause)} Remove it, then restart OpenDucktor.`,
        cause,
        details: { folderPath: snapshotRoot },
      }),
  });

/** The startup transaction owns the single completion marker and every imported row. */
export const importHostDatabase = ({
  session,
  configRoot,
  config,
}: {
  session: HostDatabaseSession;
  configRoot: string;
  config: GlobalConfig;
}) =>
  session.transaction(operation, (transaction) =>
    Effect.scoped(
      Effect.gen(function* () {
        if (yield* readImportComplete(transaction)) return;
        // The write lock is held, so no other host uses this folder. A stopped import can leave it.
        const snapshotRoot = importSnapshotRoot(configRoot);
        yield* removeSnapshotRoot(snapshotRoot);
        yield* Effect.tryPromise({
          try: () => mkdir(snapshotRoot, { recursive: true }),
          catch: (cause) =>
            new HostOperationError({
              operation,
              message: `Cannot create the import folder ${snapshotRoot}. ${errorMessage(cause)} Correct the folder permissions, then restart OpenDucktor.`,
              cause,
              details: { folderPath: snapshotRoot },
            }),
        });
        yield* Effect.addFinalizer(() =>
          removeSnapshotRoot(snapshotRoot).pipe(
            Effect.catch((error) => Effect.logWarning(error.message)),
          ),
        );
        yield* importHostSharedConfig(transaction, config);
        for (const workspace of Object.values(config.workspaces)) {
          const sourcePath = legacyTaskStorePath(configRoot, workspace.workspaceId);
          yield* Effect.gen(function* () {
            if (!(yield* existingSource(sourcePath))) return;
            yield* withLegacySnapshot(snapshotRoot, sourcePath, (source) =>
              importLegacyWorkspaceTaskData({
                source,
                target: transaction,
                workspaceId: workspace.workspaceId,
                sourcePath,
              }),
            );
          }).pipe(Effect.mapError((cause) => migrationError(sourcePath, cause)));
        }
        yield* transaction.execute(
          (db) =>
            db
              .insert(hostMetadata)
              .values({
                singletonId: 1,
                importComplete: true,
                catalogRevision: 0,
              })
              .onConflictDoUpdate({
                target: hostMetadata.singletonId,
                set: { importComplete: true },
              }),
          operation,
        );
      }),
    ),
  );
