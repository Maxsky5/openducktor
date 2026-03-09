import { useCallback, useEffect, useRef, useState } from "react";
import type {
  NewSessionStartDecision,
  NewSessionStartRequest,
} from "./use-agent-studio-session-actions";

export type PendingSessionStartRequest = NewSessionStartRequest & {
  requestId: string;
};

export function useAgentStudioSessionStartRequest(): {
  pendingSessionStartRequest: PendingSessionStartRequest | null;
  requestNewSessionStart: (request: NewSessionStartRequest) => Promise<NewSessionStartDecision>;
  resolvePendingSessionStart: (decision: NewSessionStartDecision) => void;
} {
  const [pendingSessionStartRequest, setPendingSessionStartRequest] =
    useState<PendingSessionStartRequest | null>(null);
  const pendingSessionStartResolverRef = useRef<
    ((decision: NewSessionStartDecision) => void) | null
  >(null);
  const requestSequenceRef = useRef(0);

  const resolvePendingSessionStart = useCallback((decision: NewSessionStartDecision): void => {
    const resolver = pendingSessionStartResolverRef.current;
    pendingSessionStartResolverRef.current = null;
    setPendingSessionStartRequest(null);
    resolver?.(decision);
  }, []);

  const requestNewSessionStart = useCallback(
    (request: NewSessionStartRequest): Promise<NewSessionStartDecision> => {
      pendingSessionStartResolverRef.current?.(null);
      return new Promise((resolve) => {
        pendingSessionStartResolverRef.current = resolve;
        const requestId = `session-start-${requestSequenceRef.current}`;
        requestSequenceRef.current += 1;
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
      pendingSessionStartResolverRef.current?.(null);
      pendingSessionStartResolverRef.current = null;
    };
  }, []);

  return {
    pendingSessionStartRequest,
    requestNewSessionStart,
    resolvePendingSessionStart,
  };
}
