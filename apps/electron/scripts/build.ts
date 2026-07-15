import { chmod, cp, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanDirectory, runCommand } from "@openducktor/build-tools";
import { Effect } from "effect";
import electronPath from "electron";
import { runElectronEffect } from "../src/effect/electron-boundary";
import { ElectronOperationError, errorMessage } from "../src/effect/electron-errors";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");
const workspaceRoot = resolve(packageRoot, "../..");
const require = createRequire(import.meta.url);

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

const resolveNodePtySpawnHelper = (): string | null => {
  if (process.platform === "win32") return null;
  const utilsPath = require.resolve("node-pty/lib/utils.js");
  const { loadNativeModule } = require(utilsPath) as {
    loadNativeModule: (name: string) => { dir: string };
  };
  return resolve(dirname(utilsPath), loadNativeModule("pty").dir, "spawn-helper");
};

const prepareNodePtyEffect = (): Effect.Effect<void, ElectronOperationError> =>
  Effect.tryPromise({
    try: async () => {
      const helperPath = resolveNodePtySpawnHelper();
      if (helperPath) await chmod(helperPath, 0o755);
    },
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.node-pty.prepare-spawn-helper",
        message: `Failed to make the node-pty spawn helper executable: ${errorMessage(cause)}`,
        cause,
      }),
  });

const verifyNodePtyAdapterEffect = (): Effect.Effect<void, ElectronOperationError> =>
  Effect.tryPromise({
    try: async () => {
      const outputDirectory = await mkdtemp(join(packageRoot, ".node-pty-conformance-"));
      const output = join(outputDirectory, "node-pty-adapter-conformance.mjs");

      try {
        const result = await Bun.build({
          entrypoints: [
            join(packageRoot, "src", "main", "terminals", "node-pty-adapter.conformance.ts"),
          ],
          external: ["node-pty"],
          format: "esm",
          naming: "node-pty-adapter-conformance.mjs",
          outdir: outputDirectory,
          target: "node",
        });
        if (!result.success) {
          throw new AggregateError(result.logs, "Failed to bundle the node-pty conformance.");
        }

        const child = Bun.spawn([electronPath as unknown as string, output], {
          cwd: packageRoot,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
          stderr: "inherit",
          stdout: "inherit",
        });
        const exitCode = await child.exited;
        if (exitCode !== 0) {
          throw new Error(`node-pty adapter conformance exited with code ${exitCode}.`);
        }
      } finally {
        await rm(outputDirectory, { force: true, recursive: true });
      }
    },
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.node-pty.verify-adapter",
        message: errorMessage(cause),
        cause,
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
    yield* verifyNodePtyAdapterEffect();
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
