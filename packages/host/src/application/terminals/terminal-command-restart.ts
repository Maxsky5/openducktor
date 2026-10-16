import { Deferred, Effect } from "effect";
import { COMMAND_BUFFER_ERROR, COMMAND_READY_ERROR, commandInput } from "./terminal-command-input";
import { terminalFailure } from "./terminal-session-lifecycle";
import { canRestartCommand, type TerminalSession } from "./terminal-session";
import type { TerminalServiceError } from "./terminal-service-error";

export const restartCommand = (
  session: TerminalSession,
  expectedCommand: string,
): Effect.Effect<void, TerminalServiceError> => {
  const terminalId = session.summary.terminalId;
  const failure = (message: string) =>
    terminalFailure("invalid_input", "restart", message, terminalId);
  return Effect.acquireUseRelease(
    session.operations.run(
      Effect.gen(function* () {
        yield* Effect.promise(() => session.screen.parsed());
        const command = session.runningCommand;
        const handle = session.resources.handle;
        if (session.summary.lifecycle !== "running" || !command || !handle)
          return yield* failure(
            "This terminal has no command that can restart. Run the command from the shell.",
          );
        if (!canRestartCommand(session))
          return yield* failure(
            "This Action is still running for setup. Wait for it to finish before restarting commands.",
          );
        if (session.command !== expectedCommand)
          return yield* failure(
            "The running command changed. Select Restart for the current command.",
          );
        if (session.inputOwner === "restart")
          return yield* failure("A restart is already waiting for this command to stop.");
        const input = commandInput(command);
        if (session.commandRun?.phase === "command") session.commandRun.stopRequested = true;
        session.inputOwner = "restart";
        const ready = session.ready;
        yield* handle.write(new Uint8Array([3])).pipe(
          Effect.mapError((cause) => failure(`Could not interrupt the command: ${cause.message}`)),
          Effect.tapError(() =>
            Effect.sync(() => {
              session.inputOwner = null;
            }),
          ),
        );
        return { ready, handle, input };
      }),
    ),
    ({ ready, handle, input }) =>
      Deferred.await(ready).pipe(
        Effect.timeout("10 seconds"),
        Effect.mapError(() => failure(COMMAND_READY_ERROR)),
        Effect.andThen((empty) =>
          session.operations.run(
            Effect.gen(function* () {
              if (session.summary.lifecycle !== "running" || session.resources.handle !== handle)
                return yield* failure(
                  "The terminal closed before the command could restart. Create a new terminal.",
                );
              if (!empty) return yield* failure(COMMAND_BUFFER_ERROR);
              if (session.command !== null)
                return yield* failure(
                  "Another command started before the restart. Stop it before restarting.",
                );
              yield* handle
                .write(input)
                .pipe(
                  Effect.mapError((cause) =>
                    failure(`Could not restart the command: ${cause.message}`),
                  ),
                );
            }),
          ),
        ),
      ),
    () =>
      Effect.sync(() => {
        session.inputOwner = null;
      }),
  );
};
