import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const migrationDirectories = {
  legacy: "drizzle",
  host: "drizzle-host",
} as const;

const assetDirectory = dirname(fileURLToPath(import.meta.url));

export const legacyMigrationsFolder = join(assetDirectory, migrationDirectories.legacy);
export const hostMigrationsFolder = join(assetDirectory, migrationDirectories.host);

export type SqliteMigrationCopyPlan = {
  sourceDirectory: string;
  targetDirectory: string;
};

export const sqliteMigrationCopyPlans = (outputDirectory: string): SqliteMigrationCopyPlan[] =>
  Object.values(migrationDirectories).map((directory) => ({
    sourceDirectory: join(assetDirectory, directory),
    targetDirectory: join(outputDirectory, directory),
  }));
