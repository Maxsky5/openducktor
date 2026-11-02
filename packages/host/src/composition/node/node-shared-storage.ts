import path from "node:path";
import { randomUUID } from "node:crypto";
import type { GlobalConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import { SettingsFileError } from "../../effect/host-errors";
import type { SettingsConfigError } from "../../ports/settings-config-port";
import {
  loadLegacySettingsConfig,
  migrateSettingsConfig,
} from "../../adapters/settings/settings-config-file";
import { createSettingsConfigAdapter } from "../../adapters/settings/settings-config-adapter";
import { runHostDatabaseImportWorker } from "../../adapters/sqlite/host-database-import-worker-client";
import {
  hasLegacyTaskStores,
  importHostDatabase,
  isHostDatabaseImportPending,
} from "../../adapters/sqlite/sqlite-host-database-import";
import { resolveSqliteHostDatabasePath } from "../../infrastructure/sqlite/sqlite-host-database-path";
import { createSqliteSharedSettingsDatabase } from "../../adapters/sqlite/sqlite-shared-settings-database";
import { createSqliteHostDatabaseManager } from "../../adapters/sqlite/sqlite-task-repository-context";
import { createRuntimeConfigInitializer } from "../../application/runtimes/runtime-config-initializer";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import type { NodeHostBootstrapPorts } from "./node-host-default-ports";
import { toHostStorageStartupError } from "./host-startup-storage-error";
import { guardRuntimeConfigInitializer } from "./user-path-guards";

type StoragePorts = Pick<NodeHostBootstrapPorts, "configDir" | "toolDiscovery" | "userEnvironment">;

/**
 * Loads the legacy settings to import. Another host can commit the import and write
 * preferences-only settings after this host saw a pending import. Then nothing is left to import,
 * and this returns null.
 */
export const loadConfigToImport = <E>(
  loadLegacyConfig: Effect.Effect<GlobalConfig, SettingsConfigError>,
  readImportPending: Effect.Effect<boolean, E>,
): Effect.Effect<GlobalConfig | null, SettingsConfigError | E> =>
  loadLegacyConfig.pipe(
    Effect.catchIf(
      (error): error is SettingsFileError =>
        error instanceof SettingsFileError && error.reason === "databaseMissing",
      (error) =>
        readImportPending.pipe(
          Effect.flatMap((pending) => (pending ? Effect.fail(error) : Effect.succeed(null))),
        ),
    ),
  );

export const createNodeSharedStorage = <Ports extends StoragePorts>(
  ports: Ports,
  taskWorkflows: TaskWorkflowResolver,
  onHostDatabaseImport: (phase: "started" | "finished") => Effect.Effect<void> = () => Effect.void,
) =>
  Effect.gen(function* () {
    const hostInstanceId = randomUUID();
    const configRoot = ports.configDir.root;
    const taskDatabase = createSqliteHostDatabaseManager({
      configDir: configRoot,
      taskWorkflows,
    });
    const initializeConfig = guardRuntimeConfigInitializer(
      createRuntimeConfigInitializer(ports.toolDiscovery),
      ports.userEnvironment,
    );
    const configPath = path.join(configRoot, "config.json");
    const readImportPending = taskDatabase.withHostDatabase(
      "hostDatabase.readImportState",
      isHostDatabaseImportPending,
    );
    // Copying task stores can take minutes, so that import runs on a worker thread and the shell
    // shows progress. Settings alone import in milliseconds on this thread.
    const importLegacyData = (config: GlobalConfig) =>
      Effect.gen(function* () {
        if (!(yield* hasLegacyTaskStores(configRoot, config)))
          return yield* taskDatabase.withHostDatabase("hostDatabase.import", (session) =>
            importHostDatabase({ session, configRoot, config }),
          );
        yield* onHostDatabaseImport("started");
        yield* runHostDatabaseImportWorker({
          config,
          configRoot,
          databasePath: resolveSqliteHostDatabasePath(configRoot),
        }).pipe(Effect.ensuring(onHostDatabaseImport("finished")));
      });
    yield* Effect.gen(function* () {
      if (yield* readImportPending) {
        // Tool discovery for an old config starts processes, so it runs before the import lock.
        const config = yield* loadConfigToImport(
          loadLegacySettingsConfig(configPath, initializeConfig),
          readImportPending,
        );
        if (config !== null) yield* importLegacyData(config);
      }
      yield* taskDatabase.withHostDatabase("hostDatabase.migratePreferences", (session) =>
        session.transaction("hostDatabase.migratePreferences", () =>
          migrateSettingsConfig(configPath),
        ),
      );
    }).pipe(
      Effect.mapError(toHostStorageStartupError),
      Effect.onError(() => taskDatabase.dispose().pipe(Effect.orDie)),
    );
    const settingsConfig = createSettingsConfigAdapter({
      configPath,
      sharedSettings: createSqliteSharedSettingsDatabase(taskDatabase),
    });
    return { ...ports, settingsConfig, taskDatabase, hostInstanceId };
  });

export type NodeHostSharedPorts = Effect.Success<
  ReturnType<typeof createNodeSharedStorage<NodeHostBootstrapPorts>>
>;
