import { useCallback, useMemo, useRef, useState } from "react";

type ActivityCountByKey = Record<string, number>;

export type AsyncActivityHandle = {
  add: (key: string) => void;
  finish: () => void;
};

/**
 * Counts async work for each key. `isActive` reads render state, and `hasInFlight` reads the
 * work that started before the next render.
 */
export type AsyncActivityTracker = {
  isActive: (key: string) => boolean;
  hasInFlight: (key: string) => boolean;
  begin: (key: string) => AsyncActivityHandle;
};

const incrementActivityCount = (current: ActivityCountByKey, key: string) =>
  ({
    ...current,
    [key]: (current[key] ?? 0) + 1,
  }) satisfies ActivityCountByKey;

const decrementActivityCount = (current: ActivityCountByKey, key: string) => {
  const currentCount = current[key];
  if (!currentCount) {
    return current satisfies ActivityCountByKey;
  }

  if (currentCount === 1) {
    const next = { ...current };
    delete next[key];
    return next satisfies ActivityCountByKey;
  }

  return {
    ...current,
    [key]: currentCount - 1,
  } satisfies ActivityCountByKey;
};

export const useAsyncActivityTracker = (): AsyncActivityTracker => {
  const [activeCountByKey, setActiveCountByKey] = useState<ActivityCountByKey>({});
  // Several handles can track one key, so a key stays in flight until its last handle finishes.
  const inFlightCountByKeyRef = useRef<Map<string, number>>(new Map());

  const isActive = useCallback(
    (key: string): boolean => (activeCountByKey[key] ?? 0) > 0,
    [activeCountByKey],
  );
  const hasInFlight = useCallback(
    (key: string): boolean => inFlightCountByKeyRef.current.has(key),
    [],
  );

  const begin = useCallback((key: string): AsyncActivityHandle => {
    const trackedKeys = new Set<string>();
    let finished = false;

    const add = (key: string): void => {
      if (finished || trackedKeys.has(key)) {
        return;
      }

      trackedKeys.add(key);
      const inFlight = inFlightCountByKeyRef.current;
      inFlight.set(key, (inFlight.get(key) ?? 0) + 1);
      setActiveCountByKey((current) => incrementActivityCount(current, key));
    };

    add(key);

    return {
      add,
      finish: (): void => {
        if (finished) {
          return;
        }

        finished = true;
        const inFlight = inFlightCountByKeyRef.current;
        for (const key of trackedKeys) {
          const count = inFlight.get(key) ?? 0;
          if (count > 1) inFlight.set(key, count - 1);
          else inFlight.delete(key);
        }
        setActiveCountByKey((current) => {
          let next = current;
          for (const key of trackedKeys) {
            next = decrementActivityCount(next, key);
          }
          return next;
        });
      },
    };
  }, []);

  return useMemo(() => ({ isActive, hasInFlight, begin }), [isActive, hasInFlight, begin]);
};
