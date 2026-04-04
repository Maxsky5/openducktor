import type {
  RepoRuntimeStartupStatus,
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
import { DiagnosticsQueryTimeoutError } from "@/state/queries/checks";
import { ensureRuntimeListFromQuery } from "@/state/queries/runtime";
import type {
  RepoRuntimeFailureKind,
  RepoRuntimeHealthCheck,
  RepoRuntimeHealthObservation,
  RepoRuntimeHealthProgress,
  RepoRuntimeHealthStage,
} from "@/types/diagnostics";
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
  runtimeHealthTimeoutMs?: number;
  ensureRuntime: (runtimeKind: RuntimeKind, repoPath: string) => Promise<RuntimeInstanceSummary>;
  runtimeStartupStatus: (
    runtimeKind: RuntimeKind,
    repoPath: string,
  ) => Promise<RepoRuntimeStartupStatus>;
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
const RUNTIME_HEALTH_TIMEOUT_MS = 15_000;
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

const tryReadRuntimeStartupStatus = async (
  deps: RuntimeCatalogDependencies,
  repoPath: string,
  runtimeKind: RuntimeKind,
): Promise<RepoRuntimeStartupStatus | null> => {
  try {
    return await deps.runtimeStartupStatus(runtimeKind, repoPath);
  } catch {
    return null;
  }
};

const mapHostStage = (stage: RepoRuntimeStartupStatus["stage"]): RepoRuntimeHealthStage => {
  switch (stage) {
    case "idle":
      return "idle";
    case "startup_requested":
      return "startup_requested";
    case "waiting_for_runtime":
      return "waiting_for_runtime";
    case "runtime_ready":
      return "runtime_ready";
    case "startup_failed":
      return "startup_failed";
  }
};

const toProgress = ({
  stage,
  observation,
  host,
  checkedAt,
  detail,
  failureKind,
  failureReason,
  startedAt,
  updatedAt,
  elapsedMs,
  attempts,
}: {
  stage: RepoRuntimeHealthStage;
  observation: RepoRuntimeHealthObservation;
  host: RepoRuntimeStartupStatus | null;
  checkedAt: string;
  detail?: string | null;
  failureKind?: RepoRuntimeFailureKind;
  failureReason?: string | null;
  startedAt?: string | null;
  updatedAt?: string | null;
  elapsedMs?: number | null;
  attempts?: number | null;
}): RepoRuntimeHealthProgress => ({
  stage,
  observation,
  host,
  startedAt: startedAt ?? host?.startedAt ?? null,
  updatedAt: updatedAt ?? host?.updatedAt ?? checkedAt,
  elapsedMs: elapsedMs ?? host?.elapsedMs ?? null,
  attempts: attempts ?? host?.attempts ?? null,
  detail: detail ?? host?.detail ?? null,
  failureKind: failureKind ?? host?.failureKind ?? null,
  failureReason: failureReason ?? host?.failureReason ?? null,
});

const toHostProgress = (
  host: RepoRuntimeStartupStatus | null,
  observation: RepoRuntimeHealthObservation,
  checkedAt: string,
): RepoRuntimeHealthProgress | null => {
  if (!host) {
    return null;
  }

  return toProgress({
    stage: mapHostStage(host.stage),
    observation,
    host,
    checkedAt,
  });
};

const toRuntimeUnavailableHealthCheck = (
  runtimeError: string,
  runtimeFailureKind: NonNullRepoRuntimeFailureKind,
  checkedAt: string,
  progress: RepoRuntimeHealthProgress | null,
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
    progress,
  };
};

const toMcpStatusFailedHealthCheck = (
  runtime: RuntimeInstanceSummary,
  mcpError: string,
  mcpFailureKind: NonNullRepoRuntimeFailureKind,
  checkedAt: string,
  progress: RepoRuntimeHealthProgress | null,
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
    progress,
  };
};

const toRepoRuntimeHealthCheckWithoutMcpStatus = (
  runtime: RuntimeInstanceSummary,
  checkedAt: string,
  progress: RepoRuntimeHealthProgress | null,
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
    progress,
  };
};

