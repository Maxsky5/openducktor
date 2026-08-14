import type {
  AgentRuntimes,
  RuntimeExecutableCheckResult,
  RuntimeKind,
} from "@openducktor/contracts";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { runtimeExecutableQueryOptions } from "./runtime";

const RUNTIME_KINDS = ["opencode", "codex", "claude"] as const;

export type RuntimeExecutableValidationState = {
  results: RuntimeExecutableCheckResult[];
  checkingRuntimeKinds: RuntimeKind[];
  error: Error | null;
  refetch: () => Promise<void>;
};

export const useRuntimeExecutableValidation = (
  runtimes: AgentRuntimes | null,
  enabled: boolean,
): RuntimeExecutableValidationState => {
  const queries = useQueries({
    queries: RUNTIME_KINDS.map((kind) => ({
      ...runtimeExecutableQueryOptions(kind, runtimes?.[kind].executablePath ?? ""),
      enabled: enabled && runtimes !== null,
    })),
  });
  const opencodeResult = queries[0]?.data;
  const codexResult = queries[1]?.data;
  const claudeResult = queries[2]?.data;
  const results = useMemo(
    () =>
      [opencodeResult, codexResult, claudeResult].filter(
        (result): result is RuntimeExecutableCheckResult => result !== undefined,
      ),
    [claudeResult, codexResult, opencodeResult],
  );
  const checkingRuntimeKinds = RUNTIME_KINDS.filter((_, index) => {
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
