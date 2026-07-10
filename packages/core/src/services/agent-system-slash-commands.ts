import {
  isManualSessionCompactionSlashCommand,
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
} from "@openducktor/contracts";
import type { AgentUserMessagePart } from "../types/agent-orchestrator";
import { normalizeAgentUserMessageParts } from "./agent-user-message-parts";

export type SystemSlashCommandInvocation =
  | { kind: "not_system" }
  | { kind: "manual_session_compaction" };

export const classifySystemSlashCommandInvocation = (
  parts: AgentUserMessagePart[],
): SystemSlashCommandInvocation => {
  const normalizedParts = normalizeAgentUserMessageParts(parts);
  const slashCommands = normalizedParts.flatMap((part) =>
    part.kind === "slash_command" ? [part.command] : [],
  );
  const canonicalCommand = slashCommands.find(isManualSessionCompactionSlashCommand);
  const hasReservedLookalike = slashCommands.some(
    (command) =>
      (command.trigger.toLowerCase() === MANUAL_SESSION_COMPACTION_SLASH_COMMAND.trigger ||
        command.id === MANUAL_SESSION_COMPACTION_SLASH_COMMAND.id ||
        command.source === MANUAL_SESSION_COMPACTION_SLASH_COMMAND.source) &&
      !isManualSessionCompactionSlashCommand(command),
  );

  if (hasReservedLookalike) {
    throw new Error(
      `/${MANUAL_SESSION_COMPACTION_SLASH_COMMAND.trigger} is a reserved system slash command.`,
    );
  }
  if (!canonicalCommand) {
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
