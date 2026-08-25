import { isUnknownRecord } from "@openducktor/core";
import { readStringProp } from "./claude-agent-sdk-utils";

export const readClaudeTurnOriginKind = (message: unknown): string | undefined => {
  if (!isUnknownRecord(message) || message.shouldQuery === false) {
    return undefined;
  }
  return isUnknownRecord(message.origin) ? readStringProp(message.origin, "kind") : undefined;
};

export const shouldFinalizeClaudeTurn = (
  originKind: string | undefined,
  activeBackgroundSubagentTaskCount: number,
): boolean =>
  originKind === undefined ||
  originKind === "human" ||
  (originKind === "task-notification" && activeBackgroundSubagentTaskCount === 0);

export const isClaudeHumanUserMessage = (message: unknown): boolean => {
  if (!isUnknownRecord(message) || message.isSynthetic === true || message.shouldQuery === false) {
    return false;
  }
  const originKind = readClaudeTurnOriginKind(message);
  return originKind === undefined || originKind === "human";
};
