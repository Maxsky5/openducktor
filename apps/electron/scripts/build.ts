import { cp } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanDirectory, runCommand } from "@openducktor/build-tools";
import {
  type SqliteMigrationCopyPlan,
  sqliteMigrationCopyPlans,
} from "@openducktor/host/sqlite-migration-assets";
import { Effect } from "effect";
import { processNativeFileName } from "@openducktor/process-native";
import {
  copyProcessNativeModules,
  prepareHostProcessNative,
} from "@openducktor/process-native/build";
import { runElectronEffect } from "../src/effect/electron-boundary";
import {
  ElectronOperationError,
  type ElectronOperationErrorAggregate,
  errorMessage,
} from "../src/effect/electron-errors";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");

type CopySqliteMigrationsErrorDetails = { readonly targetDirectory: string };
type ElectronBuildCommandErrorDetails = {
  readonly command: readonly [string, ...string[]];
  readonly label: string;
};

const copySqliteMigrationsEffect = ({
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

export const copyElectronSqliteMigrationsEffect = () =>
  Effect.forEach(sqliteMigrationCopyPlans(join(packageRoot, "dist")), copySqliteMigrationsEffect, {
    discard: true,
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

/**
 * Builds the native process module of this host, unless a release job supplies it, and copies it
 * into `dist/native`, which Electron Builder unpacks.
 */
export const copyProcessNativeModuleEffect = (): Effect.Effect<void, ElectronOperationError> =>
  Effect.try({
    try: () => {
      prepareHostProcessNative();
      copyProcessNativeModules({
        fileNames: [processNativeFileName()],
        targetDirectory: join(packageRoot, "dist", "native"),
      });
    },
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.build.copy-process-native",
        message: errorMessage(cause),
        cause,
      }),
  });

const buildElectronPackageEffect = (): Effect.Effect<void, ElectronOperationErrorAggregate> =>
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
        runBuildCommandEffect("Electron preload build", ["bun", "run", "build:preload"]),
        runBuildCommandEffect("Electron renderer build", ["bun", "run", "build:renderer"]),
      ],
      { concurrency: "unbounded" },
    );
    yield* copyElectronSqliteMigrationsEffect();
    yield* copyProcessNativeModuleEffect();
  });

if (import.meta.main) {
  try {
    await runElectronEffect(buildElectronPackageEffect());
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
