import { claudeUnknownRecordSchema, isRecord, readStringProp } from "./claude-agent-sdk-utils";

export const readClaudeTurnOriginKind = (message: unknown): string | undefined => {
  const parsed = claudeUnknownRecordSchema.safeParse(message);
  if (!parsed.success || parsed.data.shouldQuery === false) {
    return undefined;
  }
  return isRecord(parsed.data.origin) ? readStringProp(parsed.data.origin, "kind") : undefined;
};

export const shouldFinalizeClaudeTurn = (
  originKind: string | undefined,
  activeBackgroundSubagentTaskCount: number,
): boolean =>
  originKind === undefined ||
  originKind === "human" ||
  (originKind === "task-notification" && activeBackgroundSubagentTaskCount === 0);

export const isClaudeHumanUserMessage = (message: unknown): boolean => {
  const parsed = claudeUnknownRecordSchema.safeParse(message);
  if (!parsed.success || parsed.data.isSynthetic === true || parsed.data.shouldQuery === false) {
    return false;
  }
  const originKind = readClaudeTurnOriginKind(parsed.data);
  return originKind === undefined || originKind === "human";
};
