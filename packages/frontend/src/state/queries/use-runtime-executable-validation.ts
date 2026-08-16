import type {
  AgentRuntimes,
  RuntimeExecutableCheckResult,
  RuntimeKind,
} from "@openducktor/contracts";
import { knownRuntimeKindValues } from "@openducktor/contracts";
import { useIsFetching, useQueries, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@/lib/errors";
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

const activeOtherValidationCountForKind = (
  kind: RuntimeKind,
  opencode: number,
  codex: number,
  claude: number,
): number => {
  if (kind === "opencode") return opencode;
  if (kind === "codex") return codex;
  return claude;
};

export const useRuntimeExecutableValidation = (
  runtimes: AgentRuntimes | null,
  enabled: boolean,
): RuntimeExecutableValidationState => {
  const queryClient = useQueryClient();
  const opencodePath = runtimes?.opencode.executablePath ?? "";
  const codexPath = runtimes?.codex.executablePath ?? "";
  const claudePath = runtimes?.claude.executablePath ?? "";
  const activeOpenCodeValidationCount = useIsFetching({
    queryKey: runtimeQueryKeys.executableKind("opencode"),
    predicate: (query) => query.queryKey.at(-1) !== opencodePath,
  });
  const activeCodexValidationCount = useIsFetching({
    queryKey: runtimeQueryKeys.executableKind("codex"),
    predicate: (query) => query.queryKey.at(-1) !== codexPath,
  });
  const activeClaudeValidationCount = useIsFetching({
    queryKey: runtimeQueryKeys.executableKind("claude"),
    predicate: (query) => query.queryKey.at(-1) !== claudePath,
  });
  const inputs = knownRuntimeKindValues.map((kind) => ({
    kind,
    path: runtimes?.[kind].executablePath ?? "",
  }));
  const queries = useQueries({
    queries: inputs.map(({ kind, path }) => ({
      ...runtimeExecutableQueryOptions(kind, path),
      enabled:
        enabled &&
        runtimes !== null &&
        activeOtherValidationCountForKind(
          kind,
          activeOpenCodeValidationCount,
          activeCodexValidationCount,
          activeClaudeValidationCount,
        ) === 0,
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
