import type {
  HookCallback,
  PermissionMode,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import { findClaudeSubagentSessionByAgentId } from "./claude-agent-sdk-event-session";
import { authorizeClaudeToolUse } from "./claude-agent-sdk-permissions";
import type { ClaudeSessionContext } from "./claude-agent-sdk-types";
import { isRecord } from "./claude-agent-sdk-utils";

const denyToolUse = (message: string) => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse" as const,
    permissionDecision: "deny" as const,
    permissionDecisionReason: message,
  },
});

const acceptsFileEdits = (permissionMode: string, toolName: string): boolean =>
  permissionMode === "acceptEdits" && /^(Edit|MultiEdit|NotebookEdit|Write)$/iu.test(toolName);

export const createClaudePreToolUseHook = ({
  permissionMode,
  session,
}: {
  permissionMode: PermissionMode;
  session: ClaudeSessionContext;
}): HookCallback => {
  return async (input, _toolUseId, { signal }) => {
    if (input.hook_event_name !== "PreToolUse") {
      return {};
    }
    if (signal.aborted) {
      return denyToolUse("Claude tool authorization was aborted.");
    }
    const preToolUseInput = input as PreToolUseHookInput;
    if (!isRecord(preToolUseInput.tool_input)) {
      return denyToolUse(`Tool ${preToolUseInput.tool_name} provided an invalid input payload.`);
    }
    const toolSession = preToolUseInput.agent_id
      ? findClaudeSubagentSessionByAgentId(session, preToolUseInput.agent_id)
      : session;
    if (toolSession) {
      toolSession.toolNamesByCallId.set(preToolUseInput.tool_use_id, preToolUseInput.tool_name);
      toolSession.toolInputsByCallId.set(preToolUseInput.tool_use_id, preToolUseInput.tool_input);
    }
    const authorization = await authorizeClaudeToolUse({
      session,
      toolName: preToolUseInput.tool_name,
      toolInput: preToolUseInput.tool_input,
    });
    if (authorization.behavior === "deny") {
      return denyToolUse(authorization.message);
    }
    const inputChanged = authorization.toolInput !== preToolUseInput.tool_input;
    if (!inputChanged && !authorization.autoApprove) {
      return {};
    }

    const effectivePermissionMode = preToolUseInput.permission_mode ?? permissionMode;
    const autoApprove =
      authorization.autoApprove ||
      effectivePermissionMode === "bypassPermissions" ||
      acceptsFileEdits(effectivePermissionMode, preToolUseInput.tool_name);
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: autoApprove ? "allow" : "ask",
        permissionDecisionReason: inputChanged
          ? "OpenDucktor routed the tool input to the session worktree."
          : "OpenDucktor approved this tool use.",
        ...(inputChanged ? { updatedInput: authorization.toolInput } : {}),
      },
    };
  };
};
