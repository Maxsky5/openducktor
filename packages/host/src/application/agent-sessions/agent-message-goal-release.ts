import { goalCommandStartsWork } from "@openducktor/core";
import type { AgentSessionSendContent } from "./agent-session-operation-policy";
import { classifySessionMessageSystemCommand } from "./session-message-system-command";

/**
 * A goal command that starts no work, such as `/goal pause`, ends no turn. Its acceptance is then
 * the only signal that the next queued message can go.
 */
export const endsWithoutTurn = (content: AgentSessionSendContent): boolean => {
  const invocation = classifySessionMessageSystemCommand(content.parts);
  return invocation.kind === "goal" && !goalCommandStartsWork(invocation.command);
};
