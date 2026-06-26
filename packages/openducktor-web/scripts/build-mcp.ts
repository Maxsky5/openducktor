import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { markExecutable, runCommand } from "@openducktor/build-tools";
import { Effect } from "effect";
import { errorMessage, runWebBoundary, WebDependencyError } from "../src/effect/web-errors";
import { WEB_PACKAGE_MCP_ENTRYPOINT } from "../src/web-runtime-distribution";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");
const workspaceRoot = resolve(packageRoot, "../..");
const outputPath = join(packageRoot, "dist", WEB_PACKAGE_MCP_ENTRYPOINT);

export const buildWebMcpEntrypointEffect = (): Effect.Effect<void, WebDependencyError> =>
  Effect.gen(function* () {
    const command = [
      "bun",
      "build",
      "--target=bun",
      "--outfile",
      outputPath,
      "--banner",
      "#!/usr/bin/env bun",
      join(workspaceRoot, "packages", "openducktor-mcp", "src", "index.ts"),
    ] satisfies readonly [string, ...string[]];
    yield* Effect.tryPromise({
      try: () => runCommand({ command, cwd: packageRoot, label: "Web MCP entrypoint build" }),
      catch: (cause) =>
        new WebDependencyError({
          dependency: "build-command",
          operation: "web-mcp-entrypoint-build",
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
          operation: "mark-web-mcp-entrypoint-executable",
          message: errorMessage(cause),
          cause,
          details: { outputPath },
        }),
    });
  });

export const buildWebMcpEntrypoint = (): Promise<void> =>
  runWebBoundary(buildWebMcpEntrypointEffect());

if (import.meta.main) {
  await buildWebMcpEntrypoint();
}
