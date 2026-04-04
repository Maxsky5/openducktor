import type {
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
  RepoRuntimeHealthFailureOrigin,
  RepoRuntimeHealthObservation,
  RepoRuntimeHealthProgress,
  RepoRuntimeHealthStage,
} from "@/types/diagnostics";
import { host } from "./host";

type ListCatalogInput = {
  runtimeKind: RuntimeKind;
  runtimeEndpoint: string;
  workingDirectory: string;
};

export type RuntimeCatalogAdapter = Pick<
  AgentEnginePort,
  "listAvailableModels" | "listAvailableSlashCommands" | "searchFiles"
>;

type RuntimeCatalogDependencies = {
  runtimeHealthTimeoutMs?: number;
  repoRuntimeHealth: (
    runtimeKind: RuntimeKind,
    repoPath: string,
  ) => Promise<RepoRuntimeHealthCheck>;
  repoRuntimeHealthStatus: (
    runtimeKind: RuntimeKind,
    repoPath: string,
  ) => Promise<RepoRuntimeHealthCheck>;
  ensureRuntime: (runtimeKind: RuntimeKind, repoPath: string) => Promise<RuntimeInstanceSummary>;
  listRuntimesForRepo: (
    runtimeKind: RuntimeKind,
    repoPath: string,
  ) => Promise<RuntimeInstanceSummary[]>;
  listAvailableModels: (input: ListCatalogInput) => Promise<AgentModelCatalog>;
  listAvailableSlashCommands: (input: ListCatalogInput) => Promise<AgentSlashCommandCatalog>;
  searchFiles: (input: ListCatalogInput & { query: string }) => Promise<AgentFileSearchResult[]>;
};

type NonNullRepoRuntimeFailureKind = Exclude<RepoRuntimeFailureKind, null>;

const RUNTIME_HEALTH_TIMEOUT_MS = 15_000;

const toNowIso = (): string => new Date().toISOString();

const readFailureKind = (error: unknown): NonNullRepoRuntimeFailureKind | null => {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate = (error as { failureKind?: unknown }).failureKind;
  return candidate === "timeout" || candidate === "error" ? candidate : null;
};

