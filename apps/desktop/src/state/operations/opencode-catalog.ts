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

const ODT_MCP_SERVER_NAME = "openducktor";
const toBaseUrl = (port: number): string => `http://127.0.0.1:${port}`;
const toNowIso = (): string => new Date().toISOString();
const isOpencodeConfigInvalidError = (message: string): boolean =>
  /configinvaliderror|opencode_config_content|loglevel|invalid option/i.test(message);

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
  const loadRepoOpencodeCatalog = async (repoPath: string): Promise<AgentModelCatalog> => {
    const runtime = await deps.ensureRuntime(repoPath);
    return deps.listAvailableModels({
      baseUrl: toBaseUrl(runtime.port),
      workingDirectory: runtime.workingDirectory,
    });
  };

  const checkRepoOpencodeHealth = async (repoPath: string): Promise<RepoOpencodeHealthCheck> => {
    const checkedAt = toNowIso();
    let runtime: AgentRuntimeSummary | null = null;

    try {
      runtime = await deps.ensureRuntime(repoPath);
    } catch (error) {
      const runtimeError = errorMessage(error);
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
    }

    let runtimeInput = {
      baseUrl: toBaseUrl(runtime.port),
      workingDirectory: runtime.workingDirectory,
    };

    let statusByServer: Record<string, McpServerStatus>;
    try {
      statusByServer = await deps.getMcpStatus(runtimeInput);
    } catch (error) {
      const rawMessage = errorMessage(error);
      if (runtime && isOpencodeConfigInvalidError(rawMessage)) {
        try {
          await deps.stopRuntime(runtime.runtimeId);
          runtime = await deps.ensureRuntime(repoPath);
          runtimeInput = {
            baseUrl: toBaseUrl(runtime.port),
            workingDirectory: runtime.workingDirectory,
          };
          statusByServer = await deps.getMcpStatus(runtimeInput);
        } catch (retryError) {
          const mcpError = `Failed to query OpenCode MCP status: ${errorMessage(retryError)}`;
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
        }
      } else {
        const mcpError = `Failed to query OpenCode MCP status: ${rawMessage}`;
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
      }
    }

    const availableToolIdsPromise = deps
      .listAvailableToolIds(runtimeInput)
      .catch(() => [] as string[]);

    let { status: mcpServerStatus, error: mcpServerError } = resolveMcpStatusError(statusByServer);

    if (mcpServerStatus !== null && mcpServerStatus !== "connected") {
      try {
        await deps.connectMcpServer({
          ...runtimeInput,
          name: ODT_MCP_SERVER_NAME,
        });
        statusByServer = await deps.getMcpStatus(runtimeInput);
        const resolved = resolveMcpStatusError(statusByServer);
        mcpServerStatus = resolved.status;
        mcpServerError = resolved.error;
      } catch (error) {
        const reconnectError = errorMessage(error);
        mcpServerError = mcpServerError
          ? `${mcpServerError} (reconnect failed: ${reconnectError})`
          : `Failed to reconnect MCP server '${ODT_MCP_SERVER_NAME}': ${reconnectError}`;
      }
    }

    const availableToolIds = await availableToolIdsPromise;

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
