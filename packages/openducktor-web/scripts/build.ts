import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanDirectory, runCommand } from "@openducktor/build-tools";
import { Effect } from "effect";
import { errorMessage, runWebBoundary, WebDependencyError } from "../src/effect/web-errors";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");

const runBuildCommandEffect = (
  label: string,
  command: readonly [string, ...string[]],
): Effect.Effect<void, WebDependencyError> =>
  Effect.tryPromise({
    try: () => runCommand({ command, cwd: packageRoot, label }),
    catch: (cause) =>
      new WebDependencyError({
        dependency: "build-command",
        operation: label,
        message: errorMessage(cause),
        cause,
        details: { command: [...command], cwd: packageRoot },
      }),
  });

export const buildWebPackageEffect = (): Effect.Effect<void, WebDependencyError> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => cleanDirectory(join(packageRoot, "dist")),
      catch: (cause) =>
        new WebDependencyError({
          dependency: "filesystem",
          operation: "clean-web-dist",
          message: errorMessage(cause),
          cause,
          details: { path: join(packageRoot, "dist") },
        }),
    });
    yield* runBuildCommandEffect("Web shell build", ["bun", "run", "build:web-shell"]);
    yield* runBuildCommandEffect("Web CLI build", ["bun", "run", "build:cli"]);
    yield* runBuildCommandEffect("Web MCP entrypoint build", ["bun", "run", "build:mcp"]);
  });

export const buildWebPackage = (): Promise<void> => runWebBoundary(buildWebPackageEffect());

if (import.meta.main) {
  await buildWebPackage().catch((cause: unknown) => {
    console.error(errorMessage(cause));
    process.exit(1);
  });
}
