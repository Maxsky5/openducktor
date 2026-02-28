import { useCallback, useEffect, useRef, useState } from "react";
import type {
  NewSessionStartDecision,
  NewSessionStartRequest,
} from "./use-agent-studio-session-actions";

export function useAgentStudioSessionStartRequest(): {
  pendingSessionStartRequest: NewSessionStartRequest | null;
  requestNewSessionStart: (request: NewSessionStartRequest) => Promise<NewSessionStartDecision>;
  resolvePendingSessionStart: (decision: NewSessionStartDecision) => void;
} {
  const [pendingSessionStartRequest, setPendingSessionStartRequest] =
    useState<NewSessionStartRequest | null>(null);
  const pendingSessionStartResolverRef = useRef<
    ((decision: NewSessionStartDecision) => void) | null
  >(null);

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
        setPendingSessionStartRequest(request);
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
