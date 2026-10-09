import { join } from "node:path";
import { Effect } from "effect";
import { TerminalPtyError } from "../../ports/terminal-pty-port";
import { writeTerminalTempFiles } from "./terminal-temp-files";

export type TerminalWindowsBatch = {
  /** The raw command line that runs the batch file with `cmd.exe`. */
  commandLine: string;
  dispose: Effect.Effect<void, TerminalPtyError>;
};

/** Writes the batch script to a private temporary directory that `dispose` removes. */
export const prepareWindowsBatch = (
  script: string,
): Effect.Effect<TerminalWindowsBatch, TerminalPtyError> =>
  writeTerminalTempFiles(
    "odt-terminal-command-",
    () => ({ "command.cmd": script }),
    batchFailure,
  ).pipe(
    // `/s` removes the outer quotes, so the quoted path keeps its spaces.
    Effect.map(({ root, dispose }) => ({
      commandLine: `/d /s /c ""${join(root, "command.cmd")}""`,
      dispose,
    })),
  );

const batchFailure = (cause: unknown, operation: "start" | "terminate"): TerminalPtyError =>
  new TerminalPtyError({
    code: operation === "start" ? "spawn_failed" : "operation_failed",
    operation,
    message: `Could not ${operation === "start" ? "write" : "remove"} the temporary command script. Check access to the temporary directory and retry.`,
    cause,
  });
