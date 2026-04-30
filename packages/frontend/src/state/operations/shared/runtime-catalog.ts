import type {
  RuntimeDescriptor,
  RuntimeInstanceSummary,
  RuntimeKind,
} from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentSlashCommandCatalog,
} from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import { ODT_MCP_SERVER_NAME } from "@/lib/openducktor-mcp";
import { appQueryClient } from "@/lib/query-client";
import { DiagnosticsQueryTimeoutError } from "@/state/queries/checks";
import { ensureRuntimeListFromQuery } from "@/state/queries/runtime";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";
import { host } from "./host";

type ListCatalogInput = {
  repoPath: string;
  runtimeKind: RuntimeKind;
};

export type RuntimeCatalogAdapter = Pick<
  AgentEnginePort,
  "listAvailableModels" | "listAvailableSlashCommands" | "searchFiles"
>;

type RuntimeCatalogDependencies = {
  runtimeHealthTimeoutMs?: number;
  runtimeHealthStatusTimeoutMs?: number;
  supportsMcpStatus: (runtimeKind: RuntimeKind) => boolean;
  repoRuntimeHealth: (
    runtimeKind: RuntimeKind,
    repoPath: string,
  ) => Promise<RepoRuntimeHealthCheck>;
  repoRuntimeHealthStatus: (
    runtimeKind: RuntimeKind,
    repoPath: string,
  ) => Promise<RepoRuntimeHealthCheck>;
  listRuntimesForRepo: (
    runtimeKind: RuntimeKind,
    repoPath: string,
  ) => Promise<RuntimeInstanceSummary[]>;
  listAvailableModels: (input: ListCatalogInput) => Promise<AgentModelCatalog>;
  listAvailableSlashCommands: (input: ListCatalogInput) => Promise<AgentSlashCommandCatalog>;
  searchFiles: (input: ListCatalogInput & { query: string }) => Promise<AgentFileSearchResult[]>;
};

const RUNTIME_HEALTH_TIMEOUT_MS = 15_000;
const RUNTIME_HEALTH_STATUS_TIMEOUT_MS = 3_000;

const toNowIso = (): string => new Date().toISOString();

const toRuntimeInput = (repoPath: string, runtimeKind: RuntimeKind): ListCatalogInput => ({
  repoPath,
  runtimeKind,
});

const selectCatalogRuntime = (
  runtimes: RuntimeInstanceSummary[],
  repoPath: string,
): RuntimeInstanceSummary | null =>
  runtimes.find((runtime) => runtime.workingDirectory === repoPath) ?? runtimes[0] ?? null;

const withRuntimeHealthTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(new DiagnosticsQueryTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
};

const buildFrontendObservationTimeoutHealthCheck = async (
  deps: RuntimeCatalogDependencies,
  repoPath: string,
  runtimeKind: RuntimeKind,
  checkedAt: string,
  timeoutError: DiagnosticsQueryTimeoutError,
): Promise<RepoRuntimeHealthCheck> => {
  const supportsMcpStatus = deps.supportsMcpStatus(runtimeKind);
  try {
    const hostHealth = await withRuntimeHealthTimeout(
      deps.repoRuntimeHealthStatus(runtimeKind, repoPath),
      deps.runtimeHealthStatusTimeoutMs ?? RUNTIME_HEALTH_STATUS_TIMEOUT_MS,
    );

    if (hostHealth.status !== "ready" || !supportsMcpStatus) {
      return hostHealth;
    }

    return {
      ...hostHealth,
      status: "checking",
      checkedAt,
      runtime: hostHealth.runtime,
      mcp:
        hostHealth.mcp === null
          ? null
          : {
              ...hostHealth.mcp,
              status: "checking",
              detail: timeoutError.message,
              failureKind: timeoutError.failureKind,
            },
    };
  } catch (statusError) {
    const detail = `${timeoutError.message}. Failed to load latest host runtime health status: ${errorMessage(statusError)}`;
    return {
      status: "error",
      checkedAt,
      runtime: {
        status: "error",
        stage: "startup_failed",
        observation: null,
        instance: null,
        startedAt: null,
        updatedAt: checkedAt,
        elapsedMs: null,
        attempts: null,
        detail,
        failureKind: timeoutError.failureKind,
        failureReason: null,
      },
      mcp: supportsMcpStatus
        ? {
            supported: true,
            status: "error",
            serverName: ODT_MCP_SERVER_NAME,
            serverStatus: null,
            toolIds: [],
            detail,
            failureKind: timeoutError.failureKind,
          }
        : null,
    };
  }
};

