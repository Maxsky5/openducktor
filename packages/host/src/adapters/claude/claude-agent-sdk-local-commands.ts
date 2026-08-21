import type {
  ClaudeHistoryEntryMetadata,
  ClaudeHistoryMessage,
} from "./claude-agent-sdk-history-import";
import { isRecord, readStringProp } from "./claude-agent-sdk-utils";
import type { JsonValue } from "@openducktor/contracts";
import { parseClaudeJsonValue } from "./claude-agent-sdk-ingress-schemas";

const CLAUDE_SYNTHETIC_MODEL = "<synthetic>";
const COMMAND_NAME_PATTERN = /<command-name>([\s\S]*?)<\/command-name>/;
const COMMAND_ARGS_PATTERN = /<command-args>([\s\S]*?)<\/command-args>/;
const LOCAL_COMMAND_STDOUT_PATTERN = /^<local-command-stdout>([\s\S]*)<\/local-command-stdout>$/;

export const isClaudeSyntheticAssistantMessage = (message: JsonValue | undefined): boolean =>
  isRecord(message) && readStringProp(message.message, "model") === CLAUDE_SYNTHETIC_MODEL;

export const readClaudeCommandEnvelope = (text: string): string | null => {
  const commandName = COMMAND_NAME_PATTERN.exec(text)?.[1]?.trim();
  if (!commandName) {
    return null;
  }
  const commandArgs = COMMAND_ARGS_PATTERN.exec(text)?.[1]?.trim();
  return commandArgs ? `${commandName} ${commandArgs}` : commandName;
};

export const readClaudeLocalCommandOutput = (content: JsonValue | undefined): string | null => {
  if (typeof content !== "string") {
    return null;
  }
  const match = LOCAL_COMMAND_STDOUT_PATTERN.exec(content.trim());
  if (!match) {
    return null;
  }
  return match[1]?.trim() ?? "";
};

export const readClaudeQueuedPrompt = (entry: ClaudeHistoryMessage): string | null => {
  const value = parseClaudeJsonValue(entry, "claudeHistoryMessage");
  if (entry.type !== "queue-operation" || readStringProp(value, "operation") !== "enqueue") {
    return null;
  }
  const content = readStringProp(value, "content")?.trim();
  return content && content.length > 0 ? content : null;
};

export const isClaudeMetaHistoryMessage = (entry: ClaudeHistoryMessage): boolean => {
  const value = parseClaudeJsonValue(entry, "claudeHistoryMessage");
  if (!isRecord(value)) {
    return false;
  }
  const metadata = entry as ClaudeHistoryEntryMetadata;
  return metadata.isMeta === true || metadata.interruptedByShutdown === true;
};