const toRuntimeInput = (
  runtime: RuntimeInstanceSummary,
  runtimeKind: RuntimeKind,
): ListCatalogInput => ({
  runtimeKind,
  runtimeEndpoint: resolveRuntimeEndpoint(runtime.runtimeRoute),
  workingDirectory: runtime.workingDirectory,
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

const toProgress = ({
  stage,
  observation,
  host,
  checkedAt,
  detail,
  failureKind,
  failureReason,
  failureOrigin,
  startedAt,
  updatedAt,
  elapsedMs,
  attempts,
}: {
  stage: RepoRuntimeHealthStage;
  observation: RepoRuntimeHealthObservation | null;
  host: RepoRuntimeHealthProgress["host"];
  checkedAt: string;
  detail?: string | null;
  failureKind?: RepoRuntimeFailureKind;
  failureReason?: string | null;
  failureOrigin?: RepoRuntimeHealthFailureOrigin | null;
  startedAt?: string | null;
  updatedAt?: string | null;
  elapsedMs?: number | null;
  attempts?: number | null;
}): RepoRuntimeHealthProgress => ({
  stage,
  observation,
  startedAt: startedAt ?? host?.startedAt ?? null,
  updatedAt: updatedAt ?? host?.updatedAt ?? checkedAt,
  elapsedMs: elapsedMs ?? host?.elapsedMs ?? null,
  attempts: attempts ?? host?.attempts ?? null,
  detail: detail ?? host?.detail ?? null,
  failureKind: failureKind ?? host?.failureKind ?? null,
  failureReason: failureReason ?? host?.failureReason ?? null,
  failureOrigin: failureOrigin ?? null,
  host,
});

const buildFrontendObservationTimeoutHealthCheck = async (
  deps: RuntimeCatalogDependencies,
  repoPath: string,
  runtimeKind: RuntimeKind,
  checkedAt: string,
  timeoutError: DiagnosticsQueryTimeoutError,
): Promise<RepoRuntimeHealthCheck> => {
  try {
    const hostHealth = await deps.repoRuntimeHealthStatus(runtimeKind, repoPath);
    const hostProgress = hostHealth.progress ?? null;
    if (!hostProgress) {
      throw new Error("host repo runtime health snapshot is unavailable");
    }
    const progress = toProgress({
      stage: hostProgress.stage,
      observation: hostProgress.observation,
      host: hostProgress.host,
      checkedAt,
      detail: timeoutError.message,
      failureKind: timeoutError.failureKind,
      failureOrigin: "frontend_observation",
      startedAt: hostProgress.startedAt,
      updatedAt: hostProgress.updatedAt,
      elapsedMs: hostProgress.elapsedMs,
      attempts: hostProgress.attempts,
    });

    if (hostHealth.runtimeOk) {
      return {
        ...hostHealth,
        mcpOk: false,
        mcpError: hostHealth.mcpError ?? timeoutError.message,
        mcpFailureKind: hostHealth.mcpFailureKind ?? timeoutError.failureKind,
        mcpServerStatus: hostHealth.mcpServerStatus ?? null,
        mcpServerError: hostHealth.mcpServerError ?? timeoutError.message,
        checkedAt,
        errors: hostHealth.errors.length > 0 ? hostHealth.errors : [timeoutError.message],
        progress,
      };
    }

    const runtimeError = hostHealth.runtimeError ?? progress.detail ?? timeoutError.message;
    const unavailableMessage =
      hostHealth.mcpError ?? "Runtime is unavailable, so MCP cannot be verified.";
    return {
      ...hostHealth,
      runtimeOk: false,
      runtimeError,
      runtimeFailureKind: timeoutError.failureKind,
      mcpOk: false,
      mcpError: unavailableMessage,
      mcpFailureKind: timeoutError.failureKind,
      mcpServerError: unavailableMessage,
      checkedAt,
      errors: [runtimeError, unavailableMessage],
      progress,
    };
  } catch (statusError) {
    const detail = `${timeoutError.message}. Failed to load latest host runtime health status: ${errorMessage(statusError)}`;
    return {
      runtimeOk: false,
      runtimeError: detail,
      runtimeFailureKind: timeoutError.failureKind,
      runtime: null,
      mcpOk: false,
      mcpError: detail,
      mcpFailureKind: timeoutError.failureKind,
      mcpServerName: ODT_MCP_SERVER_NAME,
      mcpServerStatus: null,
      mcpServerError: detail,
      availableToolIds: [],
      checkedAt,
      errors: [detail],
      progress: toProgress({
        stage: "frontend_observation_timeout",
        observation: null,
        host: null,
        checkedAt,
        detail,
        failureKind: timeoutError.failureKind,
        failureOrigin: "health_status",
      }),
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
    const runtime = existingRuntime ?? (await deps.ensureRuntime(runtimeKind, repoPath));
    return deps.listAvailableModels(toRuntimeInput(runtime, runtimeKind));
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
    try {
      const health = await withRuntimeHealthTimeout(
        deps.repoRuntimeHealth(runtimeKind, repoPath),
        runtimeHealthTimeoutMs,
      );
      const normalizedHealth: RepoRuntimeHealthCheck = {
        ...health,
        progress: health.progress ?? null,
      };
      return normalizedHealth;
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
  _getRuntimeDefinition: (runtimeKind: RuntimeKind) => RuntimeDescriptor,
): RuntimeCatalogOperations =>
  createRuntimeCatalogOperations({
    repoRuntimeHealth: (runtimeKind, repoPath) => host.repoRuntimeHealth(repoPath, runtimeKind),
    repoRuntimeHealthStatus: (runtimeKind, repoPath) =>
      host.repoRuntimeHealthStatus(repoPath, runtimeKind),
    ensureRuntime: (runtimeKind, repoPath) => host.runtimeEnsure(repoPath, runtimeKind),
    listRuntimesForRepo: (runtimeKind, repoPath) =>
      ensureRuntimeListFromQuery(appQueryClient, runtimeKind, repoPath),
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
  });

const resolveRuntimeEndpoint = (runtimeRoute: RuntimeRoute): string => {
  switch (runtimeRoute.type) {
    case "local_http":
      return runtimeRoute.endpoint;
  }
};
