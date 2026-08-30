import type { SDKMessage, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeHistoryMessage } from "./claude-agent-sdk-history-import";
import { z } from "zod";
import { readStringProp } from "./claude-agent-sdk-utils";

const CLAUDE_SYNTHETIC_MODEL = "<synthetic>";
const COMMAND_NAME_PATTERN = /<command-name>([\s\S]*?)<\/command-name>/;
const COMMAND_ARGS_PATTERN = /<command-args>([\s\S]*?)<\/command-args>/;
const LOCAL_COMMAND_STDOUT_PATTERN = /^<local-command-stdout>([\s\S]*)<\/local-command-stdout>$/;
const claudeSyntheticMessageSchema = z.looseObject({
  message: z.looseObject({ model: z.string().optional() }),
});
const claudeLocalCommandOutputSchema = z.string();

export const isClaudeSyntheticAssistantMessage = (
  message: SDKMessage | SessionStoreEntry,
): boolean => {
  const parsed = claudeSyntheticMessageSchema.safeParse(message);
  return parsed.success && parsed.data.message.model === CLAUDE_SYNTHETIC_MODEL;
};

export const readClaudeCommandEnvelope = (text: string): string | null => {
  const commandName = COMMAND_NAME_PATTERN.exec(text)?.[1]?.trim();
  if (!commandName) {
    return null;
  }
  const commandArgs = COMMAND_ARGS_PATTERN.exec(text)?.[1]?.trim();
  return commandArgs ? `${commandName} ${commandArgs}` : commandName;
};

export const readClaudeLocalCommandOutput = (content: SessionStoreEntry[string]): string | null => {
  const parsed = claudeLocalCommandOutputSchema.safeParse(content);
  if (!parsed.success) {
    return null;
  }
  const match = LOCAL_COMMAND_STDOUT_PATTERN.exec(parsed.data.trim());
  if (!match) {
    return null;
  }
  return match[1]?.trim() ?? "";
};

export const readClaudeQueuedPrompt = (entry: ClaudeHistoryMessage): string | null => {
  const value = entry;
  if (entry.type !== "queue-operation" || readStringProp(value, "operation") !== "enqueue") {
    return null;
  }
  const content = readStringProp(value, "content")?.trim();
  return content && content.length > 0 ? content : null;
};

export const isClaudeMetaHistoryMessage = (entry: ClaudeHistoryMessage): boolean => {
  return entry.isMeta === true || entry.interruptedByShutdown === true;
};
