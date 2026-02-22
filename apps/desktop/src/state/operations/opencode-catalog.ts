import { type McpServerStatus, OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { AgentRuntimeSummary } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import type { RepoOpencodeHealthCheck } from "@/types/diagnostics";
import { host } from "./host";

type ListCatalogInput = {
  baseUrl: string;
  workingDirectory: string;
};

type OpencodeCatalogDependencies = {
  ensureRuntime: (repoPath: string) => Promise<AgentRuntimeSummary>;
  stopRuntime: (runtimeId: string) => Promise<{ ok: boolean }>;
  listAvailableModels: (input: ListCatalogInput) => Promise<AgentModelCatalog>;
  listAvailableToolIds: (input: ListCatalogInput) => Promise<string[]>;
  getMcpStatus: (input: ListCatalogInput) => Promise<Record<string, McpServerStatus>>;
  connectMcpServer: (input: ListCatalogInput & { name: string }) => Promise<void>;
};

type RuntimeProbeResult =
  | {
      ok: true;
      runtime: AgentRuntimeSummary;
      runtimeInput: ListCatalogInput;
    }
  | {
      ok: false;
      result: RepoOpencodeHealthCheck;
    };

type McpProbeResult =
  | {
      ok: true;
      runtime: AgentRuntimeSummary;
      runtimeInput: ListCatalogInput;
      statusByServer: Record<string, McpServerStatus>;
    }
  | {
      ok: false;
      result: RepoOpencodeHealthCheck;
    };

type NormalizedMcpStatus = {
  mcpServerStatus: string | null;
  mcpServerError: string | null;
};

const ODT_MCP_SERVER_NAME = "openducktor";
const toBaseUrl = (port: number): string => `http://127.0.0.1:${port}`;
const toNowIso = (): string => new Date().toISOString();
const toRuntimeInput = (runtime: AgentRuntimeSummary): ListCatalogInput => ({
  baseUrl: toBaseUrl(runtime.port),
  workingDirectory: runtime.workingDirectory,
});
const isOpencodeConfigInvalidError = (message: string): boolean =>
  /configinvaliderror|opencode_config_content|loglevel|invalid option/i.test(message);
const shouldReconnectMcp = (status: string | null): boolean => {
  return status !== null && status !== "connected";
};

const toRuntimeUnavailableHealthCheck = (
  runtimeError: string,
  checkedAt: string,
): RepoOpencodeHealthCheck => {
  const unavailableMessage = "OpenCode runtime is unavailable, so MCP cannot be verified.";
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
): RepoOpencodeHealthCheck => {
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

const toRepoOpencodeHealthCheck = ({
  runtime,
  availableToolIds,
  mcpServerStatus,
  mcpServerError,
  checkedAt,
}: {
  runtime: AgentRuntimeSummary;
  availableToolIds: string[];
  checkedAt: string;
} & NormalizedMcpStatus): RepoOpencodeHealthCheck => {
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
  statusByServer: Record<string, McpServerStatus>,
): { status: string | null; error: string | null } => {
  const serverStatus = statusByServer[ODT_MCP_SERVER_NAME];
  if (!serverStatus) {
    return {
      status: null,
      error: `MCP server '${ODT_MCP_SERVER_NAME}' is not configured for this OpenCode runtime.`,
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

export const createOpencodeCatalogOperations = (deps: OpencodeCatalogDependencies) => {
  const probeRuntime = async (repoPath: string, checkedAt: string): Promise<RuntimeProbeResult> => {
    try {
      const runtime = await deps.ensureRuntime(repoPath);
      return {
        ok: true,
        runtime,
        runtimeInput: toRuntimeInput(runtime),
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
      if (!isOpencodeConfigInvalidError(rawMessage)) {
        return {
          ok: false,
          result: toMcpStatusFailedHealthCheck(
            runtimeProbe.runtime,
            `Failed to query OpenCode MCP status: ${rawMessage}`,
            checkedAt,
          ),
        };
      }

      let restartedRuntime: AgentRuntimeSummary | null = null;
      try {
        await deps.stopRuntime(runtimeProbe.runtime.runtimeId);
        restartedRuntime = await deps.ensureRuntime(repoPath);
        const restartedRuntimeInput = toRuntimeInput(restartedRuntime);
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
            `Failed to query OpenCode MCP status: ${errorMessage(retryError)}`,
            checkedAt,
          ),
        };
      }
    }
  };

  const normalizeMcpStatus = async (
    runtimeInput: ListCatalogInput,
    statusByServer: Record<string, McpServerStatus>,
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

  const loadRepoOpencodeCatalog = async (repoPath: string): Promise<AgentModelCatalog> => {
    const runtime = await deps.ensureRuntime(repoPath);
    return deps.listAvailableModels({
      baseUrl: toBaseUrl(runtime.port),
      workingDirectory: runtime.workingDirectory,
    });
  };

  const checkRepoOpencodeHealth = async (repoPath: string): Promise<RepoOpencodeHealthCheck> => {
    const checkedAt = toNowIso();
    const runtimeProbe = await probeRuntime(repoPath, checkedAt);
    if (!runtimeProbe.ok) {
      return runtimeProbe.result;
    }

    const mcpProbe = await probeMcpStatusWithRetryStrategy(repoPath, runtimeProbe, checkedAt);
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

    return toRepoOpencodeHealthCheck({
      runtime: mcpProbe.runtime,
      availableToolIds,
      checkedAt,
      ...normalizedMcpStatus,
    });
  };

  return {
    loadRepoOpencodeCatalog,
    checkRepoOpencodeHealth,
  };
};

const adapter = new OpencodeSdkAdapter();

const opencodeCatalogOperations = createOpencodeCatalogOperations({
  ensureRuntime: (repoPath) => host.opencodeRepoRuntimeEnsure(repoPath),
  stopRuntime: (runtimeId) => host.opencodeRuntimeStop(runtimeId),
  listAvailableModels: (input) => adapter.listAvailableModels(input),
  listAvailableToolIds: (input) => adapter.listAvailableToolIds(input),
  getMcpStatus: (input) => adapter.getMcpStatus(input),
  connectMcpServer: (input) => adapter.connectMcpServer(input),
});

export const loadRepoOpencodeCatalog = opencodeCatalogOperations.loadRepoOpencodeCatalog;
export const checkRepoOpencodeHealth = opencodeCatalogOperations.checkRepoOpencodeHealth;
