import { cp } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanDirectory, runCommand } from "@openducktor/build-tools";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");
const workspaceRoot = resolve(packageRoot, "../..");

export type WebSqliteTaskStoreMigrationCopyPlan = {
  sourceDirectory: string;
  targetDirectory: string;
};

export const resolveWebSqliteTaskStoreMigrationCopyPlan = ({
  packageRoot,
  workspaceRoot,
}: {
  packageRoot: string;
  workspaceRoot: string;
}): WebSqliteTaskStoreMigrationCopyPlan => ({
  sourceDirectory: join(workspaceRoot, "packages", "host", "src", "adapters", "sqlite", "drizzle"),
  targetDirectory: join(packageRoot, "dist", "drizzle"),
});

export const copyWebSqliteTaskStoreMigrations = ({
  sourceDirectory,
  targetDirectory,
}: WebSqliteTaskStoreMigrationCopyPlan): Promise<void> =>
  cp(sourceDirectory, targetDirectory, { force: true, recursive: true });

export const buildWebPackage = async (): Promise<void> => {
  await cleanDirectory(join(packageRoot, "dist"));
  await runCommand({
    command: ["bun", "run", "build:web-shell"],
    cwd: packageRoot,
    label: "Web shell build",
  });
  await runCommand({
    command: ["bun", "run", "build:cli"],
    cwd: packageRoot,
    label: "Web CLI build",
  });
  await runCommand({
    command: ["bun", "run", "build:mcp"],
    cwd: packageRoot,
    label: "Web MCP entrypoint build",
  });
  await copyWebSqliteTaskStoreMigrations(
    resolveWebSqliteTaskStoreMigrationCopyPlan({
      packageRoot,
      workspaceRoot,
    }),
  );
};

if (import.meta.main) {
  await buildWebPackage();
}
