import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { isClaudeMetaStreamMessage } from "./claude-agent-sdk-local-commands";

/**
 * A resumed interrupted turn is admitted when the CLI starts its hidden continuation turn.
 * The CLI signals that with the synthetic user turn or with a running session state.
 */
export const isClaudeContinuationAdmission = (message: SDKMessage): boolean => {
  if (message.type === "user" && isClaudeMetaStreamMessage(message)) {
    return true;
  }
  return (
    message.type === "system" &&
    message.subtype === "session_state_changed" &&
    message.state === "running"
  );
};
