import { useCallback, useRef } from "react";
import type { DiffScope } from "../contracts";
import type { LoadDataMode } from "../model/diff-data-model";

type RequestStatusByScopeAndMode = Record<DiffScope, Record<LoadDataMode, number>>;
type InFlightRequestState = Record<DiffScope, Record<LoadDataMode, string | null>>;
type QueuedFullReloadState = Record<DiffScope, { force: boolean } | null>;
type ScopeInvalidationState = Record<DiffScope, boolean>;

type BeginRequestArgs = {
  scope: DiffScope;
  mode: LoadDataMode;
  requestKey: string;
  showLoading: boolean;
  replayIfInFlight: boolean;
  force: boolean;
};

type BeginRequestResult =
  | { kind: "skip" }
  | { kind: "begin"; requestSequence: number; version: number };

type FinishRequestArgs = {
  scope: DiffScope;
  mode: LoadDataMode;
  requestKey: string;
  requestSequence: number;
  showLoading: boolean;
};

type FinishRequestResult = {
  clearLoading: boolean;
  replayFullLoad: { force: boolean } | null;
};

type UseAgentStudioDiffRequestControllerResult = {
  beginRequest: (args: BeginRequestArgs) => BeginRequestResult;
  finishRequest: (args: FinishRequestArgs) => FinishRequestResult;
  resetRequestTracking: () => void;
  shouldApplyResult: (scope: DiffScope, mode: LoadDataMode, version: number) => boolean;
  markScopeInvalidated: (scope: DiffScope) => void;
  clearScopeInvalidation: (scope: DiffScope) => void;
  isScopeInvalidated: (scope: DiffScope) => boolean;
};

const createVersionState = (): RequestStatusByScopeAndMode => ({
  target: { full: 0, summary: 0 },
  uncommitted: { full: 0, summary: 0 },
});

const invalidateVersionState = (
  currentState: RequestStatusByScopeAndMode,
): RequestStatusByScopeAndMode => ({
  target: {
    full: currentState.target.full + 1,
    summary: currentState.target.summary + 1,
  },
  uncommitted: {
    full: currentState.uncommitted.full + 1,
    summary: currentState.uncommitted.summary + 1,
  },
});

const createInFlightState = (): InFlightRequestState => ({
  target: { full: null, summary: null },
  uncommitted: { full: null, summary: null },
});

const createQueuedFullReloadState = (): QueuedFullReloadState => ({
  target: null,
  uncommitted: null,
});

const createScopeInvalidationState = (): ScopeInvalidationState => ({
  target: false,
  uncommitted: false,
});

export function useAgentStudioDiffRequestController(): UseAgentStudioDiffRequestControllerResult {
  const versionByScopeAndModeRef = useRef(createVersionState());
  const requestSequenceRef = useRef(0);
  const inFlightScopeRequestRef = useRef(createInFlightState());
  const queuedFullReloadByScopeRef = useRef(createQueuedFullReloadState());
  const invalidatedFullReloadByScopeRef = useRef(createScopeInvalidationState());
  const latestLoadingRequestSequenceRef = useRef<number | null>(null);

  const resetRequestTracking = useCallback((): void => {
    versionByScopeAndModeRef.current = invalidateVersionState(versionByScopeAndModeRef.current);
    inFlightScopeRequestRef.current = createInFlightState();
    queuedFullReloadByScopeRef.current = createQueuedFullReloadState();
    invalidatedFullReloadByScopeRef.current = {
      target: true,
      uncommitted: true,
    };
    latestLoadingRequestSequenceRef.current = null;
  }, []);

  const beginRequest = useCallback(
    ({
      force,
      mode,
      replayIfInFlight,
      requestKey,
      scope,
      showLoading,
    }: BeginRequestArgs): BeginRequestResult => {
      if (inFlightScopeRequestRef.current[scope][mode] === requestKey) {
        if (mode === "full" && replayIfInFlight) {
          queuedFullReloadByScopeRef.current[scope] = {
            force: (queuedFullReloadByScopeRef.current[scope]?.force ?? false) || force,
          };
        }
        return { kind: "skip" };
      }

      if (mode === "summary" && inFlightScopeRequestRef.current[scope].full === requestKey) {
        return { kind: "skip" };
      }

      inFlightScopeRequestRef.current[scope][mode] = requestKey;
      const version = ++versionByScopeAndModeRef.current[scope][mode];
      const requestSequence = ++requestSequenceRef.current;

      if (showLoading) {
        latestLoadingRequestSequenceRef.current = requestSequence;
      }

      return {
        kind: "begin",
        requestSequence,
        version,
      };
    },
    [],
  );

  const finishRequest = useCallback(
    ({
      mode,
      requestKey,
      requestSequence,
      scope,
      showLoading,
    }: FinishRequestArgs): FinishRequestResult => {
      if (inFlightScopeRequestRef.current[scope][mode] === requestKey) {
        inFlightScopeRequestRef.current[scope][mode] = null;
      }

      const clearLoading =
        showLoading && latestLoadingRequestSequenceRef.current === requestSequence;
      if (clearLoading) {
        latestLoadingRequestSequenceRef.current = null;
      }

      const replayFullLoad = queuedFullReloadByScopeRef.current[scope];
      if (mode !== "full" || replayFullLoad == null) {
        return {
          clearLoading,
          replayFullLoad: null,
        };
      }

      queuedFullReloadByScopeRef.current[scope] = null;

      return {
        clearLoading,
        replayFullLoad,
      };
    },
    [],
  );

  const shouldApplyResult = useCallback(
    (scope: DiffScope, mode: LoadDataMode, version: number): boolean =>
      versionByScopeAndModeRef.current[scope][mode] === version,
    [],
  );

  const markScopeInvalidated = useCallback((scope: DiffScope): void => {
    invalidatedFullReloadByScopeRef.current[scope] = true;
  }, []);

  const clearScopeInvalidation = useCallback((scope: DiffScope): void => {
    invalidatedFullReloadByScopeRef.current[scope] = false;
  }, []);

  const isScopeInvalidated = useCallback(
    (scope: DiffScope): boolean => invalidatedFullReloadByScopeRef.current[scope],
    [],
  );

  return {
    beginRequest,
    finishRequest,
    resetRequestTracking,
    shouldApplyResult,
    markScopeInvalidated,
    clearScopeInvalidation,
    isScopeInvalidated,
  };
}
