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

  const run = (
    operation: () => void | Promise<void>,
    reportOperationFailure = reportFailure,
  ): void => {
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
    drain: async () => {
      await Promise.all(pendingTasks);
      if (firstFailure) {
        throw firstFailure.cause;
      }
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
