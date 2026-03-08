import type { AgentRuntimeSummary, RuntimeKind } from "@openducktor/contracts";
import type { AgentEnginePort, AgentModelCatalog } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";
import { host } from "./host";

type RuntimeMcpServerStatus = {
  status: string;
  error?: string | null;
};

type ListCatalogInput = {
  runtimeKind: RuntimeKind;
  runtimeEndpoint: string;
  workingDirectory: string;
};

export type RuntimeCatalogAdapter = Pick<AgentEnginePort, "listAvailableModels"> & {
  listAvailableToolIds: (input: ListCatalogInput) => Promise<string[]>;
  getMcpStatus: (input: ListCatalogInput) => Promise<Record<string, RuntimeMcpServerStatus>>;
  connectMcpServer: (input: ListCatalogInput & { name: string }) => Promise<void>;
  shouldRestartRuntimeForMcpStatusError: (message: string) => boolean;
};

type RuntimeCatalogDependencies = {
  ensureRuntime: (runtimeKind: RuntimeKind, repoPath: string) => Promise<AgentRuntimeSummary>;
  stopRuntime: (runtimeId: string) => Promise<{ ok: boolean }>;
  listAvailableModels: (input: ListCatalogInput) => Promise<AgentModelCatalog>;
  listAvailableToolIds: (input: ListCatalogInput) => Promise<string[]>;
  getMcpStatus: (input: ListCatalogInput) => Promise<Record<string, RuntimeMcpServerStatus>>;
  connectMcpServer: (input: ListCatalogInput & { name: string }) => Promise<void>;
  shouldRestartRuntimeForMcpStatusError: (runtimeKind: RuntimeKind, message: string) => boolean;
};

type RuntimeProbeResult =
  | {
      ok: true;
      runtime: AgentRuntimeSummary;
      runtimeInput: ListCatalogInput;
    }
  | {
      ok: false;
      result: RepoRuntimeHealthCheck;
    };

type McpProbeResult =
  | {
      ok: true;
      runtime: AgentRuntimeSummary;
      runtimeInput: ListCatalogInput;
      statusByServer: Record<string, RuntimeMcpServerStatus>;
    }
  | {
      ok: false;
      result: RepoRuntimeHealthCheck;
    };

type NormalizedMcpStatus = {
  mcpServerStatus: string | null;
  mcpServerError: string | null;
};

const ODT_MCP_SERVER_NAME = "openducktor";
const toNowIso = (): string => new Date().toISOString();
const toRuntimeInput = (
  runtime: AgentRuntimeSummary,
  runtimeKind: RuntimeKind,
): ListCatalogInput => ({
  runtimeKind,
  runtimeEndpoint: resolveRuntimeEndpoint(runtime),
  workingDirectory: runtime.workingDirectory,
});
const shouldReconnectMcp = (status: string | null): boolean => {
  return status !== null && status !== "connected";
};

const toRuntimeUnavailableHealthCheck = (
  runtimeError: string,
  checkedAt: string,
): RepoRuntimeHealthCheck => {
  const unavailableMessage = "Runtime is unavailable, so MCP cannot be verified.";
  return {
    runtimeOk: false,
    runtimeError,
    runtime: null,
    mcpOk: false,
    mcpError: unavailableMessage,
    mcpServerName: ODT_MCP_SERVER_NAME,
    mcpServerStatus: null,
    mcpServerError: unavailableMessage,
    availableToolIds: [],
    checkedAt,
    errors: [runtimeError, unavailableMessage],
  };
};

const toMcpStatusFailedHealthCheck = (
  runtime: AgentRuntimeSummary,
  mcpError: string,
  checkedAt: string,
): RepoRuntimeHealthCheck => {
  return {
    runtimeOk: true,
    runtimeError: null,
    runtime,
    mcpOk: false,
    mcpError,
    mcpServerName: ODT_MCP_SERVER_NAME,
    mcpServerStatus: null,
    mcpServerError: mcpError,
    availableToolIds: [],
    checkedAt,
    errors: [mcpError],
  };
};

const toRepoRuntimeHealthCheck = ({
  runtime,
  availableToolIds,
  mcpServerStatus,
  mcpServerError,
  checkedAt,
}: {
  runtime: AgentRuntimeSummary;
  availableToolIds: string[];
  checkedAt: string;
} & NormalizedMcpStatus): RepoRuntimeHealthCheck => {
  const mcpOk = mcpServerStatus === "connected";
  const mcpError = mcpOk ? null : (mcpServerError ?? "OpenDucktor MCP is unavailable.");

  return {
    runtimeOk: true,
    runtimeError: null,
    runtime,
    mcpOk,
    mcpError,
    mcpServerName: ODT_MCP_SERVER_NAME,
    mcpServerStatus,
    mcpServerError: mcpServerError ?? null,
    availableToolIds,
    checkedAt,
    errors: mcpError ? [mcpError] : [],
  };
};

