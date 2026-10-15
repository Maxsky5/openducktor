import { Deferred, Effect } from "effect";
import { actionReplay, COMMAND_BUFFER_ERROR, commandInput } from "./terminal-command-input";
import { terminalFailure, terminalOperationFailure } from "./terminal-session-lifecycle";
import { TerminalPathInputError } from "./terminal-path-input";
import { canRestartCommand, type TerminalSession } from "./terminal-session";
import { shellCommandPrefix } from "./terminal-command-prefix";
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
        const prepared = yield* Effect.try({
          try: () => {
            const text =
              command.restartDir === null
                ? command.input
                : actionReplay(session.shell, command.input, command.restartDir);
            return {
              input: commandInput(text),
              replay:
                command.restartDir === null
                  ? null
                  : {
                      fullInput: command.input,
                      restartDir: command.restartDir,
                      command: expectedCommand,
                      startPrefix: shellCommandPrefix(text),
                    },
            };
          },
          catch: (cause) =>
            cause instanceof TerminalPathInputError
              ? terminalFailure(cause.code, "restart", cause.message, terminalId, cause)
              : terminalOperationFailure(cause, "restart"),
        });
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
        return { ready, handle, prepared };
      }),
    ),
    ({ ready, handle, prepared }) =>
      Deferred.await(ready).pipe(
        Effect.timeout("10 seconds"),
        Effect.mapError(() =>
          failure(
            "The shell did not become ready within 10 seconds. Stop the command or finish the prompt in the terminal, then run it again.",
          ),
        ),
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
              session.pendingActionReplay = prepared.replay;
              yield* handle.write(prepared.input).pipe(
                Effect.tapError(() =>
                  Effect.sync(() => {
                    session.pendingActionReplay = null;
                  }),
                ),
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
