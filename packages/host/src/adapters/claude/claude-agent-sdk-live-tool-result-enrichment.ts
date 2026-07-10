import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { isClaudeFileEditTool } from "./claude-agent-sdk-file-edits";
import type { ClaudeTranscriptMirrorStore } from "./claude-agent-sdk-transcript-mirror-store";
import type { ClaudeSession } from "./claude-agent-sdk-types";
import { isRecord, readStringProp } from "./claude-agent-sdk-utils";

type ClaudeUserMessage = Extract<SDKMessage, { type: "user" }>;

const toolUseResultRecord = (value: unknown): Record<string, unknown> | null => {
  if (!isRecord(value)) {
    return null;
  }
  const toolUseResult = value.toolUseResult ?? value.tool_use_result;
  return isRecord(toolUseResult) ? toolUseResult : null;
};

const hasStructuredToolUseResult = (message: ClaudeUserMessage): boolean => {
  return toolUseResultRecord(message) !== null;
};

const isFileEditToolResult = (
  message: ClaudeUserMessage,
  session: Pick<ClaudeSession, "toolNamesByCallId">,
): boolean => {
  const toolUseId = message.parent_tool_use_id;
  if (!toolUseId) {
    return false;
  }
  const tool = session.toolNamesByCallId.get(toolUseId);
  return tool ? isClaudeFileEditTool(tool) : false;
};

export const enrichClaudeLiveUserToolResultFromMirror = ({
  message,
  session,
  transcriptStore,
}: {
  message: ClaudeUserMessage;
  session: Pick<ClaudeSession, "externalSessionId" | "toolNamesByCallId">;
  transcriptStore: ClaudeTranscriptMirrorStore;
}): ClaudeUserMessage => {
  if (hasStructuredToolUseResult(message) || !isFileEditToolResult(message, session)) {
    return message;
  }
  const toolUseId = readStringProp(message, "parent_tool_use_id");
  if (!toolUseId) {
    return message;
  }
  const toolUseResult = transcriptStore.findToolUseResult({
    sessionId: session.externalSessionId,
    toolUseId,
  })?.toolUseResult;
  if (!toolUseResult) {
    return message;
  }

  return {
    ...message,
    toolUseResult,
  } as unknown as ClaudeUserMessage;
};
