import type {
  AgentRuntimes,
  RuntimeExecutableCheckResult,
  RuntimeKind,
} from "@openducktor/contracts";
import { knownRuntimeKindValues } from "@openducktor/contracts";
import { notifyManager, useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { errorMessage } from "../lib/errors";
import { runtimeExecutableQueryOptions, runtimeQueryKeys } from "./runtime";

export type RuntimeExecutableValidationResult = RuntimeExecutableCheckResult & {
  requestedPath: string;
};

export type RuntimeExecutableValidationState = {
  results: RuntimeExecutableValidationResult[];
  checkingRuntimeKinds: RuntimeKind[];
  error: Error | null;
  refetch: () => Promise<void>;
};

type ExecutableInput = { kind: RuntimeKind; path: string };

/**
 * The runtime kinds that validate another executable path now. A kind waits for that check to end
 * before it validates its current path. One query cache subscription serves every kind.
 */
const useKindsValidatingOtherPaths = (inputs: ExecutableInput[]): ReadonlySet<RuntimeKind> => {
  const queryClient = useQueryClient();
  const subscribe = useCallback(
    (onChange: () => void) =>
      queryClient.getQueryCache().subscribe(notifyManager.batchCalls(onChange)),
    [queryClient],
  );
  const readBusyKinds = () =>
    inputs
      .filter(
        ({ kind, path }) =>
          queryClient.isFetching({
            queryKey: runtimeQueryKeys.executableKind(kind),
            predicate: (query) => query.queryKey.at(-1) !== path,
          }) > 0,
      )
      .map(({ kind }) => kind)
      .join(" ");
  const busyKinds = useSyncExternalStore(subscribe, readBusyKinds, readBusyKinds);
  return useMemo(() => {
    const busy = busyKinds.split(" ");
    return new Set(knownRuntimeKindValues.filter((kind) => busy.includes(kind)));
  }, [busyKinds]);
};

export const useRuntimeExecutableValidation = (
  runtimes: AgentRuntimes | null,
  enabled: boolean,
): RuntimeExecutableValidationState => {
  const queryClient = useQueryClient();
  const inputs = knownRuntimeKindValues.map((kind) => ({
    kind,
    path: runtimes?.[kind].executablePath ?? "",
  }));
  const kindsValidatingOtherPaths = useKindsValidatingOtherPaths(inputs);
  const queries = useQueries({
    queries: inputs.map(({ kind, path }) => ({
      ...runtimeExecutableQueryOptions(kind, path),
      enabled: enabled && runtimes !== null && !kindsValidatingOtherPaths.has(kind),
    })),
  });
  const results = inputs.flatMap(({ kind, path }, index) => {
    const query = queries[index];
    if (query?.data) return [{ ...query.data, requestedPath: path }];
    if (!query?.error || runtimes?.[kind].enabled === false) return [];
    return [
      {
        kind,
        path,
        ok: false,
        version: null,
        error: errorMessage(query.error),
        requestedPath: path,
      },
    ];
  });
  const checkingRuntimeKinds = knownRuntimeKindValues.filter((kind, index) => {
    if (!runtimes?.[kind].enabled) return false;
    const query = queries[index];
    return query?.isPending || query?.isFetching;
  });
  let error: Error | null = null;
  if (runtimes) {
    for (const [index, kind] of knownRuntimeKindValues.entries()) {
      if (!runtimes[kind].enabled) continue;
      const queryError = queries[index]?.error;
      if (!queryError) continue;
      error = queryError;
      break;
    }
  }

  return {
    results,
    checkingRuntimeKinds,
    error,
    refetch: async () => {
      const failedInputs = inputs.filter((_, index) => queries[index]?.error !== null);
      const inputsToRefetch = failedInputs.length > 0 ? failedInputs : inputs;
      await Promise.all(
        inputsToRefetch.map(({ kind, path }) =>
          queryClient.refetchQueries({
            queryKey: runtimeQueryKeys.executable(kind, path),
            exact: true,
            type: "active",
          }),
        ),
      );
    },
  };
};
