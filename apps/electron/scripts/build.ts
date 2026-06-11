import { cp } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanDirectory, runCommand } from "@openducktor/build-tools";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");
const workspaceRoot = resolve(packageRoot, "../..");

export type SqliteTaskStoreMigrationCopyPlan = {
  sourceDirectory: string;
  targetDirectory: string;
};

export const resolveSqliteTaskStoreMigrationCopyPlan = ({
  electronPackageRoot,
  workspaceRoot,
}: {
  electronPackageRoot: string;
  workspaceRoot: string;
}): SqliteTaskStoreMigrationCopyPlan => ({
  sourceDirectory: join(workspaceRoot, "packages/host/src/adapters/sqlite/drizzle"),
  targetDirectory: join(electronPackageRoot, "dist", "drizzle"),
});

export const copySqliteTaskStoreMigrations = ({
  sourceDirectory,
  targetDirectory,
}: SqliteTaskStoreMigrationCopyPlan): Promise<void> =>
  cp(sourceDirectory, targetDirectory, { force: true, recursive: true });

export const buildElectronPackage = async (): Promise<void> => {
  await cleanDirectory(join(packageRoot, "dist"));
  await Promise.all([
    runCommand({
      command: ["bun", "run", "build:main"],
      cwd: packageRoot,
      label: "Electron main build",
    }),
    runCommand({
      command: ["bun", "run", "build:preload"],
      cwd: packageRoot,
      label: "Electron preload build",
    }),
    runCommand({
      command: ["bun", "run", "build:renderer"],
      cwd: packageRoot,
      label: "Electron renderer build",
    }),
  ]);
  await copySqliteTaskStoreMigrations(
    resolveSqliteTaskStoreMigrationCopyPlan({
      electronPackageRoot: packageRoot,
      workspaceRoot,
    }),
  );
};

if (import.meta.main) {
  await buildElectronPackage();
}
