import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { markExecutable, runCommand } from "@openducktor/build-tools";
import { Effect } from "effect";
import { errorMessage, runWebBoundary, WebDependencyError } from "../src/effect/web-errors";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");
const outputPath = join(packageRoot, "dist", "cli.js");
const execFileAsync = promisify(execFile);

export const buildWebCliEffect = (): Effect.Effect<void, WebDependencyError> =>
  Effect.gen(function* () {
    const command = [
      "bun",
      "build",
      "--target=node",
      "--external",
      "vite",
      "--external",
      "@ff-labs/fff-node",
      "--external",
      "@azure/msal-node-extensions",
      "--external",
      "node-pty",
      "--outdir",
      dirname(outputPath),
      "--entry-naming",
      "[name].[ext]",
      "src/cli.ts",
      "src/generated-image-worker.ts",
    ] satisfies readonly [string, ...string[]];
    yield* Effect.tryPromise({
      try: () => runCommand({ command, cwd: packageRoot, label: "Web CLI build" }),
      catch: (cause) =>
        new WebDependencyError({
          dependency: "build-command",
          operation: "web-cli-build",
          message: errorMessage(cause),
          cause,
          details: { command: [...command], cwd: packageRoot },
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
          operation: "verify-web-cli-entrypoint",
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
