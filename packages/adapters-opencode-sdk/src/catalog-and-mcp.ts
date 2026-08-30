import {
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
  slashCommandCatalogSchema,
  subagentCatalogSchema,
} from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentSlashCommandCatalog,
  AgentSubagentCatalog,
} from "@openducktor/core";
import { unwrapData } from "./data-utils";
import { detectAgentFileReferenceKind } from "./file-reference-utils";
import { basename, toProjectRelativePath } from "./path-utils";
import {
  opencodeAgentListPayloadSchema,
  opencodeFileSearchPayloadSchema,
  opencodeSlashCommandListPayloadSchema,
  type ParsedOpencodeAgent,
} from "./opencode-ingress";
import { mapProviderListToCatalog } from "./payload-mappers";
import { toOpenCodeRequestError } from "./request-errors";
import type { OpencodeRuntimeClientInput } from "./runtime-connection";
import type { ClientFactory } from "./types";

const OPENCODE_DEFAULT_AGENT_COLORS = new Map([
  ["build", "var(--icon-agent-build-base)"],
  ["plan", "var(--icon-agent-plan-base)"],
]);

const FILE_SEARCH_LIMIT = 20;

type OpencodeFileSearchInput = OpencodeRuntimeClientInput & {
  query: string;
};

type ClientFactoryFor<Namespace extends keyof ReturnType<ClientFactory>> = (
  input: Parameters<ClientFactory>[0],
) => Pick<ReturnType<ClientFactory>, Namespace>;

const resolveAgentColor = (
  agentName: string,
  explicitColor: string | undefined,
  isNative: boolean | undefined,
): string | undefined => {
  if (explicitColor?.trim()) {
    return explicitColor;
  }

  if (isNative !== true) {
    return undefined;
  }

  const normalizedName = agentName.trim().toLowerCase();
  return OPENCODE_DEFAULT_AGENT_COLORS.get(normalizedName);
};

const readAgentList = async (
  client: Pick<ReturnType<ClientFactory>, "app">,
  workingDirectory: string,
): Promise<ParsedOpencodeAgent[]> => {
  const payload = unwrapData(
    await client.app.agents({ directory: workingDirectory }),
    "list agents",
  );
  return opencodeAgentListPayloadSchema.parse(payload);
};

const normalizeFileSearchPath = (rawPath: string, workingDirectory: string): string => {
  const trimmedPath = rawPath.trim();
  if (trimmedPath.length === 0) {
    throw new Error("Invalid file search payload: expected non-empty file paths.");
  }

  return toProjectRelativePath(trimmedPath, workingDirectory);
};

const toFileSearchResult = (rawPath: string, workingDirectory: string): AgentFileSearchResult => {
  const path = normalizeFileSearchPath(rawPath, workingDirectory);
  const name = basename(path);
  return {
    id: path,
    path,
    name: name.length > 0 ? name : path,
    kind: detectAgentFileReferenceKind({
      filePath: path,
      isDirectory: /[\\/]\s*$/.test(rawPath),
    }),
  };
};

const toFileSearchResults = (
  payload: string[],
  workingDirectory: string,
): AgentFileSearchResult[] => {
  return payload.map((entry) => toFileSearchResult(entry, workingDirectory));
};

