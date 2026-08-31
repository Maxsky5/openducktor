export type SessionStartGate<Result> = {
  run: (key: string, start: () => Promise<Result>, mode?: "coalesce" | "queue") => Promise<Result>;
  clear: () => void;
};

export const createSessionStartGate = <Result>(): SessionStartGate<Result> => {
  const startsByKey = new Map<string, Promise<Result>>();

  return {
    run: (key, start, mode = "coalesce") => {
      const inFlightStart = startsByKey.get(key);
      if (inFlightStart && mode === "coalesce") {
        return inFlightStart;
      }

      const startPromise = inFlightStart ? inFlightStart.then(start, start) : start();
      startsByKey.set(key, startPromise);
      const clearStart = (): void => {
        if (startsByKey.get(key) === startPromise) {
          startsByKey.delete(key);
        }
      };
      void startPromise.then(clearStart, clearStart);

      return startPromise;
    },
    clear: () => {
      startsByKey.clear();
    },
  };
};