const resolveMcpStatusError = (
  statusByServer: Record<string, RuntimeMcpServerStatus>,
): { status: string | null; error: string | null } => {
  const serverStatus = statusByServer[ODT_MCP_SERVER_NAME];
  if (!serverStatus) {
    return {
      status: null,
      error: `MCP server '${ODT_MCP_SERVER_NAME}' is not configured for this runtime.`,
    };
  }
  if (serverStatus.status === "connected") {
    return { status: serverStatus.status, error: null };
  }
  return {
    status: serverStatus.status,
    error: serverStatus.error ?? `MCP server '${ODT_MCP_SERVER_NAME}' is ${serverStatus.status}.`,
  };
};

export const createRuntimeCatalogOperations = (deps: RuntimeCatalogDependencies) => {
  const probeRuntime = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
    checkedAt: string,
  ): Promise<RuntimeProbeResult> => {
    try {
      const runtime = await deps.ensureRuntime(runtimeKind, repoPath);
      return {
        ok: true,
        runtime,
        runtimeInput: toRuntimeInput(runtime, runtimeKind),
      };
    } catch (error) {
      const runtimeError = errorMessage(error);
      return {
        ok: false,
        result: toRuntimeUnavailableHealthCheck(runtimeError, checkedAt),
      };
    }
  };

  const probeMcpStatusWithRetryStrategy = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
    runtimeProbe: Extract<RuntimeProbeResult, { ok: true }>,
    checkedAt: string,
  ): Promise<McpProbeResult> => {
    try {
      const statusByServer = await deps.getMcpStatus(runtimeProbe.runtimeInput);
      return {
        ok: true,
        runtime: runtimeProbe.runtime,
        runtimeInput: runtimeProbe.runtimeInput,
        statusByServer,
      };
    } catch (error) {
      const rawMessage = errorMessage(error);
      if (!deps.shouldRestartRuntimeForMcpStatusError(runtimeKind, rawMessage)) {
        return {
          ok: false,
          result: toMcpStatusFailedHealthCheck(
            runtimeProbe.runtime,
            `Failed to query runtime MCP status: ${rawMessage}`,
            checkedAt,
          ),
        };
      }

      let restartedRuntime: AgentRuntimeSummary | null = null;
      try {
        await deps.stopRuntime(runtimeProbe.runtime.runtimeId);
        restartedRuntime = await deps.ensureRuntime(runtimeKind, repoPath);
        const restartedRuntimeInput = toRuntimeInput(restartedRuntime, runtimeKind);
        const statusByServer = await deps.getMcpStatus(restartedRuntimeInput);
        return {
          ok: true,
          runtime: restartedRuntime,
          runtimeInput: restartedRuntimeInput,
          statusByServer,
        };
      } catch (retryError) {
        return {
          ok: false,
          result: toMcpStatusFailedHealthCheck(
            restartedRuntime ?? runtimeProbe.runtime,
            `Failed to query runtime MCP status: ${errorMessage(retryError)}`,
            checkedAt,
          ),
        };
      }
    }
  };

  const normalizeMcpStatus = async (
    runtimeInput: ListCatalogInput,
    statusByServer: Record<string, RuntimeMcpServerStatus>,
  ): Promise<NormalizedMcpStatus> => {
    let { status: mcpServerStatus, error: mcpServerError } = resolveMcpStatusError(statusByServer);

    if (shouldReconnectMcp(mcpServerStatus)) {
      try {
        await deps.connectMcpServer({
          ...runtimeInput,
          name: ODT_MCP_SERVER_NAME,
        });
        const refreshedStatusByServer = await deps.getMcpStatus(runtimeInput);
        const refreshedStatus = resolveMcpStatusError(refreshedStatusByServer);
        mcpServerStatus = refreshedStatus.status;
        mcpServerError = refreshedStatus.error;
      } catch (error) {
        const reconnectError = errorMessage(error);
        mcpServerError = mcpServerError
          ? `${mcpServerError} (reconnect failed: ${reconnectError})`
          : `Failed to reconnect MCP server '${ODT_MCP_SERVER_NAME}': ${reconnectError}`;
      }
    }

    return {
      mcpServerStatus,
      mcpServerError,
    };
  };

  const catalogCache = new Map<string, AgentModelCatalog>();

  const toCatalogCacheKey = (repoPath: string, runtimeKind: RuntimeKind): string =>
    `${runtimeKind}::${repoPath}`;

  const fetchCatalog = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ): Promise<AgentModelCatalog> => {
    const runtime = await deps.ensureRuntime(runtimeKind, repoPath);
    return deps.listAvailableModels({
      runtimeKind,
      runtimeEndpoint: resolveRuntimeEndpoint(runtime),
      workingDirectory: runtime.workingDirectory,
    });
  };

  const loadRepoRuntimeCatalog = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ): Promise<AgentModelCatalog> => {
    const cacheKey = toCatalogCacheKey(repoPath, runtimeKind);
    const cached = catalogCache.get(cacheKey);
    if (cached) {
      void fetchCatalog(repoPath, runtimeKind)
        .then((fresh) => catalogCache.set(cacheKey, fresh))
        .catch(() => {});
      return cached;
    }

    const catalog = await fetchCatalog(repoPath, runtimeKind);
    catalogCache.set(cacheKey, catalog);
    return catalog;
  };

  const checkRepoRuntimeHealth = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ): Promise<RepoRuntimeHealthCheck> => {
    const checkedAt = toNowIso();
    const runtimeProbe = await probeRuntime(repoPath, runtimeKind, checkedAt);
    if (!runtimeProbe.ok) {
      return runtimeProbe.result;
    }

    const mcpProbe = await probeMcpStatusWithRetryStrategy(
      repoPath,
      runtimeKind,
      runtimeProbe,
      checkedAt,
    );
    if (!mcpProbe.ok) {
      return mcpProbe.result;
    }

    const availableToolIdsPromise = deps
      .listAvailableToolIds(mcpProbe.runtimeInput)
      .catch(() => [] as string[]);

    const normalizedMcpStatus = await normalizeMcpStatus(
      mcpProbe.runtimeInput,
      mcpProbe.statusByServer,
    );
    const availableToolIds = await availableToolIdsPromise;

    return toRepoRuntimeHealthCheck({
      runtime: mcpProbe.runtime,
      availableToolIds,
      checkedAt,
      ...normalizedMcpStatus,
    });
  };

  return {
    loadRepoRuntimeCatalog,
    checkRepoRuntimeHealth,
  };
};

