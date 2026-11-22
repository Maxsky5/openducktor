import { methods, type SessionConfigOption } from "@agentclientprotocol/sdk/unstable";
import { ANTIGRAVITY_RUNTIME_DESCRIPTOR, type AntigravityMode } from "@openducktor/contracts";
import type { AntigravityAgentConnection } from "./antigravity-agent-connection";

/** The ACP config option that holds the session mode of Antigravity. */
const MODE_CONFIG_ID = "mode";

const offeredValues = (option: Extract<SessionConfigOption, { type: "select" }>): string[] =>
  option.options.flatMap((entry) =>
    "options" in entry ? entry.options.map((value) => value.value) : [entry.value],
  );

/**
 * How a session applies its mode setting. A read-only role runs in `default`, so Antigravity asks
 * before each action: the session refuses file edits, and approves the other actions in `auto` and
 * `bypass-permissions`. Another role runs in the native mode, and `bypass-permissions` approves
 * each request that Antigravity still sends.
 */
export const toAntigravitySessionApprovals = (
  mode: AntigravityMode,
  readOnly: boolean,
): { readonly nativeMode: AntigravityMode; readonly approvesRequests: boolean } =>
  readOnly
    ? {
        nativeMode: "default",
        approvesRequests: mode === "auto" || mode === "bypass-permissions",
      }
    : { nativeMode: mode, approvesRequests: mode === "bypass-permissions" };

/**
 * Sets the mode of a native session, which decides what Antigravity approves without asking. It
 * fails when Antigravity lists its config options without the mode, so no session runs with other
 * approvals than the runtime setting gives. A session that reported no config options gets the
 * write, and the answer of Antigravity decides.
 */
export const setAntigravitySessionMode = async (
  connection: AntigravityAgentConnection,
  sessionId: string,
  setting: AntigravityMode,
  configOptions: readonly SessionConfigOption[] | null | undefined,
): Promise<void> => {
  // Antigravity has no mode that asks for nothing. The session approves what `auto` still asks.
  const mode = setting === "bypass-permissions" ? "auto" : setting;
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
