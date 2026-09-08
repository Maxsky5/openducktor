import type { GitTargetBranch } from "@openducktor/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { targetBranchFromSelection } from "@/lib/target-branch";

type PromptRequest = {
  requestId: string | undefined;
  resolveKickoffPrompt: ((targetBranch?: GitTargetBranch) => Promise<string>) | undefined;
  selectedTargetBranch: string;
};

export function useSessionStartKickoffPrompt({
  requestId,
  resolveKickoffPrompt,
  selectedTargetBranch,
}: PromptRequest) {
  const [retryVersion, setRetryVersion] = useState(0);
  // Returning to an earlier branch still needs a new read; equal inputs cannot revive its old result.
  const request = useMemo(
    () => ({ requestId, resolveKickoffPrompt, selectedTargetBranch, retryVersion }),
    [requestId, resolveKickoffPrompt, selectedTargetBranch, retryVersion],
  );
  const [result, setResult] = useState<{
    request: typeof request;
    text?: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    const resolve = request.resolveKickoffPrompt;
    if (!resolve) return;
    let active = true;
    void (async () => {
      try {
        const branch = request.selectedTargetBranch
          ? targetBranchFromSelection(request.selectedTargetBranch)
          : undefined;
        const text = await resolve(branch);
        if (active) setResult({ request, text });
      } catch (cause) {
        if (active) setResult({ request, error: errorMessage(cause) });
      }
    })();
    return () => {
      active = false;
    };
  }, [request]);

  const retry = useCallback(() => setRetryVersion((version) => version + 1), []);
  const currentResult = resolveKickoffPrompt && result?.request === request ? result : null;

  return {
    kickoffPrompt: currentResult?.text,
    isKickoffPromptLoading: Boolean(resolveKickoffPrompt) && currentResult === null,
    kickoffPromptError: currentResult?.error ?? null,
    onRetryKickoffPrompt: retry,
  };
}
