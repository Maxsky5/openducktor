import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";

/** Ignore a retry result after its session or workspace changes. */
export function useSessionRecoveryAction(
  scopeKey: string,
  action: (() => void | Promise<void>) | null,
): Recovery {
  const [attempt, setAttempt] = useState<{
    scopeKey: string;
    isPending: boolean;
    error: Error | null;
  }>({ scopeKey, isPending: false, error: null });
  const activeAttempt = useRef<object | null>(null);
  const hasAction = action !== null;
  useLayoutEffect(
    () => () => {
      activeAttempt.current = null;
    },
    [scopeKey, hasAction],
  );
  if (attempt.scopeKey !== scopeKey || (!action && (attempt.isPending || attempt.error))) {
    setAttempt({ scopeKey, isPending: false, error: null });
  }
  const retry = useCallback((): void => {
    if (!action || activeAttempt.current) return;
    const token = {};
    activeAttempt.current = token;
    setAttempt({ scopeKey, isPending: true, error: null });
    const finish = (error: Error | null) => {
      if (activeAttempt.current !== token) return;
      activeAttempt.current = null;
      setAttempt({ scopeKey, isPending: false, error });
    };
    try {
      const result = action();
      if (result instanceof Promise) {
        void result.then(
          () => finish(null),
          (cause: unknown) => finish(new Error(errorMessage(cause), { cause })),
        );
      } else {
        finish(null);
      }
    } catch (cause) {
      finish(new Error(errorMessage(cause), { cause }));
    }
  }, [action, scopeKey]);
  const current = attempt.scopeKey === scopeKey ? attempt : null;
  return { retry, isPending: current?.isPending ?? false, error: current?.error ?? null };
}

type Recovery = {
  retry: () => void;
  isPending: boolean;
  error: Error | null;
};
