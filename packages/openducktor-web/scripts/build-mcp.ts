import { join, resolve } from "node:path";
import { markExecutable } from "@openducktor/build-tools";
import { Effect } from "effect";
import {
  errorMessage,
  runWebBoundary,
  WebDependencyError,
} from "@openducktor/remote-host/effect/web-errors";
import { WEB_PACKAGE_MCP_ENTRYPOINT } from "../src/web-runtime-distribution";
import { packageRoot, runBuildCommandEffect } from "./build-command";

const workspaceRoot = resolve(packageRoot, "../..");
const outputPath = join(packageRoot, "dist", WEB_PACKAGE_MCP_ENTRYPOINT);

const buildWebMcpEntrypointEffect = (): Effect.Effect<void, WebDependencyError> =>
  Effect.gen(function* () {
    const command = [
      "bun",
      "build",
      "--target=node",
      "--minify",
      "--keep-names",
      "--outfile",
      outputPath,
      "--banner",
      "#!/usr/bin/env node",
      join(workspaceRoot, "packages", "openducktor-mcp", "src", "index.ts"),
    ] satisfies readonly [string, ...string[]];
    yield* runBuildCommandEffect("Web MCP entrypoint build", command, "web-mcp-entrypoint-build");
    yield* Effect.tryPromise({
      try: () => markExecutable(outputPath),
      catch: (cause) =>
        new WebDependencyError({
          dependency: "filesystem",
          operation: "mark-web-mcp-entrypoint-executable",
          message: errorMessage(cause),
          cause,
          details: { outputPath },
        }),
    });
  });

if (import.meta.main) {
  await runWebBoundary(buildWebMcpEntrypointEffect()).catch((cause: unknown) => {
    console.error(errorMessage(cause));
    process.exit(1);
  });
}
