import type {
  RunSummary,
  RuntimeDescriptor,
  RuntimeInstanceSummary,
  RuntimeKind,
  RuntimeRoute,
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
import { ensureRuntimeListFromQuery } from "@/state/queries/runtime";
import type { RepoRuntimeFailureKind, RepoRuntimeHealthCheck } from "@/types/diagnostics";
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

export type RuntimeCatalogAdapter = Pick<
  AgentEnginePort,
  "listAvailableModels" | "listAvailableSlashCommands" | "searchFiles"
> & {
  listAvailableToolIds: (input: ListCatalogInput) => Promise<string[]>;
  getMcpStatus: (input: ListCatalogInput) => Promise<Record<string, RuntimeMcpServerStatus>>;
  connectMcpServer: (input: ListCatalogInput & { name: string }) => Promise<void>;
  shouldRestartRuntimeForMcpStatusError: (message: string) => boolean;
};

type RuntimeCatalogDependencies = {
  getRuntimeDefinition: (runtimeKind: RuntimeKind) => RuntimeDescriptor;
  ensureRuntime: (runtimeKind: RuntimeKind, repoPath: string) => Promise<RuntimeInstanceSummary>;
  listRuntimesForRepo: (
    runtimeKind: RuntimeKind,
    repoPath: string,
  ) => Promise<RuntimeInstanceSummary[]>;
  stopRuntime: (runtimeId: string) => Promise<{ ok: boolean }>;
  listRuns: (repoPath: string) => Promise<RunSummary[]>;
  listAvailableModels: (input: ListCatalogInput) => Promise<AgentModelCatalog>;
  listAvailableSlashCommands: (input: ListCatalogInput) => Promise<AgentSlashCommandCatalog>;
  searchFiles: (input: ListCatalogInput & { query: string }) => Promise<AgentFileSearchResult[]>;
  listAvailableToolIds: (input: ListCatalogInput) => Promise<string[]>;
  getMcpStatus: (input: ListCatalogInput) => Promise<Record<string, RuntimeMcpServerStatus>>;
  connectMcpServer: (input: ListCatalogInput & { name: string }) => Promise<void>;
  shouldRestartRuntimeForMcpStatusError: (runtimeKind: RuntimeKind, message: string) => boolean;
};

type RuntimeProbeResult =
  | {
      ok: true;
      runtime: RuntimeInstanceSummary;
      runtimeInput: ListCatalogInput;
    }
  | {
      ok: false;
      result: RepoRuntimeHealthCheck;
    };

type McpProbeResult =
  | {
      ok: true;
      runtime: RuntimeInstanceSummary;
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
  mcpFailureKind: RepoRuntimeFailureKind;
};

type NonNullRepoRuntimeFailureKind = Exclude<RepoRuntimeFailureKind, null>;

const ACTIVE_RUN_STATES = new Set<RunSummary["state"]>([
  "starting",
  "running",
  "blocked",
  "awaiting_done_confirmation",
]);
const toNowIso = (): string => new Date().toISOString();
const toRuntimeInput = (
  runtime: RuntimeInstanceSummary,
  runtimeKind: RuntimeKind,
): ListCatalogInput => ({
  runtimeKind,
  runtimeEndpoint: resolveRuntimeEndpoint(runtime.runtimeRoute),
  workingDirectory: runtime.workingDirectory,
});
const shouldReconnectMcp = (status: string | null): boolean => {
  return status !== null && status !== "connected";
};

const readFailureKind = (error: unknown): NonNullRepoRuntimeFailureKind | null => {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate = (error as { failureKind?: unknown }).failureKind;
  return candidate === "timeout" || candidate === "error" ? candidate : null;
};

const toErrorFailure = (
  error: unknown,
): { message: string; failureKind: NonNullRepoRuntimeFailureKind } => ({
  message: errorMessage(error),
  failureKind: readFailureKind(error) ?? "error",
});

const toRuntimeUnavailableHealthCheck = (
  runtimeError: string,
  runtimeFailureKind: NonNullRepoRuntimeFailureKind,
  checkedAt: string,
): RepoRuntimeHealthCheck => {
  const unavailableMessage = "Runtime is unavailable, so MCP cannot be verified.";
  return {
    runtimeOk: false,
    runtimeError,
    runtimeFailureKind,
    runtime: null,
    mcpOk: false,
    mcpError: unavailableMessage,
    mcpFailureKind: runtimeFailureKind,
    mcpServerName: ODT_MCP_SERVER_NAME,
    mcpServerStatus: null,
    mcpServerError: unavailableMessage,
    availableToolIds: [],
    checkedAt,
    errors: [runtimeError, unavailableMessage],
  };
};

const toMcpStatusFailedHealthCheck = (
  runtime: RuntimeInstanceSummary,
  mcpError: string,
  mcpFailureKind: NonNullRepoRuntimeFailureKind,
  checkedAt: string,
): RepoRuntimeHealthCheck => {
  return {
    runtimeOk: true,
    runtimeError: null,
    runtimeFailureKind: null,
    runtime,
    mcpOk: false,
    mcpError,
    mcpFailureKind,
    mcpServerName: ODT_MCP_SERVER_NAME,
    mcpServerStatus: null,
    mcpServerError: mcpError,
    availableToolIds: [],
    checkedAt,
    errors: [mcpError],
  };
};

const toRepoRuntimeHealthCheckWithoutMcpStatus = (
  runtime: RuntimeInstanceSummary,
  checkedAt: string,
): RepoRuntimeHealthCheck => {
  return {
    runtimeOk: true,
    runtimeError: null,
    runtimeFailureKind: null,
    runtime,
    mcpOk: true,
    mcpError: null,
    mcpFailureKind: null,
    mcpServerName: ODT_MCP_SERVER_NAME,
    mcpServerStatus: null,
    mcpServerError: null,
    availableToolIds: [],
    checkedAt,
    errors: [],
  };
};

const toRepoRuntimeHealthCheck = ({
  runtime,
  availableToolIds,
  mcpServerStatus,
  mcpServerError,
  checkedAt,
}: {
  runtime: RuntimeInstanceSummary;
  availableToolIds: string[];
  checkedAt: string;
} & NormalizedMcpStatus): RepoRuntimeHealthCheck => {
  const mcpOk = mcpServerStatus === "connected";
  const mcpError = mcpOk ? null : (mcpServerError ?? "OpenDucktor MCP is unavailable.");

  return {
    runtimeOk: true,
    runtimeError: null,
    runtimeFailureKind: null,
    runtime,
    mcpOk,
    mcpError,
    mcpFailureKind: mcpOk ? null : "error",
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
): { status: string | null; error: string | null; failureKind: RepoRuntimeFailureKind } => {
  const serverStatus = statusByServer[ODT_MCP_SERVER_NAME];
  if (!serverStatus) {
    return {
      status: null,
      error: `MCP server '${ODT_MCP_SERVER_NAME}' is not configured for this runtime.`,
      failureKind: "error",
    };
  }
  if (serverStatus.status === "connected") {
    return { status: serverStatus.status, error: null, failureKind: null };
  }
  return {
    status: serverStatus.status,
    error: serverStatus.error ?? `MCP server '${ODT_MCP_SERVER_NAME}' is ${serverStatus.status}.`,
    failureKind: "error",
  };
};

const hasActiveRunUsingRuntime = (runs: RunSummary[], runtimeEndpoint: string): boolean => {
  return runs.some(
    (run) =>
      ACTIVE_RUN_STATES.has(run.state) &&
      resolveRuntimeEndpoint(run.runtimeRoute) === runtimeEndpoint,
  );
};

const selectCatalogRuntime = (
  runtimes: RuntimeInstanceSummary[],
  repoPath: string,
): RuntimeInstanceSummary | null =>
  runtimes.find((runtime) => runtime.workingDirectory === repoPath) ?? runtimes[0] ?? null;

export const createRuntimeCatalogOperations = (deps: RuntimeCatalogDependencies) => {
  const probeRuntime = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
    checkedAt: string,
  ): Promise<RuntimeProbeResult> => {
    try {
      const existingRuntime =
        selectCatalogRuntime(await deps.listRuntimesForRepo(runtimeKind, repoPath), repoPath) ??
        null;
      const runtime = existingRuntime ?? (await deps.ensureRuntime(runtimeKind, repoPath));
      return {
        ok: true,
        runtime,
        runtimeInput: toRuntimeInput(runtime, runtimeKind),
      };
    } catch (error) {
      const runtimeError = toErrorFailure(error);
      return {
        ok: false,
        result: toRuntimeUnavailableHealthCheck(
          runtimeError.message,
          runtimeError.failureKind,
          checkedAt,
        ),
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
      const mcpStatusError = toErrorFailure(error);
      const rawMessage = mcpStatusError.message;
      if (!deps.shouldRestartRuntimeForMcpStatusError(runtimeKind, rawMessage)) {
        return {
          ok: false,
          result: toMcpStatusFailedHealthCheck(
            runtimeProbe.runtime,
            `Failed to query runtime MCP status: ${rawMessage}`,
            mcpStatusError.failureKind,
            checkedAt,
          ),
        };
      }

      let restartedRuntime: RuntimeInstanceSummary | null = null;
      try {
        const runs = await deps.listRuns(repoPath);
        if (hasActiveRunUsingRuntime(runs, runtimeProbe.runtimeInput.runtimeEndpoint)) {
          return {
            ok: false,
            result: toMcpStatusFailedHealthCheck(
              runtimeProbe.runtime,
              `Failed to query runtime MCP status: ${rawMessage}. Automatic runtime restart was skipped because an active run is using this runtime.`,
              mcpStatusError.failureKind,
              checkedAt,
            ),
          };
        }
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
        const retriedMcpStatusError = toErrorFailure(retryError);
        return {
          ok: false,
          result: toMcpStatusFailedHealthCheck(
            restartedRuntime ?? runtimeProbe.runtime,
            `Failed to query runtime MCP status: ${retriedMcpStatusError.message}`,
            retriedMcpStatusError.failureKind,
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
    let {
      status: mcpServerStatus,
      error: mcpServerError,
      failureKind: mcpFailureKind,
    } = resolveMcpStatusError(statusByServer);

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
        mcpFailureKind = refreshedStatus.failureKind;
      } catch (error) {
        const reconnectError = errorMessage(error);
        mcpServerError = mcpServerError
          ? `${mcpServerError} (reconnect failed: ${reconnectError})`
          : `Failed to reconnect MCP server '${ODT_MCP_SERVER_NAME}': ${reconnectError}`;
        mcpFailureKind = "error";
      }
    }

    return {
      mcpServerStatus,
      mcpServerError,
      mcpFailureKind,
    };
  };

  const fetchCatalog = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ): Promise<AgentModelCatalog> => {
    const existingRuntime =
      selectCatalogRuntime(await deps.listRuntimesForRepo(runtimeKind, repoPath), repoPath) ?? null;
    const runtime = existingRuntime ?? (await deps.ensureRuntime(runtimeKind, repoPath));
    return deps.listAvailableModels({
      runtimeKind,
      runtimeEndpoint: resolveRuntimeEndpoint(runtime.runtimeRoute),
      workingDirectory: runtime.workingDirectory,
    });
  };

  const resolveCatalogInput = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ): Promise<ListCatalogInput> => {
    const existingRuntime =
      selectCatalogRuntime(await deps.listRuntimesForRepo(runtimeKind, repoPath), repoPath) ?? null;
    const runtime = existingRuntime ?? (await deps.ensureRuntime(runtimeKind, repoPath));
    return toRuntimeInput(runtime, runtimeKind);
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
    const runtimeDefinition = deps.getRuntimeDefinition(runtimeKind);
    const runtimeProbe = await probeRuntime(repoPath, runtimeKind, checkedAt);
    if (!runtimeProbe.ok) {
      return runtimeProbe.result;
    }

    if (!runtimeDefinition.capabilities.supportsMcpStatus) {
      return toRepoRuntimeHealthCheckWithoutMcpStatus(runtimeProbe.runtime, checkedAt);
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
    getRuntimeDefinition,
    ensureRuntime: (runtimeKind, repoPath) => host.runtimeEnsure(repoPath, runtimeKind),
    listRuntimesForRepo: (runtimeKind, repoPath) =>
      ensureRuntimeListFromQuery(appQueryClient, runtimeKind, repoPath),
    stopRuntime: (runtimeId) => host.runtimeStop(runtimeId),
    listRuns: (repoPath) => host.runsList(repoPath),
    listAvailableModels: (input) =>
      getAdapter(input.runtimeKind).listAvailableModels({
        runtimeKind: input.runtimeKind,
        runtimeConnection: {
          endpoint: input.runtimeEndpoint,
          workingDirectory: input.workingDirectory,
        },
      }),
    listAvailableSlashCommands: (input) =>
      getAdapter(input.runtimeKind).listAvailableSlashCommands({
        runtimeKind: input.runtimeKind,
        runtimeConnection: {
          endpoint: input.runtimeEndpoint,
          workingDirectory: input.workingDirectory,
        },
      }),
    searchFiles: (input) =>
      getAdapter(input.runtimeKind).searchFiles({
        runtimeKind: input.runtimeKind,
        runtimeConnection: {
          endpoint: input.runtimeEndpoint,
          workingDirectory: input.workingDirectory,
        },
        query: input.query,
      }),
    listAvailableToolIds: (input) => getAdapter(input.runtimeKind).listAvailableToolIds(input),
    getMcpStatus: (input) => getAdapter(input.runtimeKind).getMcpStatus(input),
    connectMcpServer: (input) => getAdapter(input.runtimeKind).connectMcpServer(input),
    shouldRestartRuntimeForMcpStatusError: (runtimeKind, message) =>
      getAdapter(runtimeKind).shouldRestartRuntimeForMcpStatusError(message),
  });

const resolveRuntimeEndpoint = (runtimeRoute: RuntimeRoute): string => {
  switch (runtimeRoute.type) {
    case "local_http":
      return runtimeRoute.endpoint;
  }
};