export const listAvailableModels = async (
  createClient: ClientFactoryFor<"app" | "config">,
  input: OpencodeRuntimeClientInput,
): Promise<AgentModelCatalog> => {
  const client = createClient({
    runtimeEndpoint: input.runtimeEndpoint,
    workingDirectory: input.workingDirectory,
  });
  const response = await client.config.providers({
    directory: input.workingDirectory,
  });
  const providerData = unwrapData(response, "list configured providers");
  const agentsData = await readAgentList(client, input.workingDirectory);
  const baseCatalog = mapProviderListToCatalog(providerData);
  const rawAgents = agentsData
    .map((agent) => {
      const resolvedColor = resolveAgentColor(agent.name, agent.color, agent.native);
      const profile: NonNullable<AgentModelCatalog["profiles"]>[number] & { label: string } = {
        id: agent.name,
        label: agent.name,
        mode: agent.mode,
      };
      if (agent.description) {
        profile.description = agent.description;
      }
      if (agent.hidden !== undefined) {
        profile.hidden = agent.hidden;
      }
      if (agent.native !== undefined) {
        profile.native = agent.native;
      }
      if (resolvedColor !== undefined) {
        profile.color = resolvedColor;
      }
      return profile;
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    ...baseCatalog,
    profiles: rawAgents,
  };
};

export const listAvailableSubagents = async (
  createClient: ClientFactoryFor<"app">,
  input: OpencodeRuntimeClientInput,
): Promise<AgentSubagentCatalog> => {
  try {
    const client = createClient({
      runtimeEndpoint: input.runtimeEndpoint,
      workingDirectory: input.workingDirectory,
    });
    const agentsData = await readAgentList(client, input.workingDirectory);
    const subagents = agentsData
      .map((agent) => {
        const trimmedName = agent.name.trim();
        if (agent.hidden === true || agent.mode === "primary") {
          return null;
        }

        const trimmedDescription = agent.description?.trim();
        const subagent: NonNullable<AgentSubagentCatalog["subagents"]>[number] & {
          label: string;
        } = {
          id: trimmedName,
          name: trimmedName,
          label: trimmedName,
        };
        if (trimmedDescription) {
          subagent.description = trimmedDescription;
        }
        return subagent;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((left, right) => left.label.localeCompare(right.label));

    return subagentCatalogSchema.parse({ subagents });
  } catch (error) {
    throw toOpenCodeRequestError("list subagents", error);
  }
};

export const listAvailableSlashCommands = async (
  createClient: ClientFactoryFor<"command">,
  input: OpencodeRuntimeClientInput,
): Promise<AgentSlashCommandCatalog> => {
  try {
    const client = createClient({
      runtimeEndpoint: input.runtimeEndpoint,
      workingDirectory: input.workingDirectory,
    });
    const parsedPayload = opencodeSlashCommandListPayloadSchema.safeParse(
      unwrapData(
        await client.command.list({ directory: input.workingDirectory }),
        "list slash commands",
      ),
    );
    if (!parsedPayload.success) {
      throw new Error("Invalid slash command payload: expected an array.");
    }
    const payload = parsedPayload.data;

    const commands = payload
      .map((command) => {
        const entry: AgentSlashCommandCatalog["commands"][number] = {
          id: command.name,
          trigger: command.name,
          title: command.name,
          hints: command.hints,
        };
        if (command.description) {
          entry.description = command.description;
        }
        if (command.source) {
          entry.source = command.source;
        }
        return [entry];
      })
      .flat()
      .sort((left, right) => left.trigger.localeCompare(right.trigger));

    return slashCommandCatalogSchema.parse({
      commands: [
        MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
        ...commands.filter((command) => command.trigger.toLowerCase() !== "compact"),
      ],
    });
  } catch (error) {
    throw toOpenCodeRequestError("list slash commands", error);
  }
};

export const searchFiles = async (
  createClient: ClientFactoryFor<"find">,
  input: OpencodeFileSearchInput,
): Promise<AgentFileSearchResult[]> => {
  try {
    const client = createClient({
      runtimeEndpoint: input.runtimeEndpoint,
      workingDirectory: input.workingDirectory,
    });
    const payload = await client.find.files({
      directory: input.workingDirectory,
      query: input.query,
      limit: FILE_SEARCH_LIMIT,
    });

    const parsedPayload = opencodeFileSearchPayloadSchema.safeParse(
      unwrapData(payload, "search files"),
    );
    if (!parsedPayload.success) {
      throw new Error("Invalid file search payload: expected an array of file paths.");
    }
    return toFileSearchResults(parsedPayload.data, input.workingDirectory);
  } catch (error) {
    throw toOpenCodeRequestError("search files", error);
  }
};
