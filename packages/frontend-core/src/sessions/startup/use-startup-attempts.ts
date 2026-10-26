import { useEffect, useSyncExternalStore } from "react";
import { useClientConnection } from "../../connection/client-connection-react";
import type { StartupAttempt } from "./startup-attempt-store";
export type {
  StartupAttempt,
  StartupRecoveryAction,
  StartupPresentation,
} from "./startup-attempt-store";

export const useStartupAttempts = (): readonly StartupAttempt[] => {
  const { startupAttempts } = useClientConnection();
  const attempts = useSyncExternalStore(
    startupAttempts.subscribe,
    startupAttempts.getSnapshot,
    startupAttempts.getSnapshot,
  );
  useEffect(() => {
    const deadlines = attempts.flatMap((attempt) =>
      attempt.presentation === "notification" &&
      attempt.status.phase === "ready" &&
      attempt.status.successExpiresAt !== undefined
        ? [attempt.status.successExpiresAt]
        : [],
    );
    if (deadlines.length === 0) return;
    const timer = setTimeout(
      () => startupAttempts.expireSuccess(),
      Math.max(0, Math.min(...deadlines) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [attempts, startupAttempts]);
  // A native app can suspend timers. Expiry is absolute, including its hidden time.
  return attempts.filter(
    (attempt) =>
      attempt.presentation !== "notification" ||
      attempt.status.phase !== "ready" ||
      attempt.status.successExpiresAt === undefined ||
      attempt.status.successExpiresAt > Date.now(),
  );
};

export const useStartupAttempt = (id: string | null | undefined): StartupAttempt | null => {
  const attempts = useStartupAttempts();
  return attempts.find((attempt) => attempt.id === id) ?? null;
};
