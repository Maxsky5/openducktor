import type { RuntimeHealth, RuntimeKind } from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage } from "../../effect/host-errors";
import type { RuntimeExecutableProbesByKind } from "../../ports/runtime-executable-probe-port";
import type { RuntimeHealthPort } from "../../ports/runtime-health-port";
import type { SystemCommandPort, SystemCommandRunOptions } from "../../ports/system-command-port";
import { type ToolDiscoveryPort, validateExactToolPath } from "../../ports/tool-discovery-port";

const VERSION_TIMEOUT_MS = 2_000;
// The runtime CLIs add terminal color to `--version` output when FORCE_COLOR is set. NO_COLOR wins
// over FORCE_COLOR, so the version text stays plain for display.
const VERSION_OPTIONS: SystemCommandRunOptions = {
  env: {
    FORCE_COLOR: "0",
    NO_COLOR: "1",
  },
  timeoutMs: VERSION_TIMEOUT_MS,
};
const runtimeHealth = (
  kind: RuntimeKind,
  executablePath: string,
  version: string | null,
  error: string | null,
): RuntimeHealth => ({
  kind,
  enabled: true,
  ok: error === null,
  executablePath,
  version,
  error,
});

export const createRuntimeHealthProbe = (
  systemCommands: SystemCommandPort,
  toolDiscovery: ToolDiscoveryPort,
  executableProbes: RuntimeExecutableProbesByKind,
): RuntimeHealthPort => {
  // A failed version read only leaves the version unknown. The protocol probe or the runtime
  // start reports whether the executable works.
  const readVersion = (_kind: RuntimeKind, executablePath: string) =>
    systemCommands
      .versionCommand(executablePath, ["--version"], VERSION_OPTIONS)
      .pipe(Effect.orElseSucceed(() => null));
  return {
    readVersion,
    getRuntimeHealth(kind, executablePath) {
      return Effect.gen(function* () {
        const validatedPath = yield* Effect.result(
          validateExactToolPath(toolDiscovery, kind, executablePath),
        );
        if (validatedPath._tag === "Failure") {
          return runtimeHealth(kind, executablePath, null, errorMessage(validatedPath.failure));
        }
        const binary = validatedPath.success.path;
        const [probeResult, version] = yield* Effect.all(
          [
            Effect.result(executableProbes[kind].probeExecutable(binary)),
            readVersion(kind, binary),
          ] as const,
          { concurrency: 2 },
        );
        // Probe failures carry their own guidance. Keep the installed version beside each one.
        return runtimeHealth(
          kind,
          binary,
          version,
          probeResult._tag === "Failure" ? probeResult.failure.message : null,
        );
      });
    },
  };
};
