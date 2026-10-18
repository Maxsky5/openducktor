import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  taskRouteStateSchema,
  readTaskRouteIntent,
  writeTaskRouteIntent,
} from "./task-route-intent";
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
  locationState?: unknown;
  navigationType: "POP" | "PUSH" | "REPLACE";
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
  enabled?: boolean;
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
  locationState,
  navigationType,
  searchParams,
  setSearchParams,
  enabled = true,
}: UseNavigationUrlSyncArgs): UseNavigationUrlSyncResult {
  const routeState = useMemo(() => {
    const parsed = taskRouteStateSchema.safeParse(locationState);
    return parsed.success ? parsed.data : {};
  }, [locationState]);
  const [scope, setScope] = useState(() => ({ workspaceId, searchParams, initialNavigation }));
  const waitsForInitialWriteRef = useRef(false);
  const latestSearchParamsRef = useRef(searchParams);
  const pendingSearchParamWritesRef = useRef<Array<{ key: string; keepSessionless: boolean }>>([]);
  const searchKey = toCanonicalSearchParamsKey(searchParams);
  const [snapshot, setSnapshot] = useState(() => ({
    enabled,
    address: { locationKey, locationState: routeState, navigationType, searchKey, searchParams },
    navigation:
      initialNavigation ??
      readTaskRouteIntent(
        parseNavigationStateFromSearchParams(searchParams),
        workspaceId,
        routeState,
      ),
  }));
  const ownedNavigation = readTaskRouteIntent(
    parseNavigationStateFromSearchParams(searchParams),
    workspaceId,
    routeState,
  );
  const workspaceChanged = scope.workspaceId !== workspaceId;
  let currentSnapshot = snapshot;
  if (
    workspaceChanged ||
    snapshot.enabled !== enabled ||
    snapshot.address.locationState !== routeState ||
    snapshot.address.locationKey !== locationKey ||
    snapshot.address.navigationType !== navigationType ||
    snapshot.address.searchKey !== searchKey
  ) {
    // A delayed echo must not replace a newer local selection. External routes
    // must reach the selection controller in this render, before its effects run.
    const isOwnWrite =
      !workspaceChanged &&
      navigationType === "REPLACE" &&
      pendingSearchParamWritesRef.current.some(
        (write) =>
          write.key === searchKey &&
          write.keepSessionless === Boolean(ownedNavigation.keepSessionless),
      );
    currentSnapshot = {
      enabled,
      address: { locationKey, locationState: routeState, navigationType, searchKey, searchParams },
      navigation:
        snapshot.enabled !== enabled
          ? readTaskRouteIntent(
              parseNavigationStateFromSearchParams(searchParams),
              workspaceId,
              routeState,
            )
          : workspaceChanged
            ? (initialNavigation ??
              readTaskRouteIntent(
                parseNavigationStateFromSearchParams(searchParams),
                workspaceId,
                routeState,
              ))
            : isOwnWrite
              ? snapshot.navigation
              : readTaskRouteIntent(
                  parseNavigationStateFromSearchParams(searchParams),
                  workspaceId,
                  routeState,
                ),
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
      if (!current.enabled) return current;
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
    if (enabled) return;
    pendingSearchParamWritesRef.current = [];
    latestSearchParamsRef.current = new URLSearchParams(address.searchParams);
    waitsForInitialWriteRef.current = false;
  }, [address.searchParams, enabled]);

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
        ? pendingSearchParamWritesRef.current.findIndex(
            (write) =>
              write.key === currentSearchParamsKey &&
              write.keepSessionless === Boolean(ownedNavigation.keepSessionless),
          )
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
  }, [address, ownedNavigation.keepSessionless, scope]);

  useEffect(() => {
    if (!enabled) return;
    const latestSearchParams = latestSearchParamsRef.current;
    const currentSearchParams = toCanonicalSearchParamsKey(latestSearchParams);
    const next = buildSearchParamsFromNavigationState(latestSearchParams, navigation);
    const nextSearchParams = toCanonicalSearchParamsKey(next);
    const owned = readTaskRouteIntent(
      parseNavigationStateFromSearchParams(address.searchParams),
      workspaceId,
      address.locationState,
    );
    if (
      nextSearchParams === currentSearchParams &&
      Boolean(navigation.keepSessionless) === Boolean(owned.keepSessionless)
    ) {
      return;
    }

    const pending = pendingSearchParamWritesRef.current.at(-1);
    if (
      pending?.key === nextSearchParams &&
      pending.keepSessionless === Boolean(navigation.keepSessionless)
    ) {
      return;
    }

    latestSearchParamsRef.current = new URLSearchParams(next);
    pendingSearchParamWritesRef.current.push({
      key: nextSearchParams,
      keepSessionless: Boolean(navigation.keepSessionless),
    });
    setSearchParams(next, {
      replace: true,
      state: writeTaskRouteIntent(navigation, workspaceId, address.locationState),
    });
  }, [
    address.locationState,
    address.searchParams,
    enabled,
    navigation,
    scope,
    setSearchParams,
    workspaceId,
  ]);

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
