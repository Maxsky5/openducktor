import type { AgentToolDenial } from "@openducktor/contracts";
import type { ClaudeToolInput } from "./claude-agent-sdk-types";
import { readStringProp, readText } from "./claude-agent-sdk-utils";

/**
 * A denial that a policy gave without asking the user. `allow` exists only for a main-session
 * auto mode denial, which the user can allow with a consent message.
 */
export type ClaudeToolDenialRecord = {
  readonly denial: AgentToolDenial;
  readonly allow?: { readonly consent: string };
};

/** Records the denial of a call, so every later emission of the call carries it. */
export const recordClaudeToolDenial = (
  session: { readonly toolDenialsByCallId: Map<string, ClaudeToolDenialRecord> },
  callId: string,
  record: ClaudeToolDenialRecord,
): void => {
  session.toolDenialsByCallId.set(callId, record);
};

const withReason = (source: AgentToolDenial["source"], reason?: string): AgentToolDenial => {
  const denial: AgentToolDenial = { source };
  const text = readText(reason);
  if (text) denial.reason = text;
  return denial;
};

/** Maps the `decision_reason_type` of a `permission_denied` message. Other types stay plain. */
export const claudePermissionDeniedDenial = (input: {
  readonly decisionReasonType: string | undefined;
  readonly decisionReason: string | undefined;
  readonly message: string;
}): AgentToolDenial | undefined => {
  const reason = readText(input.decisionReason) ?? input.message;
  switch (input.decisionReasonType) {
    case "classifier":
      return withReason("auto_mode", reason);
    case "rule":
    case "mode":
    case "asyncAgent":
      return withReason("permission_settings", reason);
    default:
      return undefined;
  }
};

/**
 * The tool result that Claude Code 2.1.319 gives the model for an auto mode denial. Its classifier
 * reason is the `decision_reason` of the live `permission_denied` message.
 */
const AUTO_MODE_RESULT =
  /^Permission for this action was denied by the Claude Code auto mode classifier\. Reason: (.+?)\. If you have other tasks/su;

/** Maps the `toolDenialKind` of a transcript tool result. Other kinds stay plain. */
export const claudeHistoryToolDenial = (
  toolDenialKind: string | undefined,
  resultText: string,
): AgentToolDenial | undefined => {
  if (toolDenialKind === "automode-blocked")
    return withReason("auto_mode", AUTO_MODE_RESULT.exec(resultText)?.[1] ?? resultText);
  if (toolDenialKind === "permission-rule") return withReason("permission_settings", resultText);
  return undefined;
};

export const claudeReadOnlyRoleDenial = (message: string): AgentToolDenial =>
  withReason("read_only_role", message);

// Claude Code escapes control, separator, and invisible characters, but keeps plain spaces.
const HIDDEN_CHARACTERS = /(?! )[\p{C}\p{Z}\p{Default_Ignorable_Code_Point}]/gu;
const escapeHiddenCharacters = (value: string): string =>
  Array.from(
    { length: value.length },
    (_, index) => `\\u${value.charCodeAt(index).toString(16).padStart(4, "0")}`,
  ).join("");

const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);

/** Claude Code withholds a call subject longer than this, and then offers no Allow. */
const CALL_SUBJECT_LIMIT = 4096;

/** The tool of the call subject, as Claude Code names it: an MCP tool names its server. */
const callTool = (toolName: string): Record<string, string> => {
  const [prefix, server, ...tool] = toolName.split("__");
  return prefix === "mcp" && server && tool.length > 0
    ? { server, tool: tool.join("__") }
    : { tool: toolName };
};

/**
 * The consent that Claude Code 2.1.319 sends from its "Recently denied" screen, for one call. A
 * shell call names its whole command. Another call names its tool and input as compact JSON, and
 * has no consent when that JSON is too long, because Claude Code then offers no Allow.
 */
export const claudeDeniedActionConsent = (call: {
  readonly toolName: string;
  readonly input: ClaudeToolInput | undefined;
}): string | undefined => {
  const command = SHELL_TOOLS.has(call.toolName)
    ? readStringProp(call.input, "command")
    : undefined;
  const kind = command === undefined ? "call" : "command";
  const subject =
    command ?? JSON.stringify({ ...callTool(call.toolName), input: call.input ?? {} });
  if (command === undefined && subject.length > CALL_SUBJECT_LIMIT) return undefined;
  const quoted = JSON.stringify(subject).replace(HIDDEN_CHARACTERS, escapeHiddenCharacters);
  return `Permission granted for this exact ${kind} only, as one whole string: ${quoted}. This does not approve any other ${kind}, any part of this one, or running it with added options such as turning off the sandbox, extra network access, or running in the background. You may now retry this exact ${kind} if you would like.`;
};

const CONSENT_PATTERN =
  /^Permission granted for this exact (command|call) only, as one whole string: ".*"\. This does not approve any other \1, any part of this one, or running it with added options such as turning off the sandbox, extra network access, or running in the background\. You may now retry this exact \1 if you would like\.$/su;

/**
 * Reports an Allow consent. Claude stores it as a human prompt, because the model ignores a
 * synthetic consent, so history hides it by its exact text.
 */
export const isClaudeDeniedActionConsent = (text: string): boolean => CONSENT_PATTERN.test(text);
