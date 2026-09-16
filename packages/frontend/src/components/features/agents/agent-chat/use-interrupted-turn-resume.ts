import { HostInvokeError } from "@openducktor/host-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { errorMessage } from "@/lib/errors";
import { getAgentSessionResumeFailureNotice } from "@/state/agent-runtime-services";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

export type InterruptedTurnResumeController = {
  readonly resume: (identity: AgentSessionIdentity) => void;
  readonly isSessionResuming: (sessionKey: string) => boolean;
  readonly resumeErrorForSession: (sessionKey: string) => string | null;
};

const EMPTY_SESSION_KEYS: ReadonlySet<string> = new Set();
const EMPTY_FAILURES: ReadonlyMap<string, string> = new Map();

/**
 * Runs interrupted-turn resumes and keys the loading and failure state by session.
 * A resume that settles after the user selects another session cannot show its
 * progress or its error on the newly selected session.
 */
export const useInterruptedTurnResume = (
  continueInterruptedTurn: (identity: AgentSessionIdentity) => Promise<void>,
): InterruptedTurnResumeController => {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const activeSessionKeysRef = useRef(new Set<string>());
  const [resumingSessionKeys, setResumingSessionKeys] =
    useState<ReadonlySet<string>>(EMPTY_SESSION_KEYS);
  const [failures, setFailures] = useState<ReadonlyMap<string, string>>(EMPTY_FAILURES);

  const resume = useCallback(
    (identity: AgentSessionIdentity): void => {
      const sessionKey = agentSessionIdentityKey(identity);
      if (activeSessionKeysRef.current.has(sessionKey)) {
        return;
      }
      activeSessionKeysRef.current.add(sessionKey);
      setResumingSessionKeys(new Set(activeSessionKeysRef.current));
      setFailures((current) => {
        if (!current.has(sessionKey)) {
          return current;
        }
        const next = new Map(current);
        next.delete(sessionKey);
        return next;
      });
      void continueInterruptedTurn(identity)
        .catch((cause: unknown) => {
          if (!mounted.current || !activeSessionKeysRef.current.has(sessionKey)) {
            return;
          }
          const notice =
            cause instanceof HostInvokeError ? getAgentSessionResumeFailureNotice(cause) : null;
          setFailures((current) => new Map(current).set(sessionKey, notice ?? errorMessage(cause)));
        })
        .finally(() => {
          if (!activeSessionKeysRef.current.delete(sessionKey)) {
            return;
          }
          if (mounted.current) {
            setResumingSessionKeys(new Set(activeSessionKeysRef.current));
          }
        });
    },
    [continueInterruptedTurn],
  );

  const isSessionResuming = useCallback(
    (sessionKey: string): boolean => resumingSessionKeys.has(sessionKey),
    [resumingSessionKeys],
  );
  const resumeErrorForSession = useCallback(
    (sessionKey: string): string | null => failures.get(sessionKey) ?? null,
    [failures],
  );

  return useMemo(
    () => ({ resume, isSessionResuming, resumeErrorForSession }),
    [isSessionResuming, resume, resumeErrorForSession],
  );
};
