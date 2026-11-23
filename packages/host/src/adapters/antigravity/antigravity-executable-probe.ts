import { homedir } from "node:os";
import { Effect } from "effect";
import {
  RuntimeExecutableIncompatibleError,
  type RuntimeExecutableProbeError,
  type RuntimeExecutableProbePort,
} from "../../ports/runtime-executable-probe-port";
import { withoutOpenDucktorMcpEnvironment } from "../mcp/openducktor-mcp-environment";
import {
  incompatibleRuntimeExecutableMessage,
  type RuntimeExecutableGuidance,
  runtimeExecutableStartError,
} from "../runtimes/runtime-executable-guidance";
import {
  type AntigravityAcpProcess,
  initializeAntigravityAcp,
  spawnAntigravityAcp,
  stopAntigravityAcp,
} from "./antigravity-acp-process";
import {
  ANTIGRAVITY_MINIMUM_VERSION,
  checkAntigravityAgentContract,
} from "./antigravity-native-contract";

const ANTIGRAVITY_GUIDANCE: RuntimeExecutableGuidance = {
  kind: "antigravity",
  requirement: `OpenDucktor needs Antigravity CLI ${ANTIGRAVITY_MINIMUM_VERSION} or later with the \`agy acp\` command.`,
  update: "run `agy update`",
};

/** The probe answers no session request, because it opens no session. */
const idleHandlers = {
  sessionUpdate: () => undefined,
  requestPermission: async () => ({ outcome: { outcome: "cancelled" as const } }),
  createElicitation: async () => ({ action: "cancel" as const }),
};

/**
 * Initializes an `agy acp` process and checks the contract that OpenDucktor needs. A process that
 * cannot start fails with its output. A version or capability gap fails with the update action.
 */
export const verifyAntigravityAcp = (
  acp: AntigravityAcpProcess,
  executablePath: string,
  clientVersion: string,
): Effect.Effect<void, RuntimeExecutableProbeError> =>
  initializeAntigravityAcp(acp, clientVersion).pipe(
    Effect.mapError((cause) =>
      runtimeExecutableStartError({
        guidance: ANTIGRAVITY_GUIDANCE,
        operation: "antigravityExecutableProbe.initialize",
        executablePath,
        detail: cause.message,
        cause,
      }),
    ),
    Effect.flatMap((result) => {
      const refusal = checkAntigravityAgentContract(result);
      return refusal === null
        ? Effect.void
        : Effect.fail(
            new RuntimeExecutableIncompatibleError({
              message: incompatibleRuntimeExecutableMessage(
                ANTIGRAVITY_GUIDANCE,
                executablePath,
                `does not support OpenDucktor: ${refusal}`,
              ),
            }),
          );
    }),
  );

/** Starts a short-lived `agy acp`, checks it, then stops it. */
export const createAntigravityExecutableProbe = ({
  readEnv,
  clientVersion = "0.0.0",
}: {
  readEnv: () => NodeJS.ProcessEnv;
  clientVersion?: string;
}): RuntimeExecutableProbePort => ({
  probeExecutable: (executablePath) =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        spawnAntigravityAcp({
          executablePath,
          env: withoutOpenDucktorMcpEnvironment(readEnv()),
          cwd: homedir(),
          handlers: idleHandlers,
        }),
      ),
      (acp) => verifyAntigravityAcp(acp, executablePath, clientVersion),
      (acp) => stopAntigravityAcp(acp, "Antigravity executable probe").pipe(Effect.orDie),
    ),
});
