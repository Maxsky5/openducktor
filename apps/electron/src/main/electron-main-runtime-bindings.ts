import { runElectronEffect } from "../effect/electron-boundary";
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
});
