import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "@openducktor/build-tools";
import { Effect } from "effect";
import { errorMessage, WebDependencyError } from "@openducktor/remote-host/effect/web-errors";

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const runBuildCommandEffect = (
  label: string,
  command: readonly [string, ...string[]],
  operation = label,
): Effect.Effect<void, WebDependencyError> =>
  Effect.tryPromise({
    try: () => runCommand({ command, cwd: packageRoot, label }),
    catch: (cause) =>
      new WebDependencyError({
        dependency: "build-command",
        operation,
        message: errorMessage(cause),
        cause,
        details: { command: [...command], cwd: packageRoot },
      }),
  });
