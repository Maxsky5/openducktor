import type { AgentSessionHistoryMessage, AgentStreamPart } from "@openducktor/core";
import {
  type CodexTokenUsageTotals,
  type CodexTurnTiming,
  codexTokenUsageHistoryFields,
} from "./codex-app-server-transcript";

const isStopFinishPart = (part: AgentStreamPart): boolean =>
  part.kind === "step" && part.phase === "finish" && part.reason === "stop";

export const applyFinalAssistantTurnMetadata = (
  message: AgentSessionHistoryMessage,
  turnTiming: CodexTurnTiming | null,
  tokenUsage: CodexTokenUsageTotals | null,
): AgentSessionHistoryMessage => {
  if (message.role !== "assistant" || !message.parts.some(isStopFinishPart)) {
    return message;
  }

  const tokenUsageFields = tokenUsage ? codexTokenUsageHistoryFields(tokenUsage) : null;
  return {
    ...message,
    ...(turnTiming ? { durationMs: turnTiming.durationMs } : {}),
    ...(tokenUsageFields ?? {}),
    ...(tokenUsageFields
      ? {
          parts: message.parts.map((part) =>
            isStopFinishPart(part) ? { ...part, ...tokenUsageFields } : part,
          ),
        }
      : {}),
  };
};
