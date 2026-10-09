import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { TerminalPtyError } from "../../ports/terminal-pty-port";

export type TerminalTempFiles = {
  root: string;
  dispose: Effect.Effect<void, TerminalPtyError>;
};

/** Writes files to a private temporary directory that `dispose` removes. */
export const writeTerminalTempFiles = (
  prefix: string,
  files: (root: string) => Record<string, string>,
  failure: (cause: unknown, operation: "start" | "terminate") => TerminalPtyError,
): Effect.Effect<TerminalTempFiles, TerminalPtyError> =>
  Effect.gen(function* () {
    const root = yield* Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), prefix)),
      catch: (cause) => failure(cause, "start"),
    });
    const dispose = Effect.tryPromise({
      try: () => rm(root, { recursive: true, force: true }),
      catch: (cause) => failure(cause, "terminate"),
    });
    yield* Effect.tryPromise({
      try: () =>
        Promise.all(
          Object.entries(files(root)).map(([name, text]) => writeFile(join(root, name), text)),
        ),
      catch: (cause) => failure(cause, "start"),
    }).pipe(Effect.tapError(() => dispose));
    return { root, dispose };
  });
