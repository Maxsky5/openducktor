import { readdir } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import {
  type AgentInfo,
  type ModelInfo,
  type Query,
  query,
  type SDKUserMessage,
  type SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import {
  CLAUDE_RUNTIME_DESCRIPTOR,
  skillCatalogSchema,
  slashCommandCatalogSchema,
  subagentCatalogSchema,
} from "@openducktor/contracts";
import type {
  AgentEvent,
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelDescriptor,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
  AgentSubagentCatalog,
  ListAgentModelsInput,
  ListAgentSkillsInput,
  ListAgentSlashCommandsInput,
  ListAgentSubagentsInput,
  SearchAgentFilesInput,
} from "@openducktor/core";
import { buildClaudeAgentSdkBaseOptions } from "./claude-agent-sdk-options";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import {
  detectFileKind,
  FILE_SEARCH_LIMIT,
  FILE_SEARCH_MAX_VISITED,
  IGNORED_DIRECTORIES,
  INIT_TIMEOUT_MS,
  withTimeout,
} from "./claude-agent-sdk-utils";

export { toClaudeHistoryMessages } from "./claude-agent-sdk-history";
export { loadClaudeHistory } from "./claude-agent-sdk-history-loader";

type ClaudeCatalogSession = {
  queue: AsyncInputQueue<SDKUserMessage>;
  sdkQuery: Query;
};

const openClaudeCatalogSession = async (
  cwd: string,
  processEnv: NodeJS.ProcessEnv | undefined,
  claudeExecutablePath: string,
): Promise<ClaudeCatalogSession> => {
  const queue = new AsyncInputQueue<SDKUserMessage>();
  const abortController = new AbortController();
  const options = {
    ...buildClaudeAgentSdkBaseOptions({ claudeExecutablePath, cwd, processEnv }),
    abortController,
  } satisfies NonNullable<Parameters<typeof query>[0]>["options"];
  const sdkQuery = query({
    prompt: queue,
    options,
  });
  try {
    await withTimeout(
      sdkQuery.initializationResult(),
      INIT_TIMEOUT_MS,
      "Claude Agent SDK catalog initialization timed out. Check Claude authentication and network connectivity.",
    );
    return { queue, sdkQuery };
  } catch (error) {
    queue.close();
    sdkQuery.close();
    throw error;
  }
};

const closeClaudeCatalogSession = ({ queue, sdkQuery }: ClaudeCatalogSession): void => {
  queue.close();
  sdkQuery.close();
};

const readClaudeModels = async (
  cwd: string,
  processEnv: NodeJS.ProcessEnv | undefined,
  claudeExecutablePath: string,
): Promise<ModelInfo[]> => {
  const session = await openClaudeCatalogSession(cwd, processEnv, claudeExecutablePath);
  try {
    return await session.sdkQuery.supportedModels();
  } finally {
    closeClaudeCatalogSession(session);
  }
};

const readClaudeSlashCommands = async (
  cwd: string,
  processEnv: NodeJS.ProcessEnv | undefined,
  claudeExecutablePath: string,
): Promise<SlashCommand[]> => {
  const session = await openClaudeCatalogSession(cwd, processEnv, claudeExecutablePath);
  try {
    return await session.sdkQuery.supportedCommands();
  } finally {
    closeClaudeCatalogSession(session);
  }
};

const readClaudeSkills = async (
  cwd: string,
  processEnv: NodeJS.ProcessEnv | undefined,
  claudeExecutablePath: string,
): Promise<SlashCommand[]> => {
  const session = await openClaudeCatalogSession(cwd, processEnv, claudeExecutablePath);
  try {
    const response = await session.sdkQuery.reloadSkills();
    return response.skills;
  } finally {
    closeClaudeCatalogSession(session);
  }
};

const readClaudeSubagents = async (
  cwd: string,
  processEnv: NodeJS.ProcessEnv | undefined,
  claudeExecutablePath: string,
): Promise<AgentInfo[]> => {
  const session = await openClaudeCatalogSession(cwd, processEnv, claudeExecutablePath);
  try {
    return await session.sdkQuery.supportedAgents();
  } finally {
    closeClaudeCatalogSession(session);
  }
};

export const toClaudeModelDescriptor = (model: ModelInfo): AgentModelDescriptor => ({
  id: model.value,
  providerId: "claude",
  providerName: "Claude",
  modelId: model.value,
  modelName: model.displayName,
  variants: [...(model.supportedEffortLevels ?? [])],
  liveSessionUpdates: {
    profile: false,
    variants: (model.supportedEffortLevels ?? []).filter((variant) => variant !== "max"),
  },
  attachmentSupport: {
    image: true,
    audio: false,
    video: false,
    pdf: true,
    mimeTypes: {
      image: ["image/jpeg", "image/png", "image/gif", "image/webp"],
      pdf: ["application/pdf"],
    },
  },
});

export const listClaudeModels = async (
  input: ListAgentModelsInput,
  processEnv: NodeJS.ProcessEnv | undefined,
  claudeExecutablePath: string,
): Promise<AgentModelCatalog> => {
  const models = await readClaudeModels(input.repoPath, processEnv, claudeExecutablePath);
  return {
    runtime: CLAUDE_RUNTIME_DESCRIPTOR,
    models: models.map((model) => toClaudeModelDescriptor(model)),
    defaultModelsByProvider: models[0] ? { claude: models[0].value } : {},
    profiles: [],
  };
};

export const listClaudeSlashCommands = async (
  input: ListAgentSlashCommandsInput,
  processEnv: NodeJS.ProcessEnv | undefined,
  claudeExecutablePath: string,
): Promise<AgentSlashCommandCatalog> => {
  const commands = await readClaudeSlashCommands(
    input.workingDirectory,
    processEnv,
    claudeExecutablePath,
  );
  return toClaudeSlashCommandCatalog(commands);
};

type ClaudeSlashCommandCatalog = Extract<
  AgentEvent,
  { type: "runtime_slash_commands_changed" }
>["catalog"];

export const toClaudeSlashCommandCatalog = (
  commands: SlashCommand[],
): ClaudeSlashCommandCatalog => {
  // Claude command references are addressable by name. Inherited scopes may expose
  // multiple definitions for that name, so publish the first SDK entry once.
  const commandsByName = new Map<string, SlashCommand>();
  for (const command of commands) {
    if (!commandsByName.has(command.name)) {
      commandsByName.set(command.name, command);
    }
  }

  const catalog: ClaudeSlashCommandCatalog = {
    commands: [...commandsByName.values()]
      .map((command) => ({
        id: command.name,
        trigger: command.name,
        title: command.name,
        ...(command.description ? { description: command.description } : {}),
        source: "command" as const,
        hints: command.argumentHint ? [command.argumentHint] : [],
      }))
      .sort((left, right) => left.trigger.localeCompare(right.trigger)),
  };
  slashCommandCatalogSchema.parse(catalog);
  return catalog;
};

export const listClaudeSkills = async (
  input: ListAgentSkillsInput,
  processEnv: NodeJS.ProcessEnv | undefined,
  claudeExecutablePath: string,
): Promise<AgentSkillCatalog> => {
  const skills = await readClaudeSkills(input.workingDirectory, processEnv, claudeExecutablePath);
  return toClaudeSkillCatalog(skills);
};

export const toClaudeSkillCatalog = (skills: SlashCommand[]): AgentSkillCatalog => {
  // Claude skill references are addressable by name. Inherited scopes may expose
  // multiple definitions for that name, so publish the first SDK entry once.
  const skillsByName = new Map<string, SlashCommand>();
  for (const skill of skills) {
    if (!skillsByName.has(skill.name)) {
      skillsByName.set(skill.name, skill);
    }
  }

  return skillCatalogSchema.parse({
    skills: [...skillsByName.values()]
      .map((skill) => ({
        id: skill.name,
        name: skill.name,
        path: skill.name,
        title: skill.name,
        ...(skill.description ? { description: skill.description } : {}),
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  });
};

export const toClaudeSubagentCatalog = (agents: AgentInfo[]): AgentSubagentCatalog => {
  return subagentCatalogSchema.parse({
    subagents: agents
      .map((agent) => ({
        id: agent.name,
        name: agent.name,
        label: agent.name,
        ...(agent.description ? { description: agent.description } : {}),
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  });
};

export const listClaudeSubagents = async (
  input: ListAgentSubagentsInput,
  processEnv: NodeJS.ProcessEnv | undefined,
  claudeExecutablePath: string,
): Promise<AgentSubagentCatalog> => {
  const agents = await readClaudeSubagents(
    input.workingDirectory,
    processEnv,
    claudeExecutablePath,
  );
  return toClaudeSubagentCatalog(agents);
};

export const searchClaudeWorkspaceFiles = async (
  input: SearchAgentFilesInput,
): Promise<AgentFileSearchResult[]> => {
  const root = resolve(input.workingDirectory);
  const queryText = input.query.trim().toLowerCase();
  const results: AgentFileSearchResult[] = [];
  let visited = 0;
  const visit = async (directory: string): Promise<void> => {
    if (results.length >= FILE_SEARCH_LIMIT || visited >= FILE_SEARCH_MAX_VISITED) {
      return;
    }
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= FILE_SEARCH_LIMIT || visited >= FILE_SEARCH_MAX_VISITED) {
        return;
      }
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const absolutePath = resolve(directory, entry.name);
      const relativePath = relative(root, absolutePath).split(sep).join("/");
      if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
        continue;
      }
      visited += 1;
      const haystack = `${entry.name}\n${relativePath}`.toLowerCase();
      if (haystack.includes(queryText)) {
        results.push({
          id: relativePath,
          path: relativePath,
          name: basename(relativePath),
          kind: detectFileKind(relativePath, entry.isDirectory()) as AgentFileSearchResult["kind"],
        });
      }
      if (entry.isDirectory()) {
        await visit(absolutePath);
      }
    }
  };
  await visit(root);
  return results;
};
