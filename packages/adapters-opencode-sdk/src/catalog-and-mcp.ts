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
  client: ReturnType<ClientFactory>,
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
  payload: unknown,
  workingDirectory: string,
): AgentFileSearchResult[] => {
  const paths = opencodeFileSearchPayloadSchema.safeParse(payload);
  if (!paths.success) {
    throw new Error("Invalid file search payload: expected an array of file paths.");
  }

  return paths.data.map((entry) => toFileSearchResult(entry, workingDirectory));
};

export const listAvailableModels = async (
  createClient: ClientFactory,
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
      return {
        id: agent.name,
        label: agent.name,
        ...(agent.description ? { description: agent.description } : undefined),
        mode: agent.mode,
        ...(agent.hidden !== undefined ? { hidden: agent.hidden } : undefined),
        ...(agent.native !== undefined ? { native: agent.native } : undefined),
        ...(resolvedColor !== undefined ? { color: resolvedColor } : undefined),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    ...baseCatalog,
    profiles: rawAgents,
  };
};

export const listAvailableSubagents = async (
  createClient: ClientFactory,
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
        return {
          id: trimmedName,
          name: trimmedName,
          label: trimmedName,
          ...(trimmedDescription ? { description: trimmedDescription } : undefined),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((left, right) => left.label.localeCompare(right.label));

    return subagentCatalogSchema.parse({ subagents });
  } catch (error) {
    throw toOpenCodeRequestError("list subagents", error);
  }
};

export const listAvailableSlashCommands = async (
  createClient: ClientFactory,
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
        return [
          {
            id: command.name,
            trigger: command.name,
            title: command.name,
            ...(command.description ? { description: command.description } : undefined),
            ...(command.source ? { source: command.source } : undefined),
            hints: command.hints,
          },
        ];
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
  createClient: ClientFactory,
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

    return toFileSearchResults(unwrapData(payload, "search files"), input.workingDirectory);
  } catch (error) {
    throw toOpenCodeRequestError("search files", error);
  }
};
