import type { RuntimeHealth, RuntimeKind } from "@openducktor/contracts";
import type { RuntimeHealthPort } from "../../ports/runtime-health-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import { resolveCodexBinary, resolveOpencodeBinary } from "./runtime-binaries";

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
  env: NodeJS.ProcessEnv = process.env,
): RuntimeHealthPort => ({
  async getRuntimeHealth(kind) {
    if (kind === "opencode") {
      try {
        const binary = await resolveOpencodeBinary(systemCommands, env);
        const version = await systemCommands.versionCommand(binary, ["--version"], {
          env: OPENCODE_VERSION_ENV,
          timeoutMs: 2_000,
        });
        return {
          kind,
          enabled: true,
          ok: true,
          version: version ? `${version} (${binary})` : `installed (${binary})`,
          error: null,
        };
      } catch (error) {
        return runtimeHealthForMissingCommand(
          kind,
          String(error instanceof Error ? error.message : error),
        );
      }
    }

    if (kind === "codex") {
      try {
        const binary = await resolveCodexBinary(systemCommands, env);
        const version = await systemCommands.versionCommand(binary, ["--version"], {
          timeoutMs: 2_000,
        });
        return {
          kind,
          enabled: true,
          ok: version !== null,
          version: version === null ? null : `${version} (${binary})`,
          error: version === null ? `Failed reading codex --version from ${binary}` : null,
        };
      } catch (error) {
        return runtimeHealthForMissingCommand(
          kind,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    const missing = parseCommandMissingError(kind);
    return runtimeHealthForMissingCommand(kind, missing);
  },
});
