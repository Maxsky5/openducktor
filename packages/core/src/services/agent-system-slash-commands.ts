import {
  AGENT_SESSION_GOAL_OBJECTIVE_MAX_LENGTH,
  GOAL_SLASH_COMMAND,
  isGoalSlashCommand,
  isManualSessionCompactionSlashCommand,
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
  type SlashCommandDescriptor,
} from "@openducktor/contracts";
import type { AgentUserMessagePart } from "../types/agent-orchestrator";
import { normalizeAgentUserMessageParts } from "./agent-user-message-parts";

export type AgentSessionGoalCommand =
  | { readonly kind: "set"; readonly objective: string }
  | { readonly kind: "pause" }
  | { readonly kind: "resume" }
  | { readonly kind: "clear" };

export type SystemSlashCommandInvocation =
  | { kind: "not_system" }
  | { kind: "manual_session_compaction" }
  | { kind: "goal"; command: AgentSessionGoalCommand };

const RESERVED_SYSTEM_SLASH_COMMANDS = [
  {
    descriptor: MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
    matches: isManualSessionCompactionSlashCommand,
  },
  { descriptor: GOAL_SLASH_COMMAND, matches: isGoalSlashCommand },
] as const;

/**
 * The triggers of the OpenDucktor system commands. A reusable prompt never uses one. A runtime
 * catalog command uses one only when OpenDucktor does not run that trigger for its runtime.
 */
export const RESERVED_SYSTEM_SLASH_COMMAND_TRIGGERS: ReadonlySet<string> = new Set(
  RESERVED_SYSTEM_SLASH_COMMANDS.map(({ descriptor }) => descriptor.trigger),
);

export const reservedSystemSlashCommandMessage = (trigger: string): string =>
  `/${trigger} is a reserved system slash command.`;

/** A command of a runtime catalog. OpenDucktor and reusable prompts use `system` and `custom`. */
const isRuntimeCatalogCommand = (command: SlashCommandDescriptor): boolean =>
  command.source !== "system" && command.source !== "custom";

/**
 * A command that copies a reserved system command. A runtime catalog command can use a reserved
 * trigger, and it reaches the runtime as a native command.
 */
const isReservedLookalike = (command: SlashCommandDescriptor): boolean =>
  RESERVED_SYSTEM_SLASH_COMMANDS.some(
    ({ descriptor, matches }) =>
      !matches(command) &&
      (command.id === descriptor.id ||
        (command.trigger.toLowerCase() === descriptor.trigger &&
          !isRuntimeCatalogCommand(command))),
  );

/** Why a trimmed goal objective is too long, or `null`. Every goal input uses this limit. */
export const goalObjectiveLengthProblem = (objective: string): string | null =>
  objective.length > AGENT_SESSION_GOAL_OBJECTIVE_MAX_LENGTH
    ? `A goal objective can have at most ${AGENT_SESSION_GOAL_OBJECTIVE_MAX_LENGTH} characters. This one has ${objective.length}.`
    : null;

export const GOAL_COMMAND_MISSING_OBJECTIVE_MESSAGE =
  "Add an objective, or use pause, resume, or clear.";

const classifyGoalCommand = (normalizedParts: AgentUserMessagePart[]): AgentSessionGoalCommand => {
  const [first, ...rest] = normalizedParts;
  if (first?.kind !== "slash_command" || rest.some((part) => part.kind !== "text")) {
    throw new Error(
      `/${GOAL_SLASH_COMMAND.trigger} accepts text only. Start the message with /${GOAL_SLASH_COMMAND.trigger}, and remove attachments and references.`,
    );
  }
  const argument = rest
    .map((part) => (part.kind === "text" ? part.text : ""))
    .join("")
    .trim();
  if (argument.length === 0) throw new Error(GOAL_COMMAND_MISSING_OBJECTIVE_MESSAGE);
  const keyword = argument.toLowerCase();
  if (keyword === "pause" || keyword === "resume" || keyword === "clear") return { kind: keyword };
  const lengthProblem = goalObjectiveLengthProblem(argument);
  if (lengthProblem) throw new Error(lengthProblem);
  return { kind: "set", objective: argument };
};

export const classifySystemSlashCommandInvocation = (
  parts: AgentUserMessagePart[],
): SystemSlashCommandInvocation => {
  const normalizedParts = normalizeAgentUserMessageParts(parts);
  const slashCommands = normalizedParts.flatMap((part) =>
    part.kind === "slash_command" ? [part.command] : [],
  );
  const reservedLookalike = slashCommands.find(isReservedLookalike);
  if (reservedLookalike) {
    throw new Error(reservedSystemSlashCommandMessage(reservedLookalike.trigger));
  }
  if (slashCommands.some(isGoalSlashCommand)) {
    if (slashCommands.length !== 1) {
      throw new Error(`/${GOAL_SLASH_COMMAND.trigger} must be the only slash command.`);
    }
    return { kind: "goal", command: classifyGoalCommand(normalizedParts) };
  }
  if (!slashCommands.some(isManualSessionCompactionSlashCommand)) {
    return { kind: "not_system" };
  }
  if (
    normalizedParts.length !== 1 ||
    normalizedParts[0]?.kind !== "slash_command" ||
    slashCommands.length !== 1
  ) {
    throw new Error(
      `/${MANUAL_SESSION_COMPACTION_SLASH_COMMAND.trigger} must be sent without arguments or references.`,
    );
  }
  return { kind: "manual_session_compaction" };
};
