import type { RuntimeHealth, RuntimeKind } from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage } from "../../effect/host-errors";
import type { RuntimeHealthPort } from "../../ports/runtime-health-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { validateClaudeAgentSdkStartupDependencies } from "../claude/claude-agent-sdk-dependencies";
import type { HostRuntimeDistribution } from "./runtime-distribution";

const OPENCODE_VERSION_ENV = {
  OPENCODE_CONFIG_CONTENT: '{"logLevel":"INFO"}',
};
const OPENCODE_VERSION_TIMEOUT_MS = 10_000;

const runtimeHealthForMissingCommand = (kind: RuntimeKind, detail: string): RuntimeHealth => ({
  kind,
  enabled: true,
  ok: false,
  version: null,
  error: detail,
});

type RuntimeHealthProbe = () => Effect.Effect<RuntimeHealth>;
type RuntimeHealthProbesByKind = Record<RuntimeKind, RuntimeHealthProbe>;

const createOpenCodeRuntimeHealthProbe =
  (systemCommands: SystemCommandPort, toolDiscovery: ToolDiscoveryPort): RuntimeHealthProbe =>
  () =>
    Effect.gen(function* () {
      const health = yield* Effect.either(
        Effect.gen(function* () {
          const binary = yield* toolDiscovery.resolveToolPath("opencode");
          const version = yield* systemCommands.versionCommand(binary, ["--version"], {
            env: OPENCODE_VERSION_ENV,
            timeoutMs: OPENCODE_VERSION_TIMEOUT_MS,
          });
          return {
            kind: "opencode",
            enabled: true,
            ok: version !== null,
            version: version === null ? null : `${version} (${binary})`,
            error: version === null ? `Failed reading opencode --version from ${binary}` : null,
          } satisfies RuntimeHealth;
        }),
      );
      if (health._tag === "Right") {
        return health.right;
      }
      return runtimeHealthForMissingCommand("opencode", errorMessage(health.left));
    });

const createCodexRuntimeHealthProbe =
  (systemCommands: SystemCommandPort, toolDiscovery: ToolDiscoveryPort): RuntimeHealthProbe =>
  () =>
    Effect.gen(function* () {
      const health = yield* Effect.either(
        Effect.gen(function* () {
          const binary = yield* toolDiscovery.resolveToolPath("codex");
          const version = yield* systemCommands.versionCommand(binary, ["--version"], {
            timeoutMs: 2_000,
          });
          return {
            kind: "codex",
            enabled: true,
            ok: version !== null,
            version: version === null ? null : `${version} (${binary})`,
            error: version === null ? `Failed reading codex --version from ${binary}` : null,
          } satisfies RuntimeHealth;
        }),
      );
      if (health._tag === "Right") {
        return health.right;
      }
      return runtimeHealthForMissingCommand("codex", errorMessage(health.left));
    });

const createClaudeRuntimeHealthProbe =
  (systemCommands: SystemCommandPort, toolDiscovery: ToolDiscoveryPort): RuntimeHealthProbe =>
  () =>
    Effect.gen(function* () {
      const health = yield* Effect.either(
        Effect.gen(function* () {
          const dependencies = yield* validateClaudeAgentSdkStartupDependencies({
            systemCommands,
            toolDiscovery,
          });
          return {
            kind: "claude",
            enabled: true,
            ok: true,
            version: `${dependencies.version} (${dependencies.executablePath})`,
            error: null,
          } satisfies RuntimeHealth;
        }),
      );
      if (health._tag === "Right") {
        return health.right;
      }
      return runtimeHealthForMissingCommand("claude", errorMessage(health.left));
    });

const createRuntimeHealthProbes = (
  systemCommands: SystemCommandPort,
  toolDiscovery: ToolDiscoveryPort,
): RuntimeHealthProbesByKind =>
  ({
    opencode: createOpenCodeRuntimeHealthProbe(systemCommands, toolDiscovery),
    codex: createCodexRuntimeHealthProbe(systemCommands, toolDiscovery),
    claude: createClaudeRuntimeHealthProbe(systemCommands, toolDiscovery),
  }) satisfies RuntimeHealthProbesByKind;

export const createRuntimeHealthProbe = (
  systemCommands: SystemCommandPort,
  toolDiscovery: ToolDiscoveryPort,
  _runtimeDistribution?: HostRuntimeDistribution,
): RuntimeHealthPort => {
  const probes = createRuntimeHealthProbes(systemCommands, toolDiscovery);
  return {
    getRuntimeHealth(kind) {
      return probes[kind]();
    },
  };
};
