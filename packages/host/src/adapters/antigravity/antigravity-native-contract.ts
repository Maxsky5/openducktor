import {
  type ClientCapabilities,
  type InitializeResponse,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk/unstable";
import { compareRuntimeVersion } from "@openducktor/core";
import { advertisesAntigravitySystemPrompt, readAcpErrorCode } from "./antigravity-native-payloads";

/** The first Antigravity CLI that OpenDucktor checked: ACP v1 with a client system prompt. */
export const ANTIGRAVITY_MINIMUM_VERSION = "1.5.14";
const ANTIGRAVITY_SIGN_IN_ACTION =
  "Sign in with the Antigravity CLI: run `agy` in a terminal and follow the sign-in steps, then try again.";

/** ACP error code of an agent that needs a sign-in. */
const ACP_AUTH_REQUIRED_CODE = -32000;

/** OpenDucktor reads and writes files and runs commands through the native Antigravity tools. */
export const ANTIGRAVITY_CLIENT_CAPABILITIES: ClientCapabilities = {
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
  elicitation: { form: {} },
};

/**
 * Checks the `initialize` result. OpenDucktor needs ACP v1, the version, `session/load`, `session/list`,
 * `session/close`, and the system prompt extension that applies the role instructions.
 * Returns the reason when the runtime cannot serve OpenDucktor, or `null` when it can.
 */
export const checkAntigravityAgentContract = (result: InitializeResponse): string | null => {
  if (result.protocolVersion !== PROTOCOL_VERSION) {
    return `Antigravity answered with ACP protocol version ${result.protocolVersion}, and OpenDucktor needs version ${PROTOCOL_VERSION}.`;
  }
  const version = result.agentInfo?.version ?? null;
  const comparison = compareRuntimeVersion(version, ANTIGRAVITY_MINIMUM_VERSION);
  if (comparison === null) {
    return `OpenDucktor needs Antigravity CLI ${ANTIGRAVITY_MINIMUM_VERSION} or later, and the runtime reported no version.`;
  }
  if (!comparison.supported) {
    return `OpenDucktor needs Antigravity CLI ${ANTIGRAVITY_MINIMUM_VERSION} or later. Version ${comparison.version} is installed.`;
  }
  const capabilities = result.agentCapabilities;
  const sessionCapabilities = capabilities?.sessionCapabilities;
  const missing: string[] = [];
  if (capabilities?.loadSession !== true) missing.push("session/load");
  if (!sessionCapabilities?.list) missing.push("session/list");
  if (!sessionCapabilities?.close) missing.push("session/close");
  if (!advertisesAntigravitySystemPrompt(capabilities)) missing.push("the system prompt extension");
  if (missing.length > 0) {
    return `Antigravity CLI ${comparison.version} does not support ${missing.join(", ")}.`;
  }
  return null;
};

/** The `_meta` that appends the role or workspace instructions to the native system prompt. */
export const antigravitySystemPromptMeta = (systemPrompt: string) => ({
  antigravity: { systemPrompt: { append: systemPrompt } },
});

/** The message of a failed ACP request, with the sign-in action when the runtime needs one. */
export const describeAntigravityRequestError = (cause: unknown): string =>
  readAcpErrorCode(cause) === ACP_AUTH_REQUIRED_CODE
    ? `Antigravity needs a sign-in. ${ANTIGRAVITY_SIGN_IN_ACTION}`
    : cause instanceof Error
      ? cause.message
      : String(cause);
