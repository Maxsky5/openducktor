import type {
  AgentRuntimes,
  RuntimeExecutableCheckResult,
  RuntimeKind,
} from "@openducktor/contracts";
import { knownRuntimeKindValues } from "@openducktor/contracts";
import { useQueries } from "@tanstack/react-query";
import { runtimeExecutableQueryOptions } from "./runtime";

export type RuntimeExecutableValidationResult = RuntimeExecutableCheckResult & {
  requestedPath: string;
};

export type RuntimeExecutableValidationState = {
  results: RuntimeExecutableValidationResult[];
  checkingRuntimeKinds: RuntimeKind[];
  error: Error | null;
  refetch: () => Promise<void>;
};

export const useRuntimeExecutableValidation = (
  runtimes: AgentRuntimes | null,
  enabled: boolean,
): RuntimeExecutableValidationState => {
  const inputs = knownRuntimeKindValues.map((kind) => ({
    kind,
    path: runtimes?.[kind].executablePath ?? "",
  }));
  const queries = useQueries({
    queries: inputs.map(({ kind, path }) => ({
      ...runtimeExecutableQueryOptions(kind, path),
      enabled: enabled && runtimes !== null,
    })),
  });
  const results = inputs.flatMap(({ path }, index) => {
    const result = queries[index]?.data;
    return result ? [{ ...result, requestedPath: path }] : [];
  });
  const checkingRuntimeKinds = knownRuntimeKindValues.filter((_, index) => {
    const query = queries[index];
    return query?.isPending || query?.isFetching;
  });
  const error = queries.find((query) => query?.error)?.error ?? null;

  return {
    results,
    checkingRuntimeKinds,
    error,
    refetch: async () => {
      const failedQueries = queries.filter((query) => query.error !== null);
      const queriesToRefetch = failedQueries.length > 0 ? failedQueries : queries;
      await Promise.all(queriesToRefetch.map((query) => query.refetch()));
    },
  };
};
