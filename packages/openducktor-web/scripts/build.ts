import { join } from "node:path";
import { cleanDirectory } from "@openducktor/build-tools";
import { Effect } from "effect";
import {
  errorMessage,
  runWebBoundary,
  WebDependencyError,
} from "@openducktor/remote-host/effect/web-errors";
import { packageRoot, runBuildCommandEffect } from "./build-command";

const buildWebPackageEffect = (): Effect.Effect<void, WebDependencyError> =>
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
    yield* runBuildCommandEffect("Web shell, CLI and MCP builds", [
      "bun",
      "run",
      "--parallel",
      "build:web-shell",
      "build:cli",
      "build:mcp",
    ]);
    yield* runBuildCommandEffect("Standalone web client build", ["bun", "run", "build:client"]);
  });

if (import.meta.main) {
  await runWebBoundary(buildWebPackageEffect()).catch((cause: unknown) => {
    console.error(errorMessage(cause));
    process.exit(1);
  });
}
