import { useCallback, useEffect, useRef, useState } from "react";
import type {
  NewSessionStartDecision,
  NewSessionStartRequest,
} from "../use-agent-studio-session-actions";

export type PendingSessionStartRequest = NewSessionStartRequest & {
  requestId: string;
};

export function useAgentStudioSessionStartRequest(): {
  pendingSessionStartRequest: PendingSessionStartRequest | null;
  requestNewSessionStart: (request: NewSessionStartRequest) => Promise<NewSessionStartDecision>;
  resolvePendingSessionStart: (requestId: string, decision: NewSessionStartDecision) => void;
} {
  const [pendingSessionStartRequest, setPendingSessionStartRequest] =
    useState<PendingSessionStartRequest | null>(null);
  const pendingSessionStartResolverRef = useRef<{
    requestId: string;
    resolve: (decision: NewSessionStartDecision) => void;
  } | null>(null);
  const requestSequenceRef = useRef(0);

  const resolvePendingSessionStart = useCallback(
    (requestId: string, decision: NewSessionStartDecision): void => {
      const pending = pendingSessionStartResolverRef.current;
      if (!pending || pending.requestId !== requestId) {
        return;
      }
      pendingSessionStartResolverRef.current = null;
      setPendingSessionStartRequest(null);
      pending.resolve(decision);
    },
    [],
  );

  const requestNewSessionStart = useCallback(
    (request: NewSessionStartRequest): Promise<NewSessionStartDecision> => {
      pendingSessionStartResolverRef.current?.resolve(null);
      return new Promise((resolve) => {
        const requestId = `session-start-${requestSequenceRef.current}`;
        requestSequenceRef.current += 1;
        pendingSessionStartResolverRef.current = {
          requestId,
          resolve,
        };
        setPendingSessionStartRequest({
          ...request,
          requestId,
        });
      });
    },
    [],
  );

  useEffect(() => {
    return () => {
      pendingSessionStartResolverRef.current?.resolve(null);
      pendingSessionStartResolverRef.current = null;
    };
  }, []);

  return {
    pendingSessionStartRequest,
    requestNewSessionStart,
    resolvePendingSessionStart,
  };
}
