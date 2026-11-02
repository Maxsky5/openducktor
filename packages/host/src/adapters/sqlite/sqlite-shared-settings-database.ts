import { repoConfigSchema } from "@openducktor/contracts";
import { eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { HostValidationError, toHostOperationError } from "../../effect/host-errors";
import type { SharedSettingsDatabase } from "../../ports/settings-config-port";
import { applyHostSharedConfigEdits, readHostSharedConfig } from "./sqlite-host-settings-store";
import { workspaces, workspaceRemovals } from "./sqlite-host-settings-schema";
import {
  missingHostSettings,
  readHostAutopilotSettings,
  readHostGlobalConfig,
  readHostRepoConfig,
  readHostRepoConfigByRepoPath,
} from "./sqlite-host-settings-store-reads";
import { validateHostSettings } from "./sqlite-host-settings-store-validation";
import type { SqliteHostDatabaseManager } from "./sqlite-task-repository-context";
import { hostMetadata, type HostDatabaseSession } from "./sqlite-host-database-schema";

const operation = "hostSettings.update";
const readOperation = "hostSettings.read";
const settingsError = (cause: unknown) =>
  cause instanceof HostValidationError ? cause : toHostOperationError(cause, operation);

export const createSqliteSharedSettingsDatabase = (
  manager: Pick<SqliteHostDatabaseManager, "withHostDatabase">,
): SharedSettingsDatabase => {
  const read = <A, E>(use: (session: HostDatabaseSession) => Effect.Effect<A, E>) =>
    manager.withHostDatabase(readOperation, use).pipe(Effect.mapError(settingsError));
  // A read of more than one statement reads one snapshot.
  const readSnapshot = <A, E>(use: (session: HostDatabaseSession) => Effect.Effect<A, E>) =>
    read((session) => session.readTransaction(readOperation, use));
  const catalogSchema = repoConfigSchema.pick({
    workspaceId: true,
    workspaceName: true,
    abbreviation: true,
    tileColor: true,
    repoPath: true,
    worktreeBasePath: true,
    closed: true,
    removal: true,
  });

  const readCatalog = (session: HostDatabaseSession) =>
    Effect.gen(function* () {
      const rows = yield* session.execute(
        (db) =>
          db
            .select({
              catalogRevision: hostMetadata.catalogRevision,
              workspace: {
                workspaceId: workspaces.workspaceId,
                workspaceName: workspaces.workspaceName,
                abbreviation: workspaces.abbreviation,
                tileColor: workspaces.tileColor,
                repoPath: workspaces.repoPath,
                worktreeBasePath: workspaces.worktreeBasePath,
                closed: workspaces.closed,
              },
              removal: {
                removeTaskWorktrees: workspaceRemovals.removeTaskWorktrees,
                phase: workspaceRemovals.phase,
                pendingWorktreePath: workspaceRemovals.pendingWorktreePath,
              },
            })
            .from(hostMetadata)
            .leftJoin(workspaces, sql`true`)
            .leftJoin(workspaceRemovals, eq(workspaceRemovals.workspaceId, workspaces.workspaceId))
            .where(eq(hostMetadata.singletonId, 1)),
        "hostSettings.readCatalog",
      );
      const [first] = rows;
      if (!first) return yield* missingHostSettings();
      const workspacesInCatalog = yield* validateHostSettings(
        () =>
          rows.flatMap((row) =>
            row.workspace
              ? [
                  catalogSchema.parse({
                    ...row.workspace,
                    removal: row.removal ?? undefined,
                  }),
                ]
              : [],
          ),
        "workspace catalog",
      );
      return { catalogRevision: first.catalogRevision, workspaces: workspacesInCatalog };
    });

  return {
    readGlobalConfig: () => readSnapshot(readHostGlobalConfig),
    readAutopilotSettings: () => read(readHostAutopilotSettings),
    readRepoConfig: (workspaceId) => read((session) => readHostRepoConfig(session, workspaceId)),
    readRepoConfigByRepoPath: (repoPath) =>
      read((session) => readHostRepoConfigByRepoPath(session, repoPath)),
    readWorkspaceCatalogSnapshot: () =>
      manager
        .withHostDatabase("hostSettings.readCatalog", readCatalog)
        .pipe(Effect.mapError(settingsError)),
    readConfig: (workspaceIds) =>
      readSnapshot((session) => readHostSharedConfig(session, workspaceIds)),
    updateConfig: (change, workspaceIds) =>
      manager
        .withHostDatabase(operation, (session) =>
          session.transaction(operation, (transaction) =>
            Effect.gen(function* () {
              const current = yield* readHostSharedConfig(transaction, workspaceIds);
              const catalog =
                workspaceIds === undefined
                  ? Object.values(current.workspaces)
                  : workspaceIds.length === 0
                    ? []
                    : (yield* readCatalog(transaction)).workspaces;
              const next = yield* Effect.try({
                try: () => change(structuredClone(current), catalog),
                catch: settingsError,
              });
              const edits = yield* applyHostSharedConfigEdits(transaction, current, next);
              if (edits.membershipChanged)
                yield* transaction.execute(
                  (db) =>
                    db
                      .update(hostMetadata)
                      .set({ catalogRevision: sql`${hostMetadata.catalogRevision} + 1` })
                      .where(eq(hostMetadata.singletonId, 1)),
                  operation,
                );
              return { current, next, changed: edits.changed };
            }),
          ),
        )
        .pipe(Effect.mapError(settingsError)),
  };
};
