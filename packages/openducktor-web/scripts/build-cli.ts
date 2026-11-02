import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { markExecutable, runCommand } from "@openducktor/build-tools";
import { Effect } from "effect";
import {
  errorMessage,
  runWebBoundary,
  WebDependencyError,
} from "@openducktor/remote-host/effect/web-errors";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");
const workspaceRoot = resolve(packageRoot, "../..");
const outputPath = join(packageRoot, "dist", "cli.js");
const execFileAsync = promisify(execFile);

export type WebSqliteMigrationCopyPlan = {
  sourceDirectory: string;
  targetDirectory: string;
};

export const resolveWebSqliteMigrationCopyPlans = ({
  packageRoot,
  workspaceRoot,
}: {
  packageRoot: string;
  workspaceRoot: string;
}): WebSqliteMigrationCopyPlan[] =>
  ["drizzle", "drizzle-host"].map((folder) => ({
    sourceDirectory: join(workspaceRoot, "packages", "host", "src", "adapters", "sqlite", folder),
    targetDirectory: join(packageRoot, "dist", folder),
  }));

export const copyWebSqliteMigrationsEffect = ({
  sourceDirectory,
  targetDirectory,
}: WebSqliteMigrationCopyPlan): Effect.Effect<void, WebDependencyError> =>
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

export const copyWebSqliteMigrations = (input: WebSqliteMigrationCopyPlan): Promise<void> =>
  runWebBoundary(copyWebSqliteMigrationsEffect(input));

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
] as const;

// The import worker has its own bundle, so its migration folders resolve from the dist folder
// and not from a shared chunk.
const IMPORT_WORKER_BUILD_COMMAND = [
  "bun",
  "build",
  "--target=node",
  "--minify",
  "--keep-names",
  "--outdir",
  dirname(outputPath),
  "--entry-naming",
  "[name].[ext]",
  "src/host-database-import-worker.ts",
] as const;

type WebBuild = { label: string; command: readonly [string, ...string[]] };

const runWebBuildEffect = ({ label, command }: WebBuild): Effect.Effect<void, WebDependencyError> =>
  Effect.tryPromise({
    try: () => runCommand({ command, cwd: packageRoot, label }),
    catch: (cause) =>
      new WebDependencyError({
        dependency: "build-command",
        operation: "web-cli-build",
        message: errorMessage(cause),
        cause,
        details: { command: [...command], cwd: packageRoot },
      }),
  });

export const buildWebCliEffect = (): Effect.Effect<void, WebDependencyError> =>
  Effect.gen(function* () {
    yield* Effect.forEach(
      [
        { label: "Web CLI build", command: CLI_BUILD_COMMAND },
        { label: "Web import worker build", command: IMPORT_WORKER_BUILD_COMMAND },
      ],
      runWebBuildEffect,
      { concurrency: 2, discard: true },
    );
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
      resolveWebSqliteMigrationCopyPlans({ packageRoot, workspaceRoot }),
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

export const buildWebCli = (): Promise<void> => runWebBoundary(buildWebCliEffect());

if (import.meta.main) {
  await buildWebCli().catch((cause: unknown) => {
    console.error(errorMessage(cause));
    process.exit(1);
  });
}
