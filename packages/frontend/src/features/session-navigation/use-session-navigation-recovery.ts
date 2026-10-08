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
  const operation = readError ? "load" : "save";
  const recovery = useSessionRecoveryAction(
    `${scopeKey}:${operation}`,
    readError ? retryRead : retryWrite,
  );
  return {
    navigationPersistenceError: readError ?? writeError ?? recovery.error,
    navigationPersistenceOperation: operation,
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
