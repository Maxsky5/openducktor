import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  bindOpenCodeWorkflowPlugin,
  type OpenCodeRuntimeConnection,
} from "@openducktor/adapters-opencode-sdk";
import { Effect } from "effect";
import { parse, type ParseError } from "jsonc-parser/lib/esm/main.js";
import { z } from "zod";
import { toHostOperationError, type HostOperationErrorAggregate } from "../../effect/host-errors";

/** The runtime owns this process-only plugin. Credentials stay in memory. */
export const acquireOpenCodeWorkflowPlugin = (input: {
  env: NodeJS.ProcessEnv;
  ownCleanup: (cleanup: Effect.Effect<void, HostOperationErrorAggregate>) => void;
}) =>
  Effect.gen(function* () {
    const config = yield* Effect.try({
      try: () => {
        const errors: ParseError[] = [];
        const value = parse(input.env.OPENCODE_CONFIG_CONTENT ?? "{}", errors, {
          allowTrailingComma: true,
        });
        if (errors.length)
          throw new Error(
            "OPENCODE_CONFIG_CONTENT is not valid JSONC. Correct that environment value and restart OpenCode.",
          );
        return z.record(z.string(), z.json()).parse(value);
      },
      catch: (cause) => toHostOperationError(cause, "opencodeWorkflowPlugin.config"),
    });
    const root = yield* Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "openducktor-opencode-workflow-")),
      catch: (cause) => toHostOperationError(cause, "opencodeWorkflowPlugin.acquire"),
    });
    const release = Effect.tryPromise({
      try: () => rm(root, { recursive: true, force: true }),
      catch: (cause) => toHostOperationError(cause, "opencodeWorkflowPlugin.release"),
    });
    input.ownCleanup(release);
    const source = import.meta.url.endsWith(".ts");
    const directory = yield* Effect.tryPromise({
      try: async () => {
        if (source)
          return dirname(
            createRequire(import.meta.url).resolve(
              "@openducktor/adapters-opencode-sdk/workflow-plugin",
            ),
          );
        await copyFile(
          new URL("./opencode-workflow-plugin.js", import.meta.url),
          join(root, "server.js"),
        );
        await writeFile(join(root, "package.json"), '{"type":"module"}');
        return root;
      },
      catch: (cause) => toHostOperationError(cause, "opencodeWorkflowPlugin.prepare"),
    });
    const plugins = yield* Effect.try({
      try: () => z.array(z.json()).parse(config.plugins ?? []),
      catch: (cause) => toHostOperationError(cause, "opencodeWorkflowPlugin.config"),
    });
    return {
      configContent: JSON.stringify({
        ...config,
        plugins: [...plugins, { package: directory }],
      }),
      bind: (connection: OpenCodeRuntimeConnection) =>
        Effect.tryPromise({
          try: (signal) => bindOpenCodeWorkflowPlugin(connection, signal),
          catch: (cause) => toHostOperationError(cause, "opencodeWorkflowPlugin.bind"),
        }),
      release,
    };
  });
