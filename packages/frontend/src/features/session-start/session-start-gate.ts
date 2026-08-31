export type SessionStartGate<Result> = {
  run: (
    key: string,
    start: () => Promise<Result>,
    mode?: "coalesce" | "queue",
    executionKey?: string,
  ) => Promise<Result>;
  clear: () => void;
};

export const createSessionStartGate = <Result>(): SessionStartGate<Result> => {
  const coalescedStartsByKey = new Map<string, Promise<Result>>();
  const lastStartsByExecutionKey = new Map<string, Promise<Result>>();
  let generation = 0;

  const trackStart = (
    startsByKey: Map<string, Promise<Result>>,
    key: string,
    startPromise: Promise<Result>,
  ): Promise<Result> => {
    startsByKey.set(key, startPromise);
    const clearStart = (): void => {
      if (startsByKey.get(key) === startPromise) {
        startsByKey.delete(key);
      }
    };
    void startPromise.then(clearStart, clearStart);
    return startPromise;
  };

  return {
    run: (key, start, mode = "coalesce", executionKey = key) => {
      if (mode === "coalesce") {
        const inFlightStart = coalescedStartsByKey.get(key);
        if (inFlightStart) {
          return inFlightStart;
        }
      }

      const queuedGeneration = generation;
      const startIfCurrent = (): Promise<Result> => {
        if (queuedGeneration !== generation) {
          throw new Error("Session start gate was cleared.");
        }
        return start();
      };
      const previousStart = lastStartsByExecutionKey.get(executionKey);
      const startPromise = previousStart
        ? previousStart
            .then(
              () => undefined,
              () => undefined,
            )
            .then(startIfCurrent)
        : startIfCurrent();
      trackStart(lastStartsByExecutionKey, executionKey, startPromise);
      return mode === "coalesce"
        ? trackStart(coalescedStartsByKey, key, startPromise)
        : startPromise;
    },
    clear: () => {
      generation += 1;
      coalescedStartsByKey.clear();
      lastStartsByExecutionKey.clear();
    },
  };
};
