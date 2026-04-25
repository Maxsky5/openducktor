import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import {
  type AgentStudioNavigationState,
  type AgentStudioQueryUpdate,
  applyQueryUpdateToNavigationState,
  buildSearchParamsFromNavigationState,
  isSameNavigationState,
  parseNavigationStateFromSearchParams,
} from "./agent-studio-navigation";

type UseNavigationUrlSyncArgs = {
  navigationType: "POP" | "PUSH" | "REPLACE";
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
};

type UseNavigationUrlSyncResult = {
  navigation: AgentStudioNavigationState;
  setNavigation: Dispatch<SetStateAction<AgentStudioNavigationState>>;
  updateQuery: (updates: AgentStudioQueryUpdate) => void;
};

export function useNavigationUrlSync({
  navigationType,
  searchParams,
  setSearchParams,
}: UseNavigationUrlSyncArgs): UseNavigationUrlSyncResult {
  const syncingFromSearchParamsRef = useRef(false);
  const latestSearchParamsRef = useRef<URLSearchParams>(new URLSearchParams(searchParams));
  const pendingSearchParamWritesRef = useRef<string[]>([]);
  const [navigation, setNavigation] = useState<AgentStudioNavigationState>(() =>
    parseNavigationStateFromSearchParams(searchParams),
  );

  const updateQuery = useCallback((updates: AgentStudioQueryUpdate): void => {
    setNavigation((current) => applyQueryUpdateToNavigationState(current, updates));
  }, []);

  useEffect(() => {
    const currentSearchParamsKey = toCanonicalSearchParamsKey(searchParams);
    const pendingWriteIndex =
      navigationType === "POP"
        ? -1
        : pendingSearchParamWritesRef.current.indexOf(currentSearchParamsKey);
    if (pendingWriteIndex !== -1) {
      pendingSearchParamWritesRef.current.splice(pendingWriteIndex, 1);

      if (pendingSearchParamWritesRef.current.length === 0) {
        latestSearchParamsRef.current = new URLSearchParams(searchParams);
      }
      return;
    }

    pendingSearchParamWritesRef.current = [];
    latestSearchParamsRef.current = new URLSearchParams(searchParams);

    const parsed = parseNavigationStateFromSearchParams(searchParams);
    setNavigation((current) => {
      if (isSameNavigationState(current, parsed)) {
        return current;
      }
      syncingFromSearchParamsRef.current = true;
      return parsed;
    });
  }, [navigationType, searchParams]);

  useEffect(() => {
    if (syncingFromSearchParamsRef.current) {
      syncingFromSearchParamsRef.current = false;
      return;
    }

    const currentSearchParams = toCanonicalSearchParamsKey(latestSearchParamsRef.current);
    const next = buildSearchParamsFromNavigationState(latestSearchParamsRef.current, navigation);
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
  }, [navigation, setSearchParams]);

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
