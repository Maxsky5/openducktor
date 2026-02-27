import type { AgentModelCatalog } from "@openducktor/core";
import { unwrapData } from "./data-utils";
import { mapProviderListToCatalog, toToolIdList } from "./payload-mappers";
import type { ClientFactory, McpServerStatus } from "./types";

export const listAvailableModels = async (
  createClient: ClientFactory,
  input: {
    baseUrl: string;
    workingDirectory: string;
  },
): Promise<AgentModelCatalog> => {
  const client = createClient({
    baseUrl: input.baseUrl,
    workingDirectory: input.workingDirectory,
  });
  const response = await client.config.providers({
    directory: input.workingDirectory,
  });
  const providerData = unwrapData(response, "list configured providers");
  const agentsData = await (async () => {
    const app = (client as { app?: { agents?: unknown } }).app;
    if (!app || typeof app.agents !== "function") {
      return [];
    }
    try {
      const payload = await app.agents({
        directory: input.workingDirectory,
      } as {
        directory: string;
      });
      return unwrapData(
        payload as { data?: unknown; error?: { message?: string } | unknown },
        "list agents",
      );
    } catch {
      return [];
    }
  })();
  const baseCatalog = mapProviderListToCatalog(providerData);
  const agents = Array.isArray(agentsData)
    ? agentsData
        .map((entry) => ({
          name: entry.name,
          ...(entry.description ? { description: entry.description } : {}),
          mode: entry.mode,
          ...(entry.hidden !== undefined ? { hidden: entry.hidden } : {}),
          ...(entry.native !== undefined ? { native: entry.native } : {}),
          ...(typeof entry.color === "string" ? { color: entry.color } : {}),
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  return {
    ...baseCatalog,
    agents,
  };
};

export const listAvailableToolIds = async (
  createClient: ClientFactory,
  input: {
    baseUrl: string;
    workingDirectory: string;
  },
): Promise<string[]> => {
  const client = createClient({
    baseUrl: input.baseUrl,
    workingDirectory: input.workingDirectory,
  });
  const response = await client.tool.ids({
    directory: input.workingDirectory,
  });
  const payload = unwrapData(response, "list tool ids");
  return toToolIdList(payload);
};

export const getMcpStatus = async (
  createClient: ClientFactory,
  input: {
    baseUrl: string;
    workingDirectory: string;
  },
): Promise<Record<string, McpServerStatus>> => {
  const client = createClient({
    baseUrl: input.baseUrl,
    workingDirectory: input.workingDirectory,
  });
  const response = await client.mcp.status({
    directory: input.workingDirectory,
  });
  const payload = unwrapData(response, "get mcp status");
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const statusByServer: Record<string, McpServerStatus> = {};
  for (const [name, rawStatus] of Object.entries(payload as Record<string, unknown>)) {
    if (!rawStatus || typeof rawStatus !== "object") {
      continue;
    }
    const status = (rawStatus as { status?: unknown }).status;
    if (typeof status !== "string" || status.trim().length === 0) {
      continue;
    }
    const error = (rawStatus as { error?: unknown }).error;
    statusByServer[name] =
      typeof error === "string" && error.trim().length > 0 ? { status, error } : { status };
  }

  return statusByServer;
};

export const connectMcpServer = async (
  createClient: ClientFactory,
  input: {
    baseUrl: string;
    workingDirectory: string;
    name: string;
  },
): Promise<void> => {
  const client = createClient({
    baseUrl: input.baseUrl,
    workingDirectory: input.workingDirectory,
  });
  const response = await client.mcp.connect({
    directory: input.workingDirectory,
    name: input.name,
  });
  unwrapData(response, `connect mcp server ${input.name}`);
};
