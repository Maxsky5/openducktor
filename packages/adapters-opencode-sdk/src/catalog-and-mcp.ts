import type { AgentModelCatalog } from "@openducktor/core";
import { unwrapData } from "./data-utils";
import { asUnknownRecord, readStringProp } from "./guards";
import { mapProviderListToCatalog, toToolIdList } from "./payload-mappers";
import type { ClientFactory, McpServerStatus } from "./types";

const OPENCODE_DEFAULT_AGENT_COLORS: Record<string, string> = {
  ask: "var(--icon-agent-ask-base)",
  build: "var(--icon-agent-build-base)",
  docs: "var(--icon-agent-docs-base)",
  plan: "var(--icon-agent-plan-base)",
};

const resolveAgentColor = (
  agentName: unknown,
  explicitColor: unknown,
  isNative: unknown,
): string | undefined => {
  if (typeof explicitColor === "string" && explicitColor.trim().length > 0) {
    return explicitColor;
  }

  if (isNative !== true || typeof agentName !== "string") {
    return undefined;
  }

  const normalizedName = agentName.trim().toLowerCase();
  return OPENCODE_DEFAULT_AGENT_COLORS[normalizedName];
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

    const payload = await app.agents({
      directory: input.workingDirectory,
    } as {
      directory: string;
    });
    return unwrapData(
      payload as { data?: unknown; error?: { message?: string } | unknown },
      "list agents",
    );
  })();
  const baseCatalog = mapProviderListToCatalog(providerData);
  const rawAgents = Array.isArray(agentsData)
    ? agentsData
        .map((entry) => {
          if (typeof entry.name !== "string") {
            return undefined;
          }

          const resolvedColor = resolveAgentColor(entry.name, entry.color, entry.native);
          return {
            id: entry.name,
            label: entry.name,
            ...(entry.description ? { description: entry.description } : {}),
            mode: entry.mode,
            ...(entry.hidden !== undefined ? { hidden: entry.hidden } : {}),
            ...(entry.native !== undefined ? { native: entry.native } : {}),
            ...(resolvedColor !== undefined ? { color: resolvedColor } : {}),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
        .sort((a, b) => a.label.localeCompare(b.label))
    : [];

  return {
    ...baseCatalog,
    profiles: rawAgents,
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
    throw new Error("Invalid MCP status payload: expected an object keyed by server name.");
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
