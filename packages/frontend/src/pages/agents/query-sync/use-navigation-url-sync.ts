import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SetURLSearchParams } from "react-router";
import {
  type AgentStudioNavigationState,
  type AgentStudioQueryUpdate,
  applyQueryUpdateToNavigationState,
  buildSearchParamsFromNavigationState,
  isSameNavigationState,
  parseNavigationStateFromSearchParams,
} from "./agent-studio-navigation";

type UseNavigationUrlSyncArgs = {
  workspaceId: string | null;
  initialNavigation?: AgentStudioNavigationState;
  locationKey: string;
  navigationType: "POP" | "PUSH" | "REPLACE";
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
};

type UseNavigationUrlSyncResult = {
  navigation: AgentStudioNavigationState;
  setNavigation: (
    update: (current: AgentStudioNavigationState) => AgentStudioNavigationState,
  ) => void;
  updateQuery: (updates: AgentStudioQueryUpdate) => void;
};

export function useNavigationUrlSync({
  workspaceId,
  initialNavigation,
  locationKey,
  navigationType,
  searchParams,
  setSearchParams,
}: UseNavigationUrlSyncArgs): UseNavigationUrlSyncResult {
  const [scope, setScope] = useState(() => ({ workspaceId, searchParams, initialNavigation }));
  const waitsForInitialWriteRef = useRef(false);
  const latestSearchParamsRef = useRef(searchParams);
  const pendingSearchParamWritesRef = useRef<string[]>([]);
  const searchKey = toCanonicalSearchParamsKey(searchParams);
  const [snapshot, setSnapshot] = useState(() => ({
    address: { locationKey, navigationType, searchKey, searchParams },
    navigation: initialNavigation ?? parseNavigationStateFromSearchParams(searchParams),
  }));
  const workspaceChanged = scope.workspaceId !== workspaceId;
  let currentSnapshot = snapshot;
  if (
    workspaceChanged ||
    snapshot.address.locationKey !== locationKey ||
    snapshot.address.navigationType !== navigationType ||
    snapshot.address.searchKey !== searchKey
  ) {
    // A delayed echo must not replace a newer local selection. External routes
    // must reach the selection controller in this render, before its effects run.
    const isOwnWrite =
      !workspaceChanged &&
      navigationType === "REPLACE" &&
      pendingSearchParamWritesRef.current.includes(searchKey);
    currentSnapshot = {
      address: { locationKey, navigationType, searchKey, searchParams },
      navigation: workspaceChanged
        ? (initialNavigation ?? parseNavigationStateFromSearchParams(searchParams))
        : isOwnWrite
          ? snapshot.navigation
          : parseNavigationStateFromSearchParams(searchParams),
    };
    setSnapshot(currentSnapshot);
  }
  if (workspaceChanged) {
    setScope({ workspaceId, searchParams, initialNavigation });
  }
  const { address, navigation } = currentSnapshot;

  useLayoutEffect(() => {
    latestSearchParamsRef.current = new URLSearchParams(scope.searchParams);
    pendingSearchParamWritesRef.current = [];
    waitsForInitialWriteRef.current =
      scope.initialNavigation !== undefined &&
      !isSameNavigationState(
        scope.initialNavigation,
        parseNavigationStateFromSearchParams(scope.searchParams),
      );
  }, [scope]);

  const setNavigation = useCallback<UseNavigationUrlSyncResult["setNavigation"]>((update) => {
    setSnapshot((current) => {
      const next = update(current.navigation);
      return isSameNavigationState(current.navigation, next)
        ? current
        : { ...current, navigation: next };
    });
  }, []);

  const updateQuery = useCallback(
    (updates: AgentStudioQueryUpdate): void => {
      setNavigation((current) => applyQueryUpdateToNavigationState(current, updates));
    },
    [setNavigation],
  );

  useLayoutEffect(() => {
    const currentSearchParamsKey = address.searchKey;
    if (
      waitsForInitialWriteRef.current &&
      currentSearchParamsKey === toCanonicalSearchParamsKey(scope.searchParams)
    ) {
      return;
    }
    waitsForInitialWriteRef.current = false;

    const pendingWriteIndex =
      address.navigationType === "REPLACE"
        ? pendingSearchParamWritesRef.current.indexOf(currentSearchParamsKey)
        : -1;
    if (pendingWriteIndex !== -1) {
      pendingSearchParamWritesRef.current.splice(pendingWriteIndex, 1);

      if (pendingSearchParamWritesRef.current.length === 0) {
        latestSearchParamsRef.current = new URLSearchParams(address.searchParams);
      }
      return;
    }

    pendingSearchParamWritesRef.current = [];
    latestSearchParamsRef.current = new URLSearchParams(address.searchParams);
  }, [address, scope]);

  useEffect(() => {
    const latestSearchParams = latestSearchParamsRef.current;
    const currentSearchParams = toCanonicalSearchParamsKey(latestSearchParams);
    const next = buildSearchParamsFromNavigationState(latestSearchParams, navigation);
    const nextSearchParams = toCanonicalSearchParamsKey(next);
    if (nextSearchParams === currentSearchParams) {
      return;
    }

    if (pendingSearchParamWritesRef.current.at(-1) === nextSearchParams) {
      return;
    }

    latestSearchParamsRef.current = new URLSearchParams(next);
    pendingSearchParamWritesRef.current.push(nextSearchParams);
    setSearchParams(next, { replace: true });
  }, [navigation, scope, setSearchParams]);

  return {
    navigation,
    setNavigation,
    updateQuery,
  };
}

const toCanonicalSearchParamsKey = (searchParams: URLSearchParams): string => {
  const sortedEntries = Array.from(searchParams.entries()).sort((left, right) => {
    if (left[0] === right[0]) {
      return left[1].localeCompare(right[1]);
    }
    return left[0].localeCompare(right[0]);
  });

  return new URLSearchParams(sortedEntries).toString();
};
