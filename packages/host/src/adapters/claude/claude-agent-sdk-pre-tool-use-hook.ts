import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { findClaudeSubagentSessionByAgentId } from "./claude-agent-sdk-event-session";
import { parseClaudePreToolUseIngress } from "./claude-agent-sdk-ingress-schemas";
import { authorizeClaudeToolUse } from "./claude-agent-sdk-permissions";
import type { ClaudeSessionContext } from "./claude-agent-sdk-types";

const denyToolUse = (message: string) => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse" as const,
    permissionDecision: "deny" as const,
    permissionDecisionReason: message,
  },
});

export const createClaudePreToolUseHook = ({
  session,
}: {
  session: ClaudeSessionContext;
}): HookCallback => {
  return async (input, _toolUseId, { signal }) => {
    const preToolUseInput = parseClaudePreToolUseIngress(input);
    if (signal.aborted) {
      return denyToolUse("Claude tool authorization was aborted.");
    }
    const toolInput = preToolUseInput.tool_input;
    const toolSession = preToolUseInput.agent_id
      ? findClaudeSubagentSessionByAgentId(session, preToolUseInput.agent_id)
      : session;
    if (toolSession) {
      toolSession.toolNamesByCallId.set(preToolUseInput.tool_use_id, preToolUseInput.tool_name);
      toolSession.toolInputsByCallId.set(preToolUseInput.tool_use_id, toolInput);
    }
    const authorization = await authorizeClaudeToolUse({
      session,
      toolName: preToolUseInput.tool_name,
      toolInput,
    });
    if (authorization.behavior === "deny") {
      return denyToolUse(authorization.message);
    }
    const inputChanged = authorization.toolInput !== toolInput;
    if (authorization.approval === "workflow_role") {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "OpenDucktor auto-approved this tool for the workflow role.",
          ...(() => {
            if (inputChanged) {
              return { updatedInput: authorization.toolInput };
            }
            return {};
          })(),
        },
      };
    }
    if (!inputChanged) {
      return {};
    }
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecisionReason: "OpenDucktor routed the tool input to the session worktree.",
        updatedInput: authorization.toolInput,
      },
    };
  };
};
