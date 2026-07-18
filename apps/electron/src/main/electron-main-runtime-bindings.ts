import { Effect } from "effect";
import { runElectronEffect } from "../effect/electron-boundary";
import { ElectronOperationError } from "../effect/electron-errors";
import type { ElectronMainLogger } from "./electron-main-logger";
import { runElectronMainTask } from "./electron-main-task-owner";

export const createElectronMainRuntimeBindings = (logger: ElectronMainLogger) => ({
  appUpdateLogger: {
    error: (message: string, error?: unknown) => runElectronEffect(logger.error(message, error)),
    info: (message: string) => runElectronEffect(logger.info(message)),
    warn: (message: string) => runElectronEffect(logger.warn(message)),
  },
  createTaskRunner:
    (reportFailure: (cause: unknown) => void) =>
    (operation: () => void | Promise<void>): void =>
      runElectronMainTask(operation, reportFailure),
  lifecycleLogger: logger,
  runHostCommand<Result, Failure extends Error>(
    command: string,
    operation: Effect.Effect<Result, Failure>,
  ): Promise<Result> {
    const hostCommandEffect: Effect.Effect<Result, Failure | ElectronOperationError> = Effect.gen(
      function* () {
        const commandResult = yield* Effect.either(operation);
        if (commandResult._tag === "Right") {
          return commandResult.right;
        }
        const commandFailure = commandResult.left;
        const loggingResult = yield* Effect.either(
          logger.error(`Electron host command '${command}' failed`, commandFailure),
        );
        if (loggingResult._tag === "Left") {
          return yield* Effect.fail(
            new ElectronOperationError({
              operation: "electron.main.host-command",
              message: `Electron host command '${command}' failed and its error could not be persisted.`,
              cause: commandFailure,
              details: {
                command,
                commandFailure,
                persistenceFailure: loggingResult.left,
              },
            }),
          );
        }
        return yield* Effect.fail(commandFailure);
      },
    );
    return runElectronEffect(hostCommandEffect);
  },
});
