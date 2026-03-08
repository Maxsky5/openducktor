import type { AgentDescriptor, AgentModelCatalog } from "@openducktor/core";
import { unwrapData } from "./data-utils";
import { asUnknownRecord, readStringProp } from "./guards";
import { mapProviderListToCatalog, toToolIdList } from "./payload-mappers";
import type { ClientFactory, McpServerStatus } from "./types";

/**
 * Plugins like oh-my-opencode can return both a display-name agent
 * (e.g., "Atlas (Plan Executor)") and a slug alias ("atlas") as separate
 * entries with the same mode and no distinguishing hidden/native flags.
 * The slug is a config-level reference, not a distinct agent — drop it
 * when a matching display-name variant exists with the same mode and no
 * conflicting description.
 */
const deduplicateAgentAliases = (agents: AgentDescriptor[]): AgentDescriptor[] => {
  const displayNameEntries = new Map<string, AgentDescriptor>();
  for (const agent of agents) {
    const agentLabel = agent.label ?? agent.name ?? agent.id;
    if (!agentLabel) {
      continue;
    }
    if (agentLabel.includes(" ")) {
      const baseId = (agentLabel.split(" ")[0] ?? agentLabel).toLowerCase();
      displayNameEntries.set(baseId, agent);
    }
  }
  if (displayNameEntries.size === 0) {
    return agents;
  }
  return agents.filter((agent) => {
    const agentLabel = agent.label ?? agent.name ?? agent.id;
    if (!agentLabel) {
      return false;
    }
    if (agentLabel.includes(" ")) {
      return true;
    }
    const displayVariant = displayNameEntries.get(agentLabel.toLowerCase());
    if (!displayVariant) {
      return true;
    }
    if (agent.mode !== displayVariant.mode) {
      return true;
    }
    if (agent.description && agent.description !== displayVariant.description) {
      return true;
    }
    return false;
  });
};

export const listAvailableModels = async (
  createClient: ClientFactory,
  input: {
    runtimeEndpoint: string;
    workingDirectory: string;
  },
): Promise<AgentModelCatalog> => {
  const client = createClient({
    runtimeEndpoint: input.runtimeEndpoint,
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
  const rawAgents = Array.isArray(agentsData)
    ? agentsData
        .map((entry) => ({
          id: entry.name,
          label: entry.name,
          ...(entry.description ? { description: entry.description } : {}),
          mode: entry.mode,
          ...(entry.hidden !== undefined ? { hidden: entry.hidden } : {}),
          ...(entry.native !== undefined ? { native: entry.native } : {}),
          ...(typeof entry.color === "string" ? { color: entry.color } : {}),
        }))
        .sort((a, b) => a.label.localeCompare(b.label))
    : [];

  const profiles = deduplicateAgentAliases(rawAgents);

  return {
    ...baseCatalog,
    profiles,
  };
};

export const listAvailableToolIds = async (
  createClient: ClientFactory,
  input: {
    runtimeEndpoint: string;
    workingDirectory: string;
  },
): Promise<string[]> => {
  const client = createClient({
    runtimeEndpoint: input.runtimeEndpoint,
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
    runtimeEndpoint: string;
    workingDirectory: string;
  },
): Promise<Record<string, McpServerStatus>> => {
  const client = createClient({
    runtimeEndpoint: input.runtimeEndpoint,
    workingDirectory: input.workingDirectory,
  });
  const response = await client.mcp.status({
    directory: input.workingDirectory,
  });
  const payload = unwrapData(response, "get mcp status");
  const statusPayload = asUnknownRecord(payload);
  if (!statusPayload) {
    return {};
  }

  const statusByServer: Record<string, McpServerStatus> = {};
  for (const [name, rawStatus] of Object.entries(statusPayload)) {
    const status = readStringProp(rawStatus, ["status"]);
    if (!status || status.trim().length === 0) {
      continue;
    }
    const error = readStringProp(rawStatus, ["error"]);
    statusByServer[name] = error && error.trim().length > 0 ? { status, error } : { status };
  }

  return statusByServer;
};

export const connectMcpServer = async (
  createClient: ClientFactory,
  input: {
    runtimeEndpoint: string;
    workingDirectory: string;
    name: string;
  },
): Promise<void> => {
  const client = createClient({
    runtimeEndpoint: input.runtimeEndpoint,
    workingDirectory: input.workingDirectory,
  });
  const response = await client.mcp.connect({
    directory: input.workingDirectory,
    name: input.name,
  });
  unwrapData(response, `connect mcp server ${input.name}`);
};
