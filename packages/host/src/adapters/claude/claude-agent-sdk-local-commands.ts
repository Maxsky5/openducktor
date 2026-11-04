import type { SDKMessage, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeHistoryMessage } from "./claude-agent-sdk-history-messages";
import { z } from "zod";
import { readStringProp } from "./claude-agent-sdk-utils";

const CLAUDE_SYNTHETIC_MODEL = "<synthetic>";
const CLAUDE_NO_RESPONSE_TEXT = "No response requested.";
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

const claudeNoResponseMessageSchema = z.looseObject({
  isApiErrorMessage: z.literal(false).optional(),
  message: z.looseObject({
    model: z.literal(CLAUDE_SYNTHETIC_MODEL),
    content: z.tuple([
      z.looseObject({ type: z.literal("text"), text: z.literal(CLAUDE_NO_RESPONSE_TEXT) }),
    ]),
  }),
});

/** On resume, the CLI writes this synthetic reply to close a turn that stopped before it finished. */
export const isClaudeNoResponseAssistantMessage = (entry: ClaudeHistoryMessage): boolean =>
  entry.type === "assistant" && claudeNoResponseMessageSchema.safeParse(entry).success;

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
  return (
    entry.isMeta === true ||
    entry.is_meta === true ||
    entry.isVisibleInTranscriptOnly === true ||
    entry.interruptedByShutdown === true
  );
};

const claudeMetaStreamFlagSchema = z.looseObject({ isSynthetic: z.boolean().optional() });

/**
 * Reads the hidden-turn flag from a live SDK message. The CLI stores its "Continue from
 * where you left off." turn with `isMeta` and maps that field to `isSynthetic` on the
 * live stream, so the live predicate must read the wire field.
 */
export const isClaudeMetaStreamMessage = (message: SDKMessage | SessionStoreEntry): boolean => {
  const parsed = claudeMetaStreamFlagSchema.safeParse(message);
  return parsed.success && parsed.data.isSynthetic === true;
};
