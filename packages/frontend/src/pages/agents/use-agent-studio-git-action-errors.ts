import { useCallback, useState } from "react";

export function useAgentStudioGitActionErrors() {
  const [commitError, setCommitError] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [rebaseError, setRebaseError] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const clearActionErrors = useCallback(() => {
    setCommitError(null);
    setPushError(null);
    setRebaseError(null);
    setResetError(null);
  }, []);

  return {
    commitError,
    pushError,
    rebaseError,
    resetError,
    setCommitError,
    setPushError,
    setRebaseError,
    setResetError,
    clearActionErrors,
  };
}
