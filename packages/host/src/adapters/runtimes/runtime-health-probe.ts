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
import { incompatibleRuntimeExecutableMessage } from "./runtime-executable-guidance";

const VERSION_TIMEOUT_MS = 2_000;
const OPENCODE_VERSION_OPTIONS: SystemCommandRunOptions = {
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
  version: string | null,
  detail: string,
): RuntimeHealth => ({
  kind,
  enabled: true,
  ok: false,
  executablePath,
  version,
  error: detail,
});

export const createRuntimeHealthProbe = (
  systemCommands: SystemCommandPort,
  toolDiscovery: ToolDiscoveryPort,
  executableProbes: RuntimeExecutableProbesByKind,
): RuntimeHealthPort => {
  // A failed version read only leaves the version unknown. The protocol probe or the runtime
  // start reports whether the executable works.
  const readVersion = (kind: RuntimeKind, executablePath: string) =>
    systemCommands
      .versionCommand(executablePath, ["--version"], VERSION_OPTIONS_BY_KIND[kind])
      .pipe(Effect.orElseSucceed(() => null));
  return {
    readVersion,
    getRuntimeHealth(kind, executablePath) {
      return Effect.gen(function* () {
        const validatedPath = yield* Effect.result(
          validateExactToolPath(toolDiscovery, kind, executablePath),
        );
        if (validatedPath._tag === "Failure") {
          return runtimeHealthFailure(
            kind,
            executablePath,
            null,
            errorMessage(validatedPath.failure),
          );
        }
        const binary = validatedPath.success.path;
        const [probeResult, version] = yield* Effect.all(
          [
            Effect.result(executableProbes[kind].probeExecutable(binary)),
            readVersion(kind, binary),
          ] as const,
          { concurrency: 2 },
        );
        if (probeResult._tag === "Failure") {
          // Keep the version that the user has installed beside every probe failure.
          const failure = probeResult.failure;
          return runtimeHealthFailure(
            kind,
            binary,
            version,
            failure instanceof RuntimeExecutableIncompatibleError
              ? incompatibleRuntimeExecutableMessage(kind, binary)
              : failure.message,
          );
        }
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
  };
};
