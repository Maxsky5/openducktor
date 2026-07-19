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
    const hostCommandEffect = operation.pipe(
      Effect.tapError((commandFailure) =>
        logger.error(`Electron host command '${command}' failed`, commandFailure).pipe(
          Effect.mapError(
            (persistenceFailure) =>
              new ElectronOperationError({
                operation: "electron.main.host-command",
                message: `Electron host command '${command}' failed and its error could not be persisted.`,
                cause: commandFailure,
                details: {
                  command,
                  commandFailure,
                  persistenceFailure,
                },
              }),
          ),
        ),
      ),
    );
    return runElectronEffect(hostCommandEffect);
  },
});
