export type SessionStartGate<Result> = {
  run: (key: string, start: () => Promise<Result>, mode?: "coalesce" | "queue") => Promise<Result>;
  clear: () => void;
};

export const createSessionStartGate = <Result>(): SessionStartGate<Result> => {
  const coalescedStartsByKey = new Map<string, Promise<Result>>();
  const queuedStartsByKey = new Map<string, Promise<Result>>();
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
    run: (key, start, mode = "coalesce") => {
      if (mode === "coalesce") {
        const inFlightStart = coalescedStartsByKey.get(key);
        if (inFlightStart) {
          return inFlightStart;
        }
        return trackStart(coalescedStartsByKey, key, start());
      }

      const queuedGeneration = generation;
      const startIfCurrent = (): Promise<Result> => {
        if (queuedGeneration !== generation) {
          throw new Error("Session start gate was cleared.");
        }
        return start();
      };
      const previousStart = queuedStartsByKey.get(key);
      if (!previousStart) {
        return trackStart(queuedStartsByKey, key, startIfCurrent());
      }

      const previousCompletion = previousStart.then(
        () => undefined,
        () => undefined,
      );
      return trackStart(queuedStartsByKey, key, previousCompletion.then(startIfCurrent));
    },
    clear: () => {
      generation += 1;
      coalescedStartsByKey.clear();
      queuedStartsByKey.clear();
    },
  };
};
