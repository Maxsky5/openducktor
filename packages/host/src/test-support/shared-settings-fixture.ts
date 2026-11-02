import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GlobalConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import { createSettingsConfigAdapter } from "../adapters/settings/settings-config-adapter";
import { importHostDatabase } from "../adapters/sqlite/sqlite-host-database-import";
import { createSqliteSharedSettingsDatabase } from "../adapters/sqlite/sqlite-shared-settings-database";
import { createSqliteHostDatabaseManager } from "../adapters/sqlite/sqlite-task-repository-context";
import { openHostDatabaseTestConnection } from "../adapters/sqlite/sqlite-task-store-test-support";
import { createDefaultGlobalConfig, toHostPreferences } from "../config/global-config";
import { builtinTaskWorkflows } from "./task-workflows";

export const createSharedSettingsFixture = async ({
  configPath,
  config = createDefaultGlobalConfig(),
}: {
  configPath: string;
  config?: GlobalConfig;
}) => {
  const configDir = path.dirname(configPath);
  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(toHostPreferences(config)));
  const manager = createSqliteHostDatabaseManager({
    configDir,
    taskWorkflows: builtinTaskWorkflows,
    openConnection: openHostDatabaseTestConnection,
  });
  const cleanup = () => Effect.runPromise(manager.dispose());
  try {
    await Effect.runPromise(
      manager.withHostDatabase("test.initializeSettings", (session) =>
        importHostDatabase({
          session,
          configRoot: configDir,
          config,
        }),
      ),
    );
  } catch (error) {
    await cleanup();
    throw error;
  }
  const database = createSqliteSharedSettingsDatabase(manager);
  return {
    database,
    settingsConfig: createSettingsConfigAdapter({ configPath, sharedSettings: database }),
    cleanup,
  };
};
