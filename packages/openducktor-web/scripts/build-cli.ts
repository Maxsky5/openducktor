import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { markExecutable, runCommand } from "@openducktor/build-tools";
import { Effect } from "effect";
import { errorMessage, runWebBoundary, WebDependencyError } from "../src/effect/web-errors";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");
const outputPath = join(packageRoot, "dist", "cli.js");

export const buildWebCliEffect = (): Effect.Effect<void, WebDependencyError> =>
  Effect.gen(function* () {
    const command = [
      "bun",
      "build",
      "--target=bun",
      "--external",
      "vite",
      "--outfile",
      outputPath,
      "src/cli.ts",
    ] satisfies readonly [string, ...string[]];
    yield* Effect.tryPromise({
      try: () => runCommand({ command, cwd: packageRoot, label: "Web CLI build" }),
      catch: (cause) =>
        new WebDependencyError({
          dependency: "build-command",
          operation: "web-cli-build",
          message: errorMessage(cause),
          cause,
          details: { command, cwd: packageRoot },
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
  });

export const buildWebCli = (): Promise<void> => runWebBoundary(buildWebCliEffect());

if (import.meta.main) {
  await buildWebCli().catch((error: unknown) => {
    console.error(errorMessage(error));
    process.exit(1);
  });
}
