import type { RuntimeHealth, RuntimeKind } from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage } from "../../effect/host-errors";
import {
  RuntimeExecutableIncompatibleError,
  type RuntimeExecutableProbesByKind,
} from "../../ports/runtime-executable-probe-port";
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
const RUNTIME_LABELS = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
} satisfies Record<RuntimeKind, string>;

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
      const validatedPath = yield* Effect.either(
        validateExactToolPath(toolDiscovery, kind, executablePath),
      );
      if (validatedPath._tag === "Left") {
        return runtimeHealthFailure(kind, executablePath, errorMessage(validatedPath.left));
      }
      const binary = validatedPath.right.path;
      const [probeResult, versionResult] = yield* Effect.all(
        [
          Effect.either(executableProbes[kind].probeExecutable(binary)),
          Effect.either(
            systemCommands.versionCommand(binary, ["--version"], VERSION_OPTIONS_BY_KIND[kind]),
          ),
        ] as const,
        { concurrency: 2 },
      );
      if (probeResult._tag === "Left") {
        if (probeResult.left instanceof RuntimeExecutableIncompatibleError) {
          return runtimeHealthFailure(
            kind,
            binary,
            `The executable at ${binary} is not a compatible ${RUNTIME_LABELS[kind]} runtime.`,
          );
        }
        return yield* Effect.fail(probeResult.left);
      }
      const version = versionResult._tag === "Right" ? versionResult.right : null;
      return {
        kind,
        enabled: true,
        ok: true,
        executablePath: binary,
        version,
        error: null,
      } satisfies RuntimeHealth;
    });
  },
});
