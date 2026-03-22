import type {
  RuntimeDescriptor,
  RuntimeInstanceSummary,
  RuntimeKind,
} from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { validateRuntimeDefinitionsForOpenDucktor } from "@/lib/agent-runtime";
import { host } from "../operations/host";

const RUNTIME_DEFINITIONS_STALE_TIME_MS = 30 * 60_000;
const RUNTIME_LIST_STALE_TIME_MS = 10_000;

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
  list: (runtimeKind: RuntimeKind, repoPath: string) =>
    [...runtimeQueryKeys.all, "list", runtimeKind, repoPath] as const,
};

export const runtimeDefinitionsQueryOptions = () =>
  queryOptions({
    queryKey: runtimeQueryKeys.definitions(),
    queryFn: async () => requireCompatibleRuntimeDefinitions(await host.runtimeDefinitionsList()),
    staleTime: RUNTIME_DEFINITIONS_STALE_TIME_MS,
  });

const runtimeListQueryOptions = (runtimeKind: RuntimeKind, repoPath: string) =>
  queryOptions({
    queryKey: runtimeQueryKeys.list(runtimeKind, repoPath),
    queryFn: (): Promise<RuntimeInstanceSummary[]> => host.runtimeList(repoPath, runtimeKind),
    staleTime: RUNTIME_LIST_STALE_TIME_MS,
  });

export const loadRuntimeListFromQuery = (
  queryClient: QueryClient,
  runtimeKind: RuntimeKind,
  repoPath: string,
): Promise<RuntimeInstanceSummary[]> =>
  queryClient.fetchQuery(runtimeListQueryOptions(runtimeKind, repoPath));

export const ensureRuntimeListFromQuery = (
  queryClient: QueryClient,
  runtimeKind: RuntimeKind,
  repoPath: string,
): Promise<RuntimeInstanceSummary[]> =>
  queryClient.ensureQueryData(runtimeListQueryOptions(runtimeKind, repoPath));
