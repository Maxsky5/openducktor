import { isRecord, readStringProp } from "./claude-agent-sdk-utils";
import type { JsonValue } from "@openducktor/contracts";

export const readClaudeTurnOriginKind = (message: JsonValue | undefined): string | undefined => {
  if (!isRecord(message) || message.shouldQuery === false) {
    return undefined;
  }
  return isRecord(message.origin) ? readStringProp(message.origin, "kind") : undefined;
};

export const shouldFinalizeClaudeTurn = (
  originKind: string | undefined,
  activeBackgroundSubagentTaskCount: number,
): boolean =>
  originKind === undefined ||
  originKind === "human" ||
  (originKind === "task-notification" && activeBackgroundSubagentTaskCount === 0);

export const isClaudeHumanUserMessage = (message: JsonValue | undefined): boolean => {
  if (!isRecord(message) || message.isSynthetic === true || message.shouldQuery === false) {
    return false;
  }
  const originKind = readClaudeTurnOriginKind(message);
  return originKind === undefined || originKind === "human";
};
