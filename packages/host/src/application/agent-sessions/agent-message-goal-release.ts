import {
  type AgentUserMessagePart,
  classifySystemSlashCommandInvocation,
  goalCommandStartsWork,
} from "@openducktor/core";
import type { AgentSessionSendContent } from "./agent-session-operation-policy";

/**
 * A goal command that starts no work, such as `/goal pause`, ends no turn. Its acceptance is then
 * the only signal that the next queued message can go.
 */
export const endsWithoutTurn = (content: AgentSessionSendContent): boolean => {
  // SAFETY: Parsed parts never hold an explicit undefined field, which is the only difference
  // between the contract parts and the core parts.
  const invocation = classifySystemSlashCommandInvocation(content.parts as AgentUserMessagePart[]);
  return invocation.kind === "goal" && !goalCommandStartsWork(invocation.command);
};
