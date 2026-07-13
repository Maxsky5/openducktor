import { cp } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanDirectory, runCommand } from "@openducktor/build-tools";
import { Effect } from "effect";
import { runElectronEffect } from "../src/effect/electron-boundary";
import { ElectronOperationError, errorMessage } from "../src/effect/electron-errors";
import { prepareNodePtyEffect } from "./prepare-node-pty";

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
  sourceDirectory: join(workspaceRoot, "packages", "host", "src", "adapters", "sqlite", "drizzle"),
  targetDirectory: join(electronPackageRoot, "dist", "drizzle"),
});

export const copySqliteTaskStoreMigrations = ({
  sourceDirectory,
  targetDirectory,
}: SqliteTaskStoreMigrationCopyPlan): Promise<void> =>
  runElectronEffect(copySqliteTaskStoreMigrationsEffect({ sourceDirectory, targetDirectory }));

export const copySqliteTaskStoreMigrationsEffect = ({
  sourceDirectory,
  targetDirectory,
}: SqliteTaskStoreMigrationCopyPlan): Effect.Effect<void, ElectronOperationError> =>
  Effect.tryPromise({
    try: () => cp(sourceDirectory, targetDirectory, { force: true, recursive: true }),
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.build.copy-sqlite-migrations",
        message: errorMessage(cause),
        path: sourceDirectory,
        cause,
        details: { targetDirectory },
      }),
  });

const runBuildCommandEffect = (
  label: string,
  command: readonly [string, ...string[]],
): Effect.Effect<void, ElectronOperationError> =>
  Effect.tryPromise({
    try: () => runCommand({ command, cwd: packageRoot, label }),
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.build.run-command",
        message: errorMessage(cause),
        cause,
        details: { command, label },
      }),
  });

export const buildElectronPackageEffect = (): Effect.Effect<void, ElectronOperationError> =>
  Effect.gen(function* () {
    yield* prepareNodePtyEffect();
    yield* Effect.tryPromise({
      try: () => cleanDirectory(join(packageRoot, "dist")),
      catch: (cause) =>
        new ElectronOperationError({
          operation: "electron.build.clean-dist",
          message: errorMessage(cause),
          path: join(packageRoot, "dist"),
          cause,
        }),
    });
    yield* Effect.all(
      [
        runBuildCommandEffect("Electron main build", ["bun", "run", "build:main"]),
        runBuildCommandEffect("Electron preload build", ["bun", "run", "build:preload"]),
        runBuildCommandEffect("Electron renderer build", ["bun", "run", "build:renderer"]),
      ],
      { concurrency: "unbounded" },
    );
    yield* copySqliteTaskStoreMigrationsEffect(
      resolveSqliteTaskStoreMigrationCopyPlan({
        electronPackageRoot: packageRoot,
        workspaceRoot,
      }),
    );
    yield* runBuildCommandEffect("Node PTY adapter conformance", [
      "bun",
      "run",
      "verify:terminal-adapter",
    ]);
  });

export const buildElectronPackage = (): Promise<void> =>
  runElectronEffect(buildElectronPackageEffect());

if (import.meta.main) {
  try {
    await buildElectronPackage();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
