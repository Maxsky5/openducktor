import { useCallback, useState } from "react";

export function useAgentStudioGitActionErrors(scopeKey: string) {
  const [commitError, setCommitError] = useError(scopeKey);
  const [pushError, setPushError] = useError(scopeKey);
  const [rebaseError, setRebaseError] = useError(scopeKey);
  const [changeError, setChangeError] = useError(scopeKey);

  const clearActionErrors = useCallback(() => {
    setCommitError(null);
    setPushError(null);
    setRebaseError(null);
    setChangeError(null);
  }, [setCommitError, setPushError, setRebaseError, setChangeError]);

  return {
    commitError,
    pushError,
    rebaseError,
    changeError,
    setCommitError,
    setPushError,
    setRebaseError,
    setChangeError,
    clearActionErrors,
  };
}

function useError(scopeKey: string): readonly [string | null, (message: string | null) => void] {
  const [error, setError] = useState<{ scopeKey: string; message: string } | null>(null);
  // Action callbacks keep this setter, so late errors stay in their original scope.
  const setMessage = useCallback(
    (message: string | null) => {
      setError((current) => {
        if (message !== null) return { scopeKey, message };
        return current?.scopeKey === scopeKey ? null : current;
      });
    },
    [scopeKey],
  );
  return [error?.scopeKey === scopeKey ? error.message : null, setMessage];
}
