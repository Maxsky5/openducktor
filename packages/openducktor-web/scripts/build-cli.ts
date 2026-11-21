import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { markExecutable, runCommand } from "@openducktor/build-tools";
import {
  type SqliteMigrationCopyPlan,
  sqliteMigrationCopyPlans,
} from "@openducktor/host/sqlite-migration-assets";
import { Effect } from "effect";
import {
  errorMessage,
  runWebBoundary,
  WebDependencyError,
} from "@openducktor/remote-host/effect/web-errors";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");
const outputPath = join(packageRoot, "dist", "cli.js");
const execFileAsync = promisify(execFile);

const copyWebSqliteMigrationsEffect = ({
  sourceDirectory,
  targetDirectory,
}: SqliteMigrationCopyPlan): Effect.Effect<void, WebDependencyError> =>
  Effect.tryPromise({
    try: () => cp(sourceDirectory, targetDirectory, { force: true, recursive: true }),
    catch: (cause) =>
      new WebDependencyError({
        dependency: "filesystem",
        operation: "copy-web-sqlite-migrations",
        message: errorMessage(cause),
        cause,
        details: { sourceDirectory, targetDirectory },
      }),
  });

const CLI_BUILD_COMMAND = [
  "bun",
  "build",
  "--target=node",
  "--minify",
  "--keep-names",
  "--splitting",
  "--external",
  "vite",
  "--external",
  "@ff-labs/fff-node",
  "--external",
  "@azure/msal-node-extensions",
  "--external",
  "node-pty",
  "--external",
  "playwright-core",
  "--outdir",
  dirname(outputPath),
  "--entry-naming",
  "[name].[ext]",
  "src/cli.ts",
  "src/generated-image-worker.ts",
  "src/claude-transcript-worker.ts",
  "src/host-database-import-worker.ts",
] as const;

const buildWebCliEffect = (): Effect.Effect<void, WebDependencyError> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () =>
        runCommand({ command: CLI_BUILD_COMMAND, cwd: packageRoot, label: "Web CLI build" }),
      catch: (cause) =>
        new WebDependencyError({
          dependency: "build-command",
          operation: "web-cli-build",
          message: errorMessage(cause),
          cause,
          details: { command: [...CLI_BUILD_COMMAND], cwd: packageRoot },
        }),
    });
    yield* Effect.tryPromise({
      try: () => markExecutable(outputPath),
      catch: (cause) =>
        new WebDependencyError({
          dependency: "filesystem",
          operation: "mark-web-cli-executable",
          message: errorMessage(cause),
          cause,
          details: { outputPath },
        }),
    });
    yield* Effect.forEach(
      sqliteMigrationCopyPlans(dirname(outputPath)),
      copyWebSqliteMigrationsEffect,
      { discard: true },
    );
    yield* Effect.tryPromise({
      try: async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), "openducktor-web-cli-"));
        try {
          const binaryPath = join(temporaryDirectory, "openducktor-web");
          const entrypoint = process.platform === "win32" ? outputPath : binaryPath;
          if (process.platform !== "win32") await symlink(outputPath, binaryPath);
          const { stdout } = await execFileAsync("node", [entrypoint, "--help"]);
          if (!stdout.startsWith("Usage: openducktor-web")) {
            throw new Error("The built web CLI did not print help under Node.");
          }
        } finally {
          await rm(temporaryDirectory, { recursive: true, force: true });
        }
      },
      catch: (cause) =>
        new WebDependencyError({
          dependency: "build-command",
          operation: "verify-web-cli-entrypoints",
          message: errorMessage(cause),
          cause,
          details: { outputPath },
        }),
    });
  });

if (import.meta.main) {
  await runWebBoundary(buildWebCliEffect()).catch((cause: unknown) => {
    console.error(errorMessage(cause));
    process.exit(1);
  });
}
