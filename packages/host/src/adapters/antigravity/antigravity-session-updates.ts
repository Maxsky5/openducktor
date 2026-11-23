import type { SessionUpdate } from "@agentclientprotocol/sdk/unstable";
import {
  type AgentSessionContextUsage,
  type SkillCatalog,
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
  type SlashCommandCatalog,
} from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";

/** True for an update that shows that the runtime works on the turn. */
export const isAntigravityTurnContent = (update: SessionUpdate): boolean => {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
    case "agent_thought_chunk":
    case "tool_call":
    case "tool_call_update":
    case "plan":
      return true;
    default:
      return false;
  }
};

/** True for an update that changes the snapshot of a session without a transcript event. */
export const changesAntigravitySnapshot = (update: SessionUpdate): boolean =>
  update.sessionUpdate === "usage_update" || update.sessionUpdate === "session_info_update";

/** The context use of a `usage_update`, with the model of the session. */
export const toAntigravityContextUsage = (
  update: Extract<SessionUpdate, { sessionUpdate: "usage_update" }>,
  model: AgentModelSelection | undefined,
): AgentSessionContextUsage => {
  const usage: AgentSessionContextUsage = { totalTokens: update.used, contextWindow: update.size };
  if (model) {
    usage.providerId = model.providerId;
    usage.modelId = model.modelId;
    if (model.variant) usage.variant = model.variant;
  }
  return usage;
};

/**
 * The built-in slash commands of the Antigravity CLI. Antigravity lists every skill as a slash
 * command too, so a listed name that is not here is a skill.
 * https://antigravity.google/docs/cli/reference.md#core-slash-commands
 */
const ANTIGRAVITY_CORE_SLASH_COMMANDS = new Set([
  "add-dir",
  "agents",
  "agy-customizations",
  "antigravity-guide",
  "artifact",
  "boost",
  "browser",
  "btw",
  "changelog",
  "clear",
  "codesearch",
  "compact",
  "config",
  "context",
  "copy",
  "credits",
  "cs",
  "diff",
  "effort",
  "exit",
  "feedback",
  "fork",
  "goal",
  "grill-me",
  "help",
  "hooks",
  "keybindings",
  "learn",
  "logout",
  "mcp",
  "model",
  "open",
  "permissions",
  "plan",
  "plugin",
  "remote-control",
  "rename",
  "resume",
  "rewind",
  "schedule",
  "search",
  "skills",
  "statusline",
  "swarm",
  "tasks",
  "teamwork",
  "title",
  "usage",
  "voice",
]);

/**
 * Built-in commands that OpenDucktor does not offer. The workers of `/swarm` run in their own
 * conversations, which only the Swarm pane of Antigravity shows, and a swarm uses quota fast.
 */
const HIDDEN_ANTIGRAVITY_COMMANDS = new Set(["swarm"]);

/** True for a slash command name that Antigravity runs as a skill. */
export const isAntigravitySkillName = (name: string): boolean =>
  name.length > 0 && !ANTIGRAVITY_CORE_SLASH_COMMANDS.has(name);

/**
 * The command list of a session. Antigravity can list a name twice, for example a built-in command
 * and a skill with the same name, and it runs the first one, so the list keeps the first entry.
 * Its `/compact` is the OpenDucktor session compaction, so the composer shows the compaction.
 */
export const toAntigravitySlashCommandCatalog = (
  update: Extract<SessionUpdate, { sessionUpdate: "available_commands_update" }>,
): SlashCommandCatalog => {
  const seen = new Set<string>();
  const commands: SlashCommandCatalog["commands"] = [];
  for (const command of update.availableCommands) {
    const name = command.name.trim();
    if (!name || seen.has(name) || HIDDEN_ANTIGRAVITY_COMMANDS.has(name)) continue;
    seen.add(name);
    if (name === MANUAL_SESSION_COMPACTION_SLASH_COMMAND.trigger) {
      commands.push(MANUAL_SESSION_COMPACTION_SLASH_COMMAND);
      continue;
    }
    const hint = command.input && "hint" in command.input ? command.input.hint.trim() : "";
    const description = command.description.trim();
    const descriptor: SlashCommandCatalog["commands"][number] = {
      id: `antigravity:${name}`,
      trigger: name,
      title: `/${name}`,
      source: isAntigravitySkillName(name) ? "skill" : "command",
      hints: hint ? [hint] : [],
    };
    if (description) descriptor.description = description;
    commands.push(descriptor);
  }
  return { commands };
};

/** The skills of a command list. A message sends a skill as its slash command. */
export const toAntigravitySkillCatalog = (catalog: SlashCommandCatalog): SkillCatalog => ({
  skills: catalog.commands.flatMap((command) => {
    if (command.source !== "skill") return [];
    const skill: SkillCatalog["skills"][number] = {
      id: command.trigger,
      name: command.trigger,
      path: command.trigger,
      title: command.trigger,
    };
    if (command.description) skill.description = command.description;
    return [skill];
  }),
});
