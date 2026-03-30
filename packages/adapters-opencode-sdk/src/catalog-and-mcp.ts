import { slashCommandCatalogSchema } from "@openducktor/contracts";
import type {
  AgentDescriptor,
  AgentModelCatalog,
  AgentSlashCommandCatalog,
} from "@openducktor/core";
import { unwrapData } from "./data-utils";
import { asUnknownRecord, readStringArrayProp, readStringProp } from "./guards";
import { mapProviderListToCatalog, toToolIdList } from "./payload-mappers";
import { toOpenCodeRequestError } from "./request-errors";
import type { ClientFactory, McpServerStatus } from "./types";

const OPENCODE_DEFAULT_AGENT_COLORS: Record<string, string> = {
  build: "var(--icon-agent-build-base)",
  plan: "var(--icon-agent-plan-base)",
};

const isAgentMode = (value: string | undefined): value is AgentDescriptor["mode"] =>
  value === "subagent" || value === "primary" || value === "all";

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
        .map((rawEntry) => {
          const entry = asUnknownRecord(rawEntry);
          const name = entry ? readStringProp(entry, ["name"]) : undefined;
          if (!entry || !name || name.trim().length === 0) {
            return undefined;
          }

          const mode = readStringProp(entry, ["mode"]);
          if (!isAgentMode(mode)) {
            return undefined;
          }

          const description = readStringProp(entry, ["description"]);
          const hidden = typeof entry.hidden === "boolean" ? entry.hidden : undefined;
          const native = typeof entry.native === "boolean" ? entry.native : undefined;

          const resolvedColor = resolveAgentColor(name, entry.color, native);
          return {
            id: name,
            label: name,
            ...(description ? { description } : {}),
            mode,
            ...(hidden !== undefined ? { hidden } : {}),
            ...(native !== undefined ? { native } : {}),
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

export const listAvailableSlashCommands = async (
  createClient: ClientFactory,
  input: {
    runtimeEndpoint: string;
    workingDirectory: string;
  },
): Promise<AgentSlashCommandCatalog> => {
  try {
    const client = createClient({
      runtimeEndpoint: input.runtimeEndpoint,
      workingDirectory: input.workingDirectory,
    });
    const commandClient = (
      client as {
        command?: {
          list?: (input: { directory: string }) => Promise<{
            data?: unknown;
            error?: { message?: string } | unknown;
          }>;
        };
      }
    ).command;
    if (!commandClient || typeof commandClient.list !== "function") {
      throw new Error("OpenCode runtime does not expose the command listing API.");
    }

    const payload = unwrapData(
      await commandClient.list({ directory: input.workingDirectory }),
      "list slash commands",
    );
    if (!Array.isArray(payload)) {
      throw new Error("Invalid slash command payload: expected an array.");
    }

    const commands = payload
      .flatMap((rawEntry) => {
        const entry = asUnknownRecord(rawEntry);
        const name = entry ? readStringProp(entry, ["name"]) : undefined;
        if (!entry || !name || name.trim().length === 0) {
          return [];
        }

        const description = readStringProp(entry, ["description"]);
        const source = readStringProp(entry, ["source"]);
        const normalizedSource: AgentSlashCommandCatalog["commands"][number]["source"] =
          source === "command" || source === "mcp" || source === "skill" ? source : undefined;
        const hints = readStringArrayProp(entry, "hints") ?? [];

        return [
          {
            id: name,
            trigger: name,
            title: name,
            ...(description ? { description } : {}),
            ...(normalizedSource ? { source: normalizedSource } : {}),
            hints,
          },
        ];
      })
      .sort((left, right) => left.trigger.localeCompare(right.trigger));

    return slashCommandCatalogSchema.parse({ commands });
  } catch (error) {
    throw toOpenCodeRequestError("list slash commands", error);
  }
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
