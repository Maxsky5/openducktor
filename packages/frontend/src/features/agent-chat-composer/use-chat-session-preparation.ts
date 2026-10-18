import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";

type Attempt = {
  key: string;
  enabled: boolean;
  prepare: () => Promise<void>;
  token: object;
  result: { error: string | null } | null;
};

export function useChatSessionPreparation({
  targetKey,
  enabled,
  prepare,
}: {
  targetKey: string;
  enabled: boolean;
  prepare: () => Promise<void>;
}): { ready: boolean; error: string | null } {
  const [attempt, setAttempt] = useState<Attempt>(() => ({
    key: targetKey,
    enabled,
    prepare,
    token: {},
    result: null,
  }));
  const changed =
    attempt.key !== targetKey || attempt.enabled !== enabled || attempt.prepare !== prepare;
  // Reset during render so a new target cannot use the previous target's ready state.
  if (changed) setAttempt({ key: targetKey, enabled, prepare, token: {}, result: null });
  const { token } = attempt;
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const settle = (error: string | null) => {
      if (active)
        setAttempt((current) =>
          current.token === token ? { ...current, result: { error } } : current,
        );
    };
    void prepare().then(
      () => settle(null),
      (cause: unknown) => settle(errorMessage(cause)),
    );
    return () => {
      active = false;
    };
  }, [enabled, prepare, token]);
  const result = enabled && !changed ? attempt.result : null;
  const ready = result !== null && result.error === null;
  const error = result?.error ?? null;
  return useMemo(() => ({ ready, error }), [ready, error]);
}
