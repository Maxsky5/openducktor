import type {
  BeadsCheck,
  RuntimeCheck,
  RuntimeDescriptor,
  RuntimeKind,
} from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { errorMessage } from "@/lib/errors";
import { ODT_MCP_SERVER_NAME } from "@/lib/openducktor-mcp";
import type { RepoRuntimeHealthCheck, RepoRuntimeHealthMap } from "@/types/diagnostics";
import { host } from "../operations/host";

const RUNTIME_CHECK_STALE_TIME_MS = 5 * 60_000;
const BEADS_CHECK_STALE_TIME_MS = 60_000;
const RUNTIME_HEALTH_STALE_TIME_MS = 60_000;
const DIAGNOSTICS_QUERY_TIMEOUT_MS = 5_000;

const buildRuntimeHealthErrorCheck = (
  runtimeHealthError: string,
  checkedAt: string,
): RepoRuntimeHealthCheck => ({
  runtimeOk: false,
  runtimeError: runtimeHealthError,
  runtime: null,
  mcpOk: false,
  mcpError: runtimeHealthError,
  mcpServerName: ODT_MCP_SERVER_NAME,
  mcpServerStatus: null,
  mcpServerError: runtimeHealthError,
  availableToolIds: [],
  checkedAt,
  errors: [runtimeHealthError],
});

const normalizeRuntimeKinds = (runtimeKinds: RuntimeKind[]): RuntimeKind[] =>
  [...runtimeKinds].sort();

const withDiagnosticsQueryTimeout = async <T>(promise: Promise<T>): Promise<T> => {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(new Error(`Timed out after ${DIAGNOSTICS_QUERY_TIMEOUT_MS}ms`));
    }, DIAGNOSTICS_QUERY_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
};

export const checksQueryKeys = {
  all: ["checks"] as const,
  runtime: () => [...checksQueryKeys.all, "runtime"] as const,
  beads: (repoPath: string) => [...checksQueryKeys.all, "beads", repoPath] as const,
  runtimeHealth: (repoPath: string, runtimeKinds: RuntimeKind[]) =>
    [
      ...checksQueryKeys.all,
      "runtime-health",
      repoPath,
      ...normalizeRuntimeKinds(runtimeKinds),
    ] as const,
};

export const runtimeCheckQueryOptions = (force = false) =>
  queryOptions({
    queryKey: checksQueryKeys.runtime(),
    queryFn: (): Promise<RuntimeCheck> => withDiagnosticsQueryTimeout(host.runtimeCheck(force)),
    staleTime: RUNTIME_CHECK_STALE_TIME_MS,
  });

export const beadsCheckQueryOptions = (repoPath: string) =>
  queryOptions({
    queryKey: checksQueryKeys.beads(repoPath),
    queryFn: (): Promise<BeadsCheck> => withDiagnosticsQueryTimeout(host.beadsCheck(repoPath)),
    staleTime: BEADS_CHECK_STALE_TIME_MS,
  });

export const repoRuntimeHealthQueryOptions = (
  repoPath: string,
  runtimeDefinitions: RuntimeDescriptor[],
  checkRepoRuntimeHealth: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<RepoRuntimeHealthCheck>,
) =>
  queryOptions({
    queryKey: checksQueryKeys.runtimeHealth(
      repoPath,
      runtimeDefinitions.map((definition) => definition.kind),
    ),
    queryFn: async (): Promise<RepoRuntimeHealthMap> => {
      const checks = await Promise.all(
        runtimeDefinitions.map(async (definition) => {
          const check = await withDiagnosticsQueryTimeout(
            checkRepoRuntimeHealth(repoPath, definition.kind),
          ).catch((error) =>
            buildRuntimeHealthErrorCheck(errorMessage(error), new Date().toISOString()),
          );
          return [definition.kind, check] as const;
        }),
      );

      return Object.fromEntries(checks) as RepoRuntimeHealthMap;
    },
    staleTime: RUNTIME_HEALTH_STALE_TIME_MS,
  });

export const loadRuntimeCheckFromQuery = (queryClient: QueryClient): Promise<RuntimeCheck> =>
  queryClient.fetchQuery(runtimeCheckQueryOptions());

export const loadBeadsCheckFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
): Promise<BeadsCheck> => queryClient.fetchQuery(beadsCheckQueryOptions(repoPath));

export const loadRepoRuntimeHealthFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  runtimeDefinitions: RuntimeDescriptor[],
  checkRepoRuntimeHealth: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<RepoRuntimeHealthCheck>,
): Promise<RepoRuntimeHealthMap> =>
  queryClient.fetchQuery(
    repoRuntimeHealthQueryOptions(repoPath, runtimeDefinitions, checkRepoRuntimeHealth),
  );