const toRepoRuntimeHealthCheck = ({
  runtime,
  availableToolIds,
  mcpServerStatus,
  mcpServerError,
  mcpFailureKind,
  checkedAt,
  progress,
}: {
  runtime: RuntimeInstanceSummary;
  availableToolIds: string[];
  checkedAt: string;
  progress: RepoRuntimeHealthProgress | null;
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
    mcpFailureKind: mcpOk ? null : mcpFailureKind,
    mcpServerName: ODT_MCP_SERVER_NAME,
    mcpServerStatus,
    mcpServerError: mcpServerError ?? null,
    availableToolIds,
    checkedAt,
    errors: mcpError ? [mcpError] : [],
    progress,
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
  const runtimeHealthTimeoutMs = deps.runtimeHealthTimeoutMs ?? RUNTIME_HEALTH_TIMEOUT_MS;

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

  const finalizeMcpStatus = async ({
    runtime,
    runtimeInput,
    statusByServer,
    checkedAt,
    observation,
    hostStatus,
    progress,
  }: {
    runtime: RuntimeInstanceSummary;
    runtimeInput: ListCatalogInput;
    statusByServer: Record<string, RuntimeMcpServerStatus>;
    checkedAt: string;
    observation: RepoRuntimeHealthObservation;
    hostStatus: RepoRuntimeStartupStatus | null;
    progress: RepoRuntimeHealthProgress | null;
  }): Promise<RepoRuntimeHealthCheck> => {
    let {
      status: mcpServerStatus,
      error: mcpServerError,
      failureKind: mcpFailureKind,
    } = resolveMcpStatusError(statusByServer);

    if (shouldReconnectMcp(mcpServerStatus)) {
      const reconnectProgress = toProgress({
        stage: "reconnecting_mcp",
        observation,
        host: hostStatus,
        checkedAt,
        startedAt: progress?.startedAt ?? runtime.startedAt,
        updatedAt: checkedAt,
        elapsedMs: progress?.elapsedMs ?? null,
        attempts: progress?.attempts ?? null,
        detail: mcpServerError,
        failureKind: mcpFailureKind,
      });
      try {
        await withRuntimeHealthTimeout(
          deps.connectMcpServer({
            ...runtimeInput,
            name: ODT_MCP_SERVER_NAME,
          }),
          runtimeHealthTimeoutMs,
        );
        const refreshedStatusByServer = await withRuntimeHealthTimeout(
          deps.getMcpStatus(runtimeInput),
          runtimeHealthTimeoutMs,
        );
        const refreshedStatus = resolveMcpStatusError(refreshedStatusByServer);
        mcpServerStatus = refreshedStatus.status;
        mcpServerError = refreshedStatus.error;
        mcpFailureKind = refreshedStatus.failureKind;
      } catch (error) {
        if (error instanceof DiagnosticsQueryTimeoutError) {
          return toMcpStatusFailedHealthCheck(
            runtime,
            error.message,
            error.failureKind,
            checkedAt,
            reconnectProgress,
          );
        }
        const reconnectError = errorMessage(error);
        mcpServerError = mcpServerError
          ? `${mcpServerError} (reconnect failed: ${reconnectError})`
          : `Failed to reconnect MCP server '${ODT_MCP_SERVER_NAME}': ${reconnectError}`;
        mcpFailureKind = "error";
      }
    }

    const availableToolIds = await deps
      .listAvailableToolIds(runtimeInput)
      .catch(() => [] as string[]);
    const finalProgress = toProgress({
      stage: mcpServerStatus === "connected" ? "ready" : "checking_mcp_status",
      observation,
      host: hostStatus,
      checkedAt,
      startedAt: progress?.startedAt ?? runtime.startedAt,
      updatedAt: checkedAt,
      elapsedMs: progress?.elapsedMs ?? null,
      attempts: progress?.attempts ?? null,
      detail: mcpServerError,
      failureKind: mcpFailureKind,
    });

    return toRepoRuntimeHealthCheck({
      runtime,
      availableToolIds,
      checkedAt,
      progress: finalProgress,
      mcpServerStatus,
      mcpServerError,
      mcpFailureKind,
    });
  };

  const checkRepoRuntimeHealth = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ): Promise<RepoRuntimeHealthCheck> => {
    const checkedAt = toNowIso();
    const runtimeDefinition = deps.getRuntimeDefinition(runtimeKind);
    let hostStatus = await tryReadRuntimeStartupStatus(deps, repoPath, runtimeKind);
    const existingRuntime =
      selectCatalogRuntime(await deps.listRuntimesForRepo(runtimeKind, repoPath), repoPath) ?? null;
    const observation: RepoRuntimeHealthObservation = existingRuntime
      ? "observed_existing_runtime"
      : hostStatus && hostStatus.stage !== "idle"
        ? "observing_existing_startup"
        : "started_by_diagnostics";
    let runtime = existingRuntime;
    let progress = existingRuntime
      ? toProgress({
          stage: "runtime_ready",
          observation,
          host: hostStatus,
          checkedAt,
          startedAt: existingRuntime.startedAt,
          updatedAt: existingRuntime.startedAt,
        })
      : toHostProgress(hostStatus, observation, checkedAt);

    if (!runtime) {
      try {
        runtime = await withRuntimeHealthTimeout(
          deps.ensureRuntime(runtimeKind, repoPath),
          runtimeHealthTimeoutMs,
        );
        const latestHostStatus = await tryReadRuntimeStartupStatus(deps, repoPath, runtimeKind);
        hostStatus = latestHostStatus;
        progress = toProgress({
          stage: "runtime_ready",
          observation,
          host: latestHostStatus,
          checkedAt,
          startedAt: latestHostStatus?.startedAt ?? runtime.startedAt,
          updatedAt: latestHostStatus?.updatedAt ?? runtime.startedAt,
          elapsedMs: latestHostStatus?.elapsedMs ?? null,
          attempts: latestHostStatus?.attempts ?? null,
        });
      } catch (error) {
        if (error instanceof DiagnosticsQueryTimeoutError) {
          const latestHostStatus = await tryReadRuntimeStartupStatus(deps, repoPath, runtimeKind);
          return toRuntimeUnavailableHealthCheck(
            error.message,
            error.failureKind,
            checkedAt,
            toHostProgress(latestHostStatus, observation, checkedAt) ??
              toProgress({
                stage: "startup_requested",
                observation,
                host: latestHostStatus,
                checkedAt,
                detail: error.message,
                failureKind: error.failureKind,
              }),
          );
        }
        const runtimeError = toErrorFailure(error);
        const latestHostStatus = await tryReadRuntimeStartupStatus(deps, repoPath, runtimeKind);
        return toRuntimeUnavailableHealthCheck(
          runtimeError.message,
          runtimeError.failureKind,
          checkedAt,
          toHostProgress(latestHostStatus, observation, checkedAt),
        );
      }
    }

    const runtimeInput = toRuntimeInput(runtime, runtimeKind);

    if (!runtimeDefinition.capabilities.supportsMcpStatus) {
      return toRepoRuntimeHealthCheckWithoutMcpStatus(runtime, checkedAt, progress);
    }

    const checkingProgress = toProgress({
      stage: "checking_mcp_status",
      observation,
      host: hostStatus,
      checkedAt,
      startedAt: progress?.startedAt ?? runtime.startedAt,
      updatedAt: checkedAt,
      elapsedMs: progress?.elapsedMs ?? null,
      attempts: progress?.attempts ?? null,
    });

    try {
      const statusByServer = await withRuntimeHealthTimeout(
        deps.getMcpStatus(runtimeInput),
        runtimeHealthTimeoutMs,
      );
      return finalizeMcpStatus({
        runtime,
        runtimeInput,
        statusByServer,
        checkedAt,
        observation,
        hostStatus,
        progress: checkingProgress,
      });
    } catch (error) {
      if (error instanceof DiagnosticsQueryTimeoutError) {
        return toMcpStatusFailedHealthCheck(
          runtime,
          error.message,
          error.failureKind,
          checkedAt,
          checkingProgress,
        );
      }

      const mcpStatusError = toErrorFailure(error);
      const rawMessage = mcpStatusError.message;
      if (!deps.shouldRestartRuntimeForMcpStatusError(runtimeKind, rawMessage)) {
        return toMcpStatusFailedHealthCheck(
          runtime,
          `Failed to query runtime MCP status: ${rawMessage}`,
          mcpStatusError.failureKind,
          checkedAt,
          checkingProgress,
        );
      }

      const restartingProgress = toProgress({
        stage: "restarting_runtime",
        observation: "restarted_for_mcp",
        host: hostStatus,
        checkedAt,
        startedAt: progress?.startedAt ?? runtime.startedAt,
        updatedAt: checkedAt,
        elapsedMs: progress?.elapsedMs ?? null,
        attempts: progress?.attempts ?? null,
        detail: rawMessage,
        failureKind: mcpStatusError.failureKind,
      });

      let restartedRuntime: RuntimeInstanceSummary | null = null;
      try {
        const runs = await deps.listRuns(repoPath);
        if (hasActiveRunUsingRuntime(runs, runtimeInput.runtimeEndpoint)) {
          const skippedMessage = `Failed to query runtime MCP status: ${rawMessage}. Automatic runtime restart was skipped because an active run is using this runtime.`;
          return toMcpStatusFailedHealthCheck(
            runtime,
            skippedMessage,
            mcpStatusError.failureKind,
            checkedAt,
            toProgress({
              stage: "restart_skipped_active_run",
              observation: "restart_skipped_active_run",
              host: hostStatus,
              checkedAt,
              startedAt: restartingProgress.startedAt,
              updatedAt: checkedAt,
              elapsedMs: restartingProgress.elapsedMs,
              attempts: restartingProgress.attempts,
              detail: skippedMessage,
              failureKind: mcpStatusError.failureKind,
            }),
          );
        }
        await withRuntimeHealthTimeout(deps.stopRuntime(runtime.runtimeId), runtimeHealthTimeoutMs);
        restartedRuntime = await withRuntimeHealthTimeout(
          deps.ensureRuntime(runtimeKind, repoPath),
          runtimeHealthTimeoutMs,
        );
        const restartedRuntimeInput = toRuntimeInput(restartedRuntime, runtimeKind);
        const restartedStatusByServer = await withRuntimeHealthTimeout(
          deps.getMcpStatus(restartedRuntimeInput),
          runtimeHealthTimeoutMs,
        );
        return finalizeMcpStatus({
          runtime: restartedRuntime,
          runtimeInput: restartedRuntimeInput,
          statusByServer: restartedStatusByServer,
          checkedAt,
          observation: "restarted_for_mcp",
          hostStatus: await tryReadRuntimeStartupStatus(deps, repoPath, runtimeKind),
          progress: restartingProgress,
        });
      } catch (retryError) {
        if (retryError instanceof DiagnosticsQueryTimeoutError) {
          return toMcpStatusFailedHealthCheck(
            restartedRuntime ?? runtime,
            retryError.message,
            retryError.failureKind,
            checkedAt,
            restartingProgress,
          );
        }
        const retriedMcpStatusError = toErrorFailure(retryError);
        return toMcpStatusFailedHealthCheck(
          restartedRuntime ?? runtime,
          `Failed to query runtime MCP status: ${retriedMcpStatusError.message}`,
          retriedMcpStatusError.failureKind,
          checkedAt,
          restartingProgress,
        );
      }
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
    getRuntimeDefinition,
    ensureRuntime: (runtimeKind, repoPath) => host.runtimeEnsure(repoPath, runtimeKind),
    runtimeStartupStatus: (runtimeKind, repoPath) =>
      host.runtimeStartupStatus(repoPath, runtimeKind),
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