export type RuntimeCatalogOperations = ReturnType<typeof createRuntimeCatalogOperations>;

export const createHostRuntimeCatalogOperations = (
  getAdapter: (runtimeKind: RuntimeKind) => RuntimeCatalogAdapter,
): RuntimeCatalogOperations =>
  createRuntimeCatalogOperations({
    ensureRuntime: (runtimeKind, repoPath) => host.runtimeEnsure(runtimeKind, repoPath),
    stopRuntime: (runtimeId) => host.runtimeStop(runtimeId),
    listAvailableModels: (input) => getAdapter(input.runtimeKind).listAvailableModels(input),
    listAvailableToolIds: (input) => getAdapter(input.runtimeKind).listAvailableToolIds(input),
    getMcpStatus: (input) => getAdapter(input.runtimeKind).getMcpStatus(input),
    connectMcpServer: (input) => getAdapter(input.runtimeKind).connectMcpServer(input),
    shouldRestartRuntimeForMcpStatusError: (runtimeKind, message) =>
      getAdapter(runtimeKind).shouldRestartRuntimeForMcpStatusError(message),
  });

let configuredRuntimeCatalogOperations: RuntimeCatalogOperations | null = null;

export const configureRuntimeCatalogOperations = (operations: RuntimeCatalogOperations): void => {
  configuredRuntimeCatalogOperations = operations;
};

const getConfiguredRuntimeCatalogOperations = (): RuntimeCatalogOperations => {
  if (!configuredRuntimeCatalogOperations) {
    throw new Error(
      "Runtime catalog operations are not configured. Initialize them from AppStateProvider before use.",
    );
  }
  return configuredRuntimeCatalogOperations;
};

export const loadRepoRuntimeCatalog = (
  repoPath: string,
  runtimeKind: RuntimeKind,
): Promise<AgentModelCatalog> => {
  return getConfiguredRuntimeCatalogOperations().loadRepoRuntimeCatalog(repoPath, runtimeKind);
};

export const checkRepoRuntimeHealth = (
  repoPath: string,
  runtimeKind: RuntimeKind,
): Promise<RepoRuntimeHealthCheck> => {
  return getConfiguredRuntimeCatalogOperations().checkRepoRuntimeHealth(repoPath, runtimeKind);
};

const resolveRuntimeEndpoint = (runtime: AgentRuntimeSummary): string => {
  if (runtime.endpoint?.trim()) {
    return runtime.endpoint;
  }
  if (typeof runtime.port === "number") {
    return `http://127.0.0.1:${runtime.port}`;
  }
  throw new Error("Runtime endpoint is missing from runtime summary.");
};
