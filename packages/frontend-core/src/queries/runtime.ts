import type {
  RuntimeDescriptor,
  RuntimeExecutableCheck,
  RuntimeKind,
} from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { validateRuntimeDefinitionsForOpenDucktor } from "../lib/agent-runtime";
import { connectionHost } from "../connection/client-connection";

const RUNTIME_DEFINITIONS_STALE_TIME_MS = 30 * 60_000;

const requireCompatibleRuntimeDefinitions = (
  runtimeDefinitions: RuntimeDescriptor[],
): RuntimeDescriptor[] => {
  const validationErrors = validateRuntimeDefinitionsForOpenDucktor(runtimeDefinitions);
  if (validationErrors.length > 0) {
    throw new Error(validationErrors.join("; "));
  }

  return runtimeDefinitions;
};

export const runtimeQueryKeys = {
  all: ["runtime"] as const,
  definitions: () => [...runtimeQueryKeys.all, "definitions"] as const,
  discovery: () => [...runtimeQueryKeys.all, "executables", "discovery"] as const,
  executableValidations: () => [...runtimeQueryKeys.all, "executables", "validate"] as const,
  executableKind: (kind: RuntimeKind) =>
    [...runtimeQueryKeys.executableValidations(), kind] as const,
  executable: (kind: RuntimeKind, path: string) =>
    [...runtimeQueryKeys.executableKind(kind), path] as const,
};

export const runtimeDefinitionsQueryOptions = () =>
  queryOptions({
    queryKey: runtimeQueryKeys.definitions(),
    queryFn: async ({ client }) =>
      requireCompatibleRuntimeDefinitions(await connectionHost(client).runtimeDefinitionsList()),
    staleTime: RUNTIME_DEFINITIONS_STALE_TIME_MS,
  });

export const runtimeDiscoveryQueryOptions = () =>
  queryOptions({
    queryKey: runtimeQueryKeys.discovery(),
    queryFn: ({ client }): Promise<RuntimeExecutableCheck> =>
      connectionHost(client).runtimeExecutablesCheck({ mode: "discover" }),
    staleTime: 0,
  });

export const runtimeExecutableQueryOptions = (kind: RuntimeKind, path: string) =>
  queryOptions({
    queryKey: runtimeQueryKeys.executable(kind, path),
    queryFn: async ({ client }): Promise<RuntimeExecutableCheck["runtimes"][number]> => {
      const checked = await connectionHost(client).runtimeExecutablesCheck({
        mode: "validate",
        paths: { [kind]: path },
      });
      const result = checked.runtimes.find((row) => row.kind === kind);
      if (!result) throw new Error(`Runtime executable check did not return ${kind}.`);
      return result;
    },
    staleTime: 30_000,
  });

export const writeRuntimeExecutableValidationCache = (
  queryClient: QueryClient,
  check: RuntimeExecutableCheck,
): void => {
  for (const result of check.runtimes) {
    queryClient.setQueryData(
      runtimeExecutableQueryOptions(result.kind, result.path).queryKey,
      result,
    );
  }
};
