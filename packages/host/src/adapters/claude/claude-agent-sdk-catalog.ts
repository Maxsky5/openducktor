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
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
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
  const session = await openClaudeCatalogSession(
    cwd,
    {
      ...processEnv,
      // The SDK otherwise completes initialization while inherited MCP servers are
      // still pending, which leaves their prompts out of supportedCommands().
      MCP_CONNECTION_NONBLOCKING: "0",
    },
    claudeExecutablePath,
  );
  try {
    return await session.sdkQuery.supportedCommands();
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

const HIDDEN_CLAUDE_SLASH_COMMANDS = new Set([
  "__remote-workflow",
  "agents",
  "clear",
  "color",
  "config",
  "design",
  "design-consent",
  "design-revoke",
  "design-sync",
  "effort",
  "fast",
  "heapdump",
  "insights",
  "mcp",
  "model",
  "reload-skills",
  "rename",
  "team-onboarding",
  "workflow-launch-exec",
]);

// supportedCommands() mixes fixed Claude commands, bundled workflows, skills,
// and external prompts. Keep entries marked "Skill" in Claude's reference and
// exclude the fixed commands and bundled workflows:
// https://code.claude.com/docs/en/commands#commands
const CLAUDE_NON_SKILL_COMMANDS = new Set([
  "__remote-workflow",
  "add-dir",
  "advisor",
  "agents",
  "autofix-pr",
  "background",
  "branch",
  "btw",
  "bug",
  "cd",
  "chrome",
  "clear",
  "color",
  "compact",
  "config",
  "context",
  "copy",
  "cost",
  "deep-research",
  "design",
  "design-consent",
  "design-login",
  "design-revoke",
  "desktop",
  "diff",
  "effort",
  "exit",
  "export",
  "fast",
  "feedback",
  "focus",
  "fork",
  "goal",
  "heapdump",
  "help",
  "hooks",
  "ide",
  "init",
  "insights",
  "install-github-app",
  "install-slack-app",
  "keybindings",
  "login",
  "logout",
  "mcp",
  "memory",
  "mobile",
  "model",
  "passes",
  "permissions",
  "plan",
  "plugin",
  "powerup",
  "pr-comments",
  "privacy-settings",
  "radio",
  "recap",
  "release-notes",
  "reload-plugins",
  "reload-skills",
  "remote-control",
  "remote-env",
  "rename",
  "resume",
  "review",
  "rewind",
  "sandbox",
  "schedule",
  "scroll-speed",
  "security-review",
  "setup-bedrock",
  "setup-vertex",
  "skills",
  "stats",
  "status",
  "statusline",
  "stickers",
  "stop",
  "subtask",
  "tasks",
  "team-onboarding",
  "teleport",
  "terminal-setup",
  "theme",
  "tui",
  "ultraplan",
  "ultrareview",
  "upgrade",
  "usage",
  "usage-credits",
  "vim",
  "voice",
  "web-setup",
  "workflow-launch-exec",
  "workflows",
]);

const isClaudeSkillCommand = (command: SlashCommand): boolean =>
  !CLAUDE_NON_SKILL_COMMANDS.has(command.name);

export const toClaudeSlashCommandCatalog = (
  commands: SlashCommand[],
): ClaudeSlashCommandCatalog => {
  // Claude command references are addressable by name. Inherited scopes may expose
  // multiple definitions for that name, so publish the first SDK entry once.
  const commandsByName = new Map<string, SlashCommand>();
  for (const command of commands) {
    if (!HIDDEN_CLAUDE_SLASH_COMMANDS.has(command.name) && !commandsByName.has(command.name)) {
      commandsByName.set(command.name, command);
    }
  }

  const catalog: ClaudeSlashCommandCatalog = {
    commands: [...commandsByName.values()]
      .map((command) =>
        command.name === MANUAL_SESSION_COMPACTION_SLASH_COMMAND.trigger
          ? MANUAL_SESSION_COMPACTION_SLASH_COMMAND
          : {
              id: command.name,
              trigger: command.name,
              title: command.name,
              ...(command.description ? { description: command.description } : {}),
              source: isClaudeSkillCommand(command) ? ("skill" as const) : ("command" as const),
              hints: command.argumentHint ? [command.argumentHint] : [],
            },
      )
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
  const commands = await readClaudeSlashCommands(
    input.workingDirectory,
    processEnv,
    claudeExecutablePath,
  );
  return toClaudeSkillCatalog(commands);
};

export const toClaudeSkillCatalog = (commands: SlashCommand[]): AgentSkillCatalog => {
  // Claude prompt references are addressable by name. Inherited scopes may expose
  // multiple definitions for that name, so publish the first SDK entry once.
  const skillsByName = new Map<string, SlashCommand>();
  for (const command of commands) {
    if (isClaudeSkillCommand(command) && !skillsByName.has(command.name)) {
      skillsByName.set(command.name, command);
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
