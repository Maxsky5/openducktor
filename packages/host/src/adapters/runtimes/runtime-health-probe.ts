import type { RuntimeHealth, RuntimeKind } from "@openducktor/contracts";
import type { RuntimeHealthPort } from "../../ports/runtime-health-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import { resolveOpencodeBinary, resolveUserPath } from "./runtime-binaries";

const OPENCODE_VERSION_ENV = {
  OPENCODE_CONFIG_CONTENT: '{"logLevel":"INFO"}',
};

const parseCommandMissingError = (command: string): string =>
  `Required command \`${command}\` not found.`;

const resolveCodexBinary = async (
  systemCommands: SystemCommandPort,
  env: NodeJS.ProcessEnv,
): Promise<string | null> => {
  const overrideBinary = env.OPENDUCKTOR_CODEX_BINARY;
  if (overrideBinary !== undefined) {
    const trimmed = overrideBinary.trim();
    return trimmed.length > 0 ? resolveUserPath(trimmed) : null;
  }

  return (await systemCommands.requiredCommandError("codex")) === null ? "codex" : null;
};

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
      const binary = await resolveCodexBinary(systemCommands, env);
      if (binary === null) {
        return runtimeHealthForMissingCommand(kind, "codex not found in bundled locations or PATH");
      }
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
    }

    const missing = parseCommandMissingError(kind);
    return runtimeHealthForMissingCommand(kind, missing);
  },
});
