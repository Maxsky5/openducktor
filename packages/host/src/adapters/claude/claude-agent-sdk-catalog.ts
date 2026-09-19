import {
  type AgentInfo,
  type ModelInfo,
  type Options,
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
import {
  type AgentEvent,
  type AgentModelCatalog,
  type AgentModelDescriptor,
  type AgentRuntimeCatalogRead,
  type AgentSkillCatalog,
  type AgentSubagentCatalog,
  isAgentRuntimeCatalogSurfaceRequested,
  type ListAgentRuntimeCatalogInput,
  readAgentRuntimeCatalogSurface,
} from "@openducktor/core";
import { buildClaudeAgentSdkBaseOptions } from "./claude-agent-sdk-options";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import { INIT_TIMEOUT_MS, withTimeout } from "./claude-agent-sdk-utils";

export { toClaudeHistoryMessages } from "./claude-agent-sdk-history";
export { loadClaudeHistory } from "./claude-agent-sdk-history-loader";

type ClaudeCatalogQuery = ReturnType<ClaudeCatalogQueryFactory>;

type ClaudeCatalogSession = {
  queue: AsyncInputQueue<SDKUserMessage>;
  sdkQuery: ClaudeCatalogQuery;
};

export type ClaudeCatalogQueryFactory = (input: {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Options;
}) => Pick<
  Query,
  "close" | "initializationResult" | "supportedAgents" | "supportedCommands" | "supportedModels"
>;

export const loadClaudeRuntimeCatalog = async (
  input: ListAgentRuntimeCatalogInput,
  processEnv: NodeJS.ProcessEnv | undefined,
  claudeExecutablePath: string,
  createQuery: ClaudeCatalogQueryFactory,
): Promise<AgentRuntimeCatalogRead> => {
  const session = await openClaudeCatalogSession(
    input.workingDirectory,
    {
      ...processEnv,
      // The SDK otherwise completes initialization while inherited MCP servers are
      // still pending, which leaves their prompts out of supportedCommands().
      // MCP_CONNECT_TIMEOUT_MS bounds the blocking wait, so the model, skill, and
      // subagent surfaces do not wait on a slow MCP server.
      MCP_CONNECTION_NONBLOCKING: "0",
      MCP_CONNECT_TIMEOUT_MS: "5000",
    },
    claudeExecutablePath,
    createQuery,
  );
  try {
    return await readClaudeCatalogSurfaces(session.sdkQuery, input.surfaces);
  } finally {
    closeClaudeCatalogSession(session);
  }
};

const openClaudeCatalogSession = async (
  cwd: string,
  processEnv: NodeJS.ProcessEnv | undefined,
  claudeExecutablePath: string,
  createQuery: ClaudeCatalogQueryFactory,
): Promise<ClaudeCatalogSession> => {
  const queue = new AsyncInputQueue<SDKUserMessage>();
  const abortController = new AbortController();
  const options = {
    ...buildClaudeAgentSdkBaseOptions({ claudeExecutablePath, cwd, processEnv }),
    abortController,
  } satisfies NonNullable<Parameters<typeof query>[0]>["options"];
  const sdkQuery = createQuery({
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

const readClaudeCatalogSurfaces = async (
  sdkQuery: ClaudeCatalogQuery,
  surfaces: ListAgentRuntimeCatalogInput["surfaces"],
): Promise<AgentRuntimeCatalogRead> => {
  let commands: Promise<SlashCommand[]> | undefined;
  const readCommands = (): Promise<SlashCommand[]> => {
    commands ??= sdkQuery.supportedCommands();
    return commands;
  };
  const [models, slashCommands, skills, subagents] = await Promise.all([
    isAgentRuntimeCatalogSurfaceRequested(surfaces, "models")
      ? readAgentRuntimeCatalogSurface(async () =>
          toClaudeModelCatalog(await sdkQuery.supportedModels()),
        )
      : undefined,
    isAgentRuntimeCatalogSurfaceRequested(surfaces, "slashCommands")
      ? readAgentRuntimeCatalogSurface(async () =>
          toClaudeSlashCommandCatalog(await readCommands()),
        )
      : undefined,
    isAgentRuntimeCatalogSurfaceRequested(surfaces, "skills")
      ? readAgentRuntimeCatalogSurface(async () => toClaudeSkillCatalog(await readCommands()))
      : undefined,
    isAgentRuntimeCatalogSurfaceRequested(surfaces, "subagents")
      ? readAgentRuntimeCatalogSurface(async () =>
          toClaudeSubagentCatalog(await sdkQuery.supportedAgents()),
        )
      : undefined,
  ]);
  const catalog: AgentRuntimeCatalogRead = { runtime: CLAUDE_RUNTIME_DESCRIPTOR };
  if (models) {
    catalog.models = models;
  }
  if (slashCommands) {
    catalog.slashCommands = slashCommands;
  }
  if (skills) {
    catalog.skills = skills;
  }
  if (subagents) {
    catalog.subagents = subagents;
  }
  return catalog;
};

export const toClaudeModelCatalog = (models: ModelInfo[]): AgentModelCatalog => ({
  runtime: CLAUDE_RUNTIME_DESCRIPTOR,
  models: models.map((model) => toClaudeModelDescriptor(model)),
  defaultModelsByProvider: models[0] ? { claude: models[0].value } : {},
  profiles: [],
});

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
  !HIDDEN_CLAUDE_SLASH_COMMANDS.has(command.name) && !CLAUDE_NON_SKILL_COMMANDS.has(command.name);

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
          : (() => {
              const item: ClaudeSlashCommandCatalog["commands"][number] = {
                id: command.name,
                trigger: command.name,
                title: command.name,
                source: isClaudeSkillCommand(command) ? ("skill" as const) : ("command" as const),
                hints: command.argumentHint ? [command.argumentHint] : [],
              };
              if (command.description) {
                item.description = command.description;
              }
              return item;
            })(),
      )
      .sort((left, right) => left.trigger.localeCompare(right.trigger)),
  };
  slashCommandCatalogSchema.parse(catalog);
  return catalog;
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
      .map((skill) => {
        const item: AgentSkillCatalog["skills"][number] = {
          id: skill.name,
          name: skill.name,
          path: skill.name,
          title: skill.name,
        };
        if (skill.description) {
          item.description = skill.description;
        }
        return item;
      })
      .sort((left, right) => left.name.localeCompare(right.name)),
  });
};

const toClaudeSubagentCatalog = (agents: AgentInfo[]): AgentSubagentCatalog => {
  return subagentCatalogSchema.parse({
    subagents: agents
      .map((agent) => {
        const item: AgentSubagentCatalog["subagents"][number] = {
          id: agent.name,
          name: agent.name,
          label: agent.name,
        };
        if (agent.description) {
          item.description = agent.description;
        }
        return item;
      })
      .sort((left, right) => left.name.localeCompare(right.name)),
  });
};