export const createRuntimeCatalogOperations = (deps: RuntimeCatalogDependencies) => {
  const runtimeHealthTimeoutMs = deps.runtimeHealthTimeoutMs ?? RUNTIME_HEALTH_TIMEOUT_MS;

  const fetchCatalog = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ): Promise<AgentModelCatalog> => {
    const existingRuntime =
      selectCatalogRuntime(await deps.listRuntimesForRepo(runtimeKind, repoPath), repoPath) ?? null;
    if (!existingRuntime) {
      throw new Error(
        `No live repo runtime found for repo '${repoPath}' and runtime '${runtimeKind}'.`,
      );
    }
    return deps.listAvailableModels(toRuntimeInput(repoPath, runtimeKind));
  };

  const resolveCatalogInput = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ): Promise<ListCatalogInput> => {
    const existingRuntime =
      selectCatalogRuntime(await deps.listRuntimesForRepo(runtimeKind, repoPath), repoPath) ?? null;
    if (!existingRuntime) {
      throw new Error(
        `No live repo runtime found for repo '${repoPath}' and runtime '${runtimeKind}'.`,
      );
    }
    return toRuntimeInput(repoPath, runtimeKind);
  };

  const loadRepoRuntimeCatalog = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ): Promise<AgentModelCatalog> => fetchCatalog(repoPath, runtimeKind);

  const loadRepoRuntimeSlashCommands = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ): Promise<AgentSlashCommandCatalog> => {
    return deps.listAvailableSlashCommands(await resolveCatalogInput(repoPath, runtimeKind));
  };

  const loadRepoRuntimeFileSearch = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
    query: string,
  ): Promise<AgentFileSearchResult[]> => {
    return deps.searchFiles({
      ...(await resolveCatalogInput(repoPath, runtimeKind)),
      query,
    });
  };

  const checkRepoRuntimeHealth = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ): Promise<RepoRuntimeHealthCheck> => {
    const checkedAt = toNowIso();
    try {
      const health = await withRuntimeHealthTimeout(
        deps.repoRuntimeHealth(runtimeKind, repoPath),
        runtimeHealthTimeoutMs,
      );
      return health;
    } catch (error) {
      if (error instanceof DiagnosticsQueryTimeoutError) {
        return buildFrontendObservationTimeoutHealthCheck(
          deps,
          repoPath,
          runtimeKind,
          checkedAt,
          error,
        );
      }

      throw error;
    }
  };

  return {
    loadRepoRuntimeCatalog,
    loadRepoRuntimeSlashCommands,
    loadRepoRuntimeFileSearch,
    checkRepoRuntimeHealth,
  };
};

type RuntimeCatalogOperations = ReturnType<typeof createRuntimeCatalogOperations>;

export const createHostRuntimeCatalogOperations = (
  getAdapter: (runtimeKind: RuntimeKind) => RuntimeCatalogAdapter,
  getRuntimeDefinition: (runtimeKind: RuntimeKind) => RuntimeDescriptor,
): RuntimeCatalogOperations =>
  createRuntimeCatalogOperations({
    supportsMcpStatus: (runtimeKind) =>
      getRuntimeDefinition(runtimeKind).capabilities.optionalSurfaces.supportsMcpStatus,
    repoRuntimeHealth: (runtimeKind, repoPath) => host.repoRuntimeHealth(repoPath, runtimeKind),
    repoRuntimeHealthStatus: (runtimeKind, repoPath) =>
      host.repoRuntimeHealthStatus(repoPath, runtimeKind),
    listRuntimesForRepo: (runtimeKind, repoPath) =>
      ensureRuntimeListFromQuery(appQueryClient, runtimeKind, repoPath),
    listAvailableModels: (input) =>
      getAdapter(input.runtimeKind).listAvailableModels({
        repoPath: input.repoPath,
        runtimeKind: input.runtimeKind,
      }),
    listAvailableSlashCommands: (input) =>
      getAdapter(input.runtimeKind).listAvailableSlashCommands({
        repoPath: input.repoPath,
        runtimeKind: input.runtimeKind,
      }),
    searchFiles: (input) =>
      getAdapter(input.runtimeKind).searchFiles({
        repoPath: input.repoPath,
        runtimeKind: input.runtimeKind,
        workingDirectory: input.repoPath,
        query: input.query,
      }),
  });
