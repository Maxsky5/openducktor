import type { SDKMessage, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ClaudeUserToolResultIngress } from "./claude-agent-sdk-ingress-schemas";

const claudeUserTurnSchema = z.looseObject({
  isSynthetic: z.boolean().optional(),
  origin: z.looseObject({ kind: z.string().optional() }).optional(),
  shouldQuery: z.boolean().optional(),
});

type ClaudeUserTurn = Extract<SDKMessage, { type: "result" | "user" }> | SessionStoreEntry;

export const isClaudeWakeUserMessage = (
  message: Extract<SDKMessage, { type: "user" }>,
  parsed: ClaudeUserToolResultIngress,
): boolean =>
  parsed.turnOriginKind !== "human" &&
  message.shouldQuery !== false &&
  parsed.parent_tool_use_id === null &&
  parsed.toolResults.length === 0;

export const readClaudeTurnOriginKind = (message: ClaudeUserTurn): string | undefined => {
  const parsed = claudeUserTurnSchema.safeParse(message);
  if (!parsed.success || parsed.data.shouldQuery === false) {
    return undefined;
  }
  return parsed.data.origin?.kind;
};

export const shouldFinalizeClaudeTurn = (
  originKind: string | undefined,
  activeBackgroundSubagentTaskCount: number,
): boolean =>
  originKind === undefined ||
  originKind === "human" ||
  (originKind === "task-notification" && activeBackgroundSubagentTaskCount === 0);

export const isClaudeHumanUserMessage = (message: ClaudeUserTurn): boolean => {
  const parsed = claudeUserTurnSchema.safeParse(message);
  if (!parsed.success || parsed.data.isSynthetic === true || parsed.data.shouldQuery === false) {
    return false;
  }
  const originKind = readClaudeTurnOriginKind(message);
  return originKind === undefined || originKind === "human";
};
