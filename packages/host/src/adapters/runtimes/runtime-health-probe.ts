import type { RuntimeHealth, RuntimeKind } from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage } from "../../effect/host-errors";
import type { RuntimeExecutableProbesByKind } from "../../ports/runtime-executable-probe-port";
import type { RuntimeHealthPort } from "../../ports/runtime-health-port";
import type { SystemCommandPort, SystemCommandRunOptions } from "../../ports/system-command-port";
import { type ToolDiscoveryPort, validateExactToolPath } from "../../ports/tool-discovery-port";

const VERSION_TIMEOUT_MS = 2_000;
const OPENCODE_VERSION_OPTIONS: SystemCommandRunOptions = {
  env: { OPENCODE_CONFIG_CONTENT: '{"logLevel":"INFO"}' },
  timeoutMs: VERSION_TIMEOUT_MS,
};
const VERSION_OPTIONS_BY_KIND = {
  claude: { timeoutMs: VERSION_TIMEOUT_MS },
  codex: { timeoutMs: VERSION_TIMEOUT_MS },
  opencode: OPENCODE_VERSION_OPTIONS,
} satisfies Record<RuntimeKind, SystemCommandRunOptions>;

const runtimeHealthFailure = (
  kind: RuntimeKind,
  executablePath: string,
  detail: string,
): RuntimeHealth => ({
  kind,
  enabled: true,
  ok: false,
  executablePath,
  version: null,
  error: detail,
});

export const createRuntimeHealthProbe = (
  systemCommands: SystemCommandPort,
  toolDiscovery: ToolDiscoveryPort,
  executableProbes: RuntimeExecutableProbesByKind,
): RuntimeHealthPort => ({
  getRuntimeHealth(kind, executablePath) {
    return Effect.gen(function* () {
      const health = yield* Effect.either(
        Effect.gen(function* () {
          const binary = (yield* validateExactToolPath(toolDiscovery, kind, executablePath)).path;
          const [, versionResult] = yield* Effect.all(
            [
              executableProbes[kind].probeExecutable(binary),
              Effect.either(
                systemCommands.versionCommand(binary, ["--version"], VERSION_OPTIONS_BY_KIND[kind]),
              ),
            ] as const,
            { concurrency: 2 },
          );
          const version = versionResult._tag === "Right" ? versionResult.right : null;
          return {
            kind,
            enabled: true,
            ok: true,
            executablePath: binary,
            version,
            error: null,
          } satisfies RuntimeHealth;
        }),
      );
      if (health._tag === "Right") {
        return health.right;
      }
      return runtimeHealthFailure(kind, executablePath, errorMessage(health.left));
    });
  },
});
