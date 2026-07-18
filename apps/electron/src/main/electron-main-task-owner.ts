import { ElectronOperationError } from "../effect/electron-errors";

export type ElectronDetachedTaskOwner = {
  drain(): Promise<void>;
  run(
    operation: () => void | Promise<void>,
    reportOperationFailure?: (cause: unknown) => void,
  ): void;
};

export const createElectronDetachedTaskOwner = (
  reportFailure: (cause: unknown) => void,
): ElectronDetachedTaskOwner => {
  const pendingTasks = new Set<Promise<void>>();
  let firstFailure: { readonly cause: unknown } | null = null;
  let drainPromise: Promise<void> | null = null;

  const run = (
    operation: () => void | Promise<void>,
    reportOperationFailure = reportFailure,
  ): void => {
    if (drainPromise) {
      const cause = new ElectronOperationError({
        operation: "electron.detached-task.run-after-drain",
        message: "Electron detached work was requested after shutdown draining began.",
      });
      firstFailure ??= { cause };
      reportOperationFailure(cause);
      return;
    }
    const pending = Promise.resolve()
      .then(operation)
      .catch((cause: unknown) => {
        firstFailure ??= { cause };
        reportOperationFailure(cause);
      });
    pendingTasks.add(pending);
    void pending.then(() => {
      pendingTasks.delete(pending);
    });
  };

  return {
    drain: () => {
      drainPromise ??= (async () => {
        await Promise.all(pendingTasks);
      })();
      return drainPromise.then(() => {
        if (firstFailure) {
          throw firstFailure.cause;
        }
      });
    },
    run,
  };
};

export const runElectronMainTask = (
  operation: () => void | Promise<void>,
  reportFailure: (cause: unknown) => void,
): void => {
  try {
    void Promise.resolve(operation()).catch(reportFailure);
  } catch (cause) {
    reportFailure(cause);
  }
};
