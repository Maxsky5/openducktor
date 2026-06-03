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

const readControllerRef = <T>(ref: { current: T | null }, label: string): T => {
  if (ref.current === null) {
    throw new Error(`Diff request controller ${label} ref was not initialized.`);
  }

  return ref.current;
};

export function useAgentStudioDiffRequestController(): UseAgentStudioDiffRequestControllerResult {
  const versionByScopeAndModeRef = useRef<RequestStatusByScopeAndMode | null>(null);
  const requestSequenceRef = useRef(0);
  const inFlightScopeRequestRef = useRef<InFlightRequestState | null>(null);
  const queuedFullReloadByScopeRef = useRef<QueuedFullReloadState | null>(null);
  const invalidatedFullReloadByScopeRef = useRef<ScopeInvalidationState | null>(null);
  const latestLoadingRequestSequenceRef = useRef<number | null>(null);

  if (versionByScopeAndModeRef.current === null) {
    versionByScopeAndModeRef.current = createVersionState();
  }
  if (inFlightScopeRequestRef.current === null) {
    inFlightScopeRequestRef.current = createInFlightState();
  }
  if (queuedFullReloadByScopeRef.current === null) {
    queuedFullReloadByScopeRef.current = createQueuedFullReloadState();
  }
  if (invalidatedFullReloadByScopeRef.current === null) {
    invalidatedFullReloadByScopeRef.current = createScopeInvalidationState();
  }

  const resetRequestTracking = useCallback((): void => {
    const versionByScopeAndMode = readControllerRef(versionByScopeAndModeRef, "version state");

    versionByScopeAndModeRef.current = invalidateVersionState(versionByScopeAndMode);
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
      const inFlightScopeRequest = readControllerRef(
        inFlightScopeRequestRef,
        "in-flight request state",
      );
      const queuedFullReloadByScope = readControllerRef(
        queuedFullReloadByScopeRef,
        "queued reload state",
      );
      const versionByScopeAndMode = readControllerRef(versionByScopeAndModeRef, "version state");

      if (inFlightScopeRequest[scope][mode] === requestKey) {
        if (mode === "full" && replayIfInFlight) {
          queuedFullReloadByScope[scope] = {
            force: (queuedFullReloadByScope[scope]?.force ?? false) || force,
          };
        }
        return { kind: "skip" };
      }

      if (mode === "summary" && inFlightScopeRequest[scope].full === requestKey) {
        return { kind: "skip" };
      }

      inFlightScopeRequest[scope][mode] = requestKey;
      const version = ++versionByScopeAndMode[scope][mode];
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
      const inFlightScopeRequest = readControllerRef(
        inFlightScopeRequestRef,
        "in-flight request state",
      );
      const queuedFullReloadByScope = readControllerRef(
        queuedFullReloadByScopeRef,
        "queued reload state",
      );

      if (inFlightScopeRequest[scope][mode] === requestKey) {
        inFlightScopeRequest[scope][mode] = null;
      }

      const clearLoading =
        showLoading && latestLoadingRequestSequenceRef.current === requestSequence;
      if (clearLoading) {
        latestLoadingRequestSequenceRef.current = null;
      }

      const replayFullLoad = queuedFullReloadByScope[scope];
      if (mode !== "full" || replayFullLoad == null) {
        return {
          clearLoading,
          replayFullLoad: null,
        };
      }

      queuedFullReloadByScope[scope] = null;

      return {
        clearLoading,
        replayFullLoad,
      };
    },
    [],
  );

  const shouldApplyResult = useCallback(
    (scope: DiffScope, mode: LoadDataMode, version: number): boolean =>
      readControllerRef(versionByScopeAndModeRef, "version state")[scope][mode] === version,
    [],
  );

  const markScopeInvalidated = useCallback((scope: DiffScope): void => {
    readControllerRef(invalidatedFullReloadByScopeRef, "scope invalidation state")[scope] = true;
  }, []);

  const clearScopeInvalidation = useCallback((scope: DiffScope): void => {
    readControllerRef(invalidatedFullReloadByScopeRef, "scope invalidation state")[scope] = false;
  }, []);

  const isScopeInvalidated = useCallback(
    (scope: DiffScope): boolean =>
      readControllerRef(invalidatedFullReloadByScopeRef, "scope invalidation state")[scope],
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
