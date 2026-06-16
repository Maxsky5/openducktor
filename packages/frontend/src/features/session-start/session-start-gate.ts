export type SessionStartGate<Result> = {
  run: (key: string, start: () => Promise<Result>) => Promise<Result>;
  clear: () => void;
};

export const createSessionStartGate = <Result>(): SessionStartGate<Result> => {
  const startsByKey = new Map<string, Promise<Result>>();

  return {
    run: (key, start) => {
      const inFlightStart = startsByKey.get(key);
      if (inFlightStart) {
        return inFlightStart;
      }

      const startPromise = start();
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
