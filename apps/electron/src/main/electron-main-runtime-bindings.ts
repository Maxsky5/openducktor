import { Effect } from "effect";
import { runElectronEffect } from "../effect/electron-boundary";
import { ElectronOperationError } from "../effect/electron-errors";
import type { ElectronMainLogger } from "./electron-main-logger";
import { runElectronMainTask } from "./electron-main-task-owner";

export const createElectronMainRuntimeBindings = (logger: ElectronMainLogger) => {
  const activeHostCommands = new Set<Promise<unknown>>();
  let acceptsHostCommands = true;

  return {
    appUpdateLogger: {
      error: (message: string, error?: unknown) => runElectronEffect(logger.error(message, error)),
      info: (message: string) => runElectronEffect(logger.info(message)),
      warn: (message: string) => runElectronEffect(logger.warn(message)),
    },
    createTaskRunner:
      (reportFailure: (cause: unknown) => void) =>
      (operation: () => void | Promise<void>): void =>
        runElectronMainTask(operation, reportFailure),
    drainHostCommands(): Promise<void> {
      acceptsHostCommands = false;
      return Promise.allSettled([...activeHostCommands]).then(() => undefined);
    },
    lifecycleLogger: logger,
    runHostCommand<Result, Failure extends Error>(
      command: string,
      operation: Effect.Effect<Result, Failure>,
    ): Promise<Result> {
      if (!acceptsHostCommands) {
        return Promise.reject(
          new ElectronOperationError({
            operation: "electron.main.host-command",
            message: `Electron host command '${command}' was rejected because host shutdown has started.`,
            details: { command, reason: "shutdown-started" },
          }),
        );
      }

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
      const commandPromise = runElectronEffect(hostCommandEffect);
      activeHostCommands.add(commandPromise);
      void commandPromise.then(
        () => activeHostCommands.delete(commandPromise),
        () => activeHostCommands.delete(commandPromise),
      );
      return commandPromise;
    },
  };
};
