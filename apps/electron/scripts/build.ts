import { cp } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanDirectory, runCommand } from "@openducktor/build-tools";
import { Effect } from "effect";
import { runElectronEffect } from "../src/effect/electron-boundary";
import {
  ElectronOperationError,
  type ElectronOperationErrorAggregate,
  errorMessage,
} from "../src/effect/electron-errors";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");
const workspaceRoot = resolve(packageRoot, "../..");

type CopySqliteMigrationsErrorDetails = { readonly targetDirectory: string };
type ElectronBuildCommandErrorDetails = {
  readonly command: readonly [string, ...string[]];
  readonly label: string;
};

export type SqliteMigrationCopyPlan = {
  sourceDirectory: string;
  targetDirectory: string;
};

export const resolveSqliteMigrationCopyPlans = ({
  electronPackageRoot,
  workspaceRoot,
}: {
  electronPackageRoot: string;
  workspaceRoot: string;
}): SqliteMigrationCopyPlan[] =>
  ["drizzle", "drizzle-host"].map((folder) => ({
    sourceDirectory: join(workspaceRoot, "packages", "host", "src", "adapters", "sqlite", folder),
    targetDirectory: join(electronPackageRoot, "dist", folder),
  }));

export const copySqliteMigrations = ({
  sourceDirectory,
  targetDirectory,
}: SqliteMigrationCopyPlan): Promise<void> =>
  runElectronEffect(copySqliteMigrationsEffect({ sourceDirectory, targetDirectory }));

export const copySqliteMigrationsEffect = ({
  sourceDirectory,
  targetDirectory,
}: SqliteMigrationCopyPlan): Effect.Effect<
  void,
  ElectronOperationError<CopySqliteMigrationsErrorDetails>
> =>
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
): Effect.Effect<void, ElectronOperationError<ElectronBuildCommandErrorDetails>> =>
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

export const buildElectronPackageEffect = (): Effect.Effect<
  void,
  ElectronOperationErrorAggregate
> =>
  Effect.gen(function* () {
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
        // The import worker has its own bundle. In the split main bundle, its migration code moves
        // into a chunk, and the migration folders resolve from the chunk folder.
        runBuildCommandEffect("Electron import worker build", [
          "bun",
          "run",
          "build:import-worker",
        ]),
        runBuildCommandEffect("Electron preload build", ["bun", "run", "build:preload"]),
        runBuildCommandEffect("Electron renderer build", ["bun", "run", "build:renderer"]),
      ],
      { concurrency: "unbounded" },
    );
    yield* Effect.forEach(
      resolveSqliteMigrationCopyPlans({ electronPackageRoot: packageRoot, workspaceRoot }),
      copySqliteMigrationsEffect,
      { discard: true },
    );
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
