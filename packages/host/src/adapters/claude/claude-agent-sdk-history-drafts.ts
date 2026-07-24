import { isNestedHistoryEntry } from "./claude-agent-sdk-history-entry";
import type { ClaudeHistoryMessage } from "./claude-agent-sdk-history-import";
import { isClaudeToolUseBlockType } from "./claude-agent-sdk-tool-shapes";
import { historyMessageText, isRecord, readStringProp } from "./claude-agent-sdk-utils";

const assistantMessageStopReason = (entry: ClaudeHistoryMessage): string | undefined =>
  isRecord(entry) ? readStringProp(entry.message, "stop_reason") : undefined;

const hasToolUseContentBlock = (content: unknown): boolean =>
  Array.isArray(content) &&
  content.some(
    (block) => isRecord(block) && isClaudeToolUseBlockType(readStringProp(block, "type")),
  );

export const isSupersededTextOnlyToolUseDraft = (
  messages: ClaudeHistoryMessage[],
  entryIndex: number,
  text: string,
  options: { includeNestedEntries?: boolean },
): boolean => {
  for (let index = entryIndex + 1; index < messages.length; index += 1) {
    const candidate = messages[index];
    if (!candidate) {
      continue;
    }
    if (!options.includeNestedEntries && isNestedHistoryEntry(candidate)) {
      continue;
    }
    if (candidate.type === "user" || candidate.type === "result") {
      return false;
    }
    if (candidate.type !== "assistant") {
      continue;
    }
    if (assistantMessageStopReason(candidate) !== "tool_use") {
      return false;
    }
    if (historyMessageText(candidate.message).trim() !== text) {
      return false;
    }
    const content = isRecord(candidate.message) ? candidate.message.content : undefined;
    return hasToolUseContentBlock(content);
  }
  return false;
};
