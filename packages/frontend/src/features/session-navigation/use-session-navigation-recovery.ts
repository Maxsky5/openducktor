import { useSessionRecoveryAction } from "./use-session-recovery-action";

export function useSessionNavigationRecovery({
  scopeKey,
  readError,
  writeError,
  retryRead,
  retryWrite,
}: {
  scopeKey: string;
  readError: Error | null;
  writeError: Error | null;
  retryRead: () => void | Promise<void>;
  retryWrite: () => void | Promise<void>;
}): SessionNavigationRecovery {
  const recovery = useSessionRecoveryAction(scopeKey, readError ? retryRead : retryWrite);
  return {
    navigationPersistenceError: readError ?? writeError ?? recovery.error,
    navigationPersistenceOperation: readError ? "load" : "save",
    retryNavigationPersistence: recovery.retry,
    isRetryingNavigationPersistence: recovery.isPending,
  };
}

export type SessionNavigationRecovery = {
  navigationPersistenceError: Error | null;
  navigationPersistenceOperation: "load" | "save";
  retryNavigationPersistence: () => void;
  isRetryingNavigationPersistence: boolean;
};
