import { methods, type SessionConfigOption } from "@agentclientprotocol/sdk/unstable";
import { ANTIGRAVITY_RUNTIME_DESCRIPTOR, type AntigravityMode } from "@openducktor/contracts";
import type { AntigravityAgentConnection } from "./antigravity-agent-connection";

/** The ACP config option that holds the session mode of Antigravity. */
const MODE_CONFIG_ID = "mode";

const offeredValues = (option: Extract<SessionConfigOption, { type: "select" }>): string[] =>
  option.options.flatMap((entry) =>
    "options" in entry ? entry.options.map((value) => value.value) : [entry.value],
  );

/** The native modes of Antigravity. `bypass-permissions` is an OpenDucktor setting only. */
type AntigravityNativeMode = Exclude<AntigravityMode, "bypass-permissions">;

export type AntigravitySessionApprovals = {
  readonly nativeMode: AntigravityNativeMode;
  /** True when the session approves the permission requests that Antigravity sends. */
  readonly approvesRequests: boolean;
};

/**
 * How a session applies its mode setting. A read-only role runs in `default`, so Antigravity asks
 * before each action: the session refuses file edits, and approves the other actions in `auto` and
 * `bypass-permissions`. Another role runs in the native mode. Antigravity has no mode that asks for
 * nothing, so `bypass-permissions` runs in `auto` and approves each request that `auto` still sends.
 */
export const toAntigravitySessionApprovals = (
  mode: AntigravityMode,
  readOnly: boolean,
): AntigravitySessionApprovals => {
  if (readOnly) {
    return {
      nativeMode: "default",
      approvesRequests: mode === "auto" || mode === "bypass-permissions",
    };
  }
  return mode === "bypass-permissions"
    ? { nativeMode: "auto", approvesRequests: true }
    : { nativeMode: mode, approvesRequests: false };
};

/**
 * Sets the mode of a native session, which decides what Antigravity approves without asking. It
 * fails when Antigravity lists its config options without the mode, so no session runs with other
 * approvals than the runtime setting gives. A session that reported no config options gets the
 * write, and the answer of Antigravity decides.
 */
export const setAntigravitySessionMode = async (
  connection: AntigravityAgentConnection,
  sessionId: string,
  mode: AntigravityNativeMode,
  configOptions: readonly SessionConfigOption[] | null | undefined,
): Promise<void> => {
  const option = configOptions?.find((candidate) => candidate.id === MODE_CONFIG_ID);
  if (configOptions && (option?.type !== "select" || !offeredValues(option).includes(mode))) {
    throw new Error(
      `Antigravity does not offer the session mode '${mode}'. ${ANTIGRAVITY_RUNTIME_DESCRIPTOR.updateAction} Then choose another mode in the Antigravity runtime settings.`,
    );
  }
  if (option?.type === "select" && option.currentValue === mode) return;
  const agent = connection.agent();
  await connection.request(() =>
    agent.request(methods.agent.session.setConfigOption, {
      sessionId,
      configId: MODE_CONFIG_ID,
      value: mode,
    }),
  );
};
