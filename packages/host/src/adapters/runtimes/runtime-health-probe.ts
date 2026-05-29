import type { RuntimeHealth, RuntimeKind } from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage } from "../../effect/host-errors";
import type { RuntimeHealthPort } from "../../ports/runtime-health-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import { resolveCodexBinary, resolveOpencodeBinary } from "./runtime-binaries";
import type { HostRuntimeDistribution } from "./runtime-distribution";

const OPENCODE_VERSION_ENV = {
  OPENCODE_CONFIG_CONTENT: '{"logLevel":"INFO"}',
};

const parseCommandMissingError = (command: string): string =>
  `Required command \`${command}\` not found.`;

const runtimeHealthForMissingCommand = (kind: RuntimeKind, detail: string): RuntimeHealth => ({
  kind,
  enabled: true,
  ok: false,
  version: null,
  error: detail,
});

export const createRuntimeHealthProbe = (
  systemCommands: SystemCommandPort,
  runtimeDistribution: HostRuntimeDistribution,
  env: NodeJS.ProcessEnv = process.env,
): RuntimeHealthPort => ({
  getRuntimeHealth(kind) {
    return Effect.gen(function* () {
      if (kind === "opencode") {
        const health = yield* Effect.either(
          Effect.gen(function* () {
            const binary = yield* resolveOpencodeBinary(systemCommands, env);
            const version = yield* systemCommands.versionCommand(binary, ["--version"], {
              env: OPENCODE_VERSION_ENV,
              timeoutMs: 2_000,
            });
            return {
              kind,
              enabled: true,
              ok: true,
              version: version ? `${version} (${binary})` : `installed (${binary})`,
              error: null,
            } satisfies RuntimeHealth;
          }),
        );
        if (health._tag === "Right") {
          return health.right;
        }
        return runtimeHealthForMissingCommand(kind, errorMessage(health.left));
      }

      if (kind === "codex") {
        const health = yield* Effect.either(
          Effect.gen(function* () {
            const binary = yield* resolveCodexBinary(systemCommands, env, {
              runtimeDistribution,
            });
            const version = yield* systemCommands.versionCommand(binary, ["--version"], {
              timeoutMs: 2_000,
            });
            return {
              kind,
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
        return runtimeHealthForMissingCommand(kind, errorMessage(health.left));
      }

      const missing = parseCommandMissingError(kind);
      return runtimeHealthForMissingCommand(kind, missing);
    });
  },
});
