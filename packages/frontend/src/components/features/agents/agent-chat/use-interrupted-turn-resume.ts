import { HostInvokeError } from "@openducktor/host-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { errorMessage } from "@/lib/errors";
import {
  getAgentSessionResumeFailureNotice,
  type AgentSessionResumeFailureNotice,
} from "@/state/agent-runtime-services";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

export type InterruptedTurnResumeController = {
  readonly resume: (identity: AgentSessionIdentity) => void;
  readonly isSessionResuming: (sessionKey: string) => boolean;
  readonly resumeErrorForSession: (sessionKey: string) => string | null;
  /**
   * The text of a resume failure that outlives the Resume action. The runtime was not
   * available to answer for the continuation, and the chat keeps the notice after the
   * session stops offering Resume.
   */
  readonly persistentResumeErrorForSession: (sessionKey: string) => string | null;
};

type InterruptedTurnResumeFailure = {
  readonly text: string;
  readonly persistent: boolean;
};

const EMPTY_SESSION_KEYS: ReadonlySet<string> = new Set();
const EMPTY_FAILURES: ReadonlyMap<string, InterruptedTurnResumeFailure> = new Map();

/**
 * A `runtime_unavailable` failure must outlive the Resume action: the runtime can be
 * working on the accepted continuation after the turn stops offering Resume.
 */
const failureSurvivesResumeAction = (notice: AgentSessionResumeFailureNotice): boolean =>
  notice.reason === "runtime_unavailable";

const toResumeFailure = (cause: unknown): InterruptedTurnResumeFailure => {
  const notice =
    cause instanceof HostInvokeError ? getAgentSessionResumeFailureNotice(cause) : null;
  if (!notice) {
    return { text: errorMessage(cause), persistent: false };
  }
  return { text: notice.text, persistent: failureSurvivesResumeAction(notice) };
};

/**
 * The selected session the resume state belongs to. `sessionKey` is null when no
 * session is selected, and `isLatestTurnSettled` is true when the transcript shows
 * the latest turn finished.
 */
export type InterruptedTurnResumeTurnState = {
  readonly sessionKey: string | null;
  readonly isLatestTurnSettled: boolean;
};

/**
 * Runs interrupted-turn resumes and keys the loading and failure state by session.
 * A resume that settles after the user selects another session cannot show its
 * progress or its error on the newly selected session. A failure is dropped once the
 * transcript shows the latest turn finished, so a stale notice cannot outlive the
 * turn it was meant to explain.
 */
export const useInterruptedTurnResume = (
  continueInterruptedTurn: (identity: AgentSessionIdentity) => Promise<void>,
  turnState: InterruptedTurnResumeTurnState,
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
  const [failures, setFailures] =
    useState<ReadonlyMap<string, InterruptedTurnResumeFailure>>(EMPTY_FAILURES);

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
          setFailures((current) => new Map(current).set(sessionKey, toResumeFailure(cause)));
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

  const clearResumeFailureForSession = useCallback((sessionKey: string): void => {
    setFailures((current) => {
      if (!current.has(sessionKey)) {
        return current;
      }
      const next = new Map(current);
      next.delete(sessionKey);
      return next;
    });
  }, []);

  const { isLatestTurnSettled, sessionKey } = turnState;
  const hasFailureForSession = sessionKey !== null && failures.has(sessionKey);
  useEffect(() => {
    if (sessionKey === null || !isLatestTurnSettled || !hasFailureForSession) {
      return;
    }
    clearResumeFailureForSession(sessionKey);
  }, [clearResumeFailureForSession, hasFailureForSession, isLatestTurnSettled, sessionKey]);

  const isSessionResuming = useCallback(
    (sessionKey: string): boolean => resumingSessionKeys.has(sessionKey),
    [resumingSessionKeys],
  );
  const resumeErrorForSession = useCallback(
    (sessionKey: string): string | null => failures.get(sessionKey)?.text ?? null,
    [failures],
  );
  const persistentResumeErrorForSession = useCallback(
    (sessionKey: string): string | null => {
      const failure = failures.get(sessionKey);
      return failure?.persistent === true ? failure.text : null;
    },
    [failures],
  );

  return useMemo(
    () => ({ resume, isSessionResuming, resumeErrorForSession, persistentResumeErrorForSession }),
    [isSessionResuming, persistentResumeErrorForSession, resume, resumeErrorForSession],
  );
};
