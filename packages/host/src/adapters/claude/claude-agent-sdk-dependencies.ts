import { stat } from "node:fs/promises";
import { Effect } from "effect";
import { HostDependencyError, type HostPathAccessError } from "../../effect/host-errors";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { ToolDiscoveryError, ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { resolveClaudeCodeExecutablePath } from "./claude-code-executable";

export type ClaudeAgentSdkStartupDependencies = {
  executablePath: string;
  version: string;
};

export const validateClaudeAgentSdkStartupDependencies = ({
  systemCommands,
  toolDiscovery,
}: {
  systemCommands: SystemCommandPort;
  toolDiscovery: ToolDiscoveryPort;
}): Effect.Effect<
  ClaudeAgentSdkStartupDependencies,
  HostDependencyError | HostPathAccessError | ToolDiscoveryError
> =>
  Effect.gen(function* () {
    const executablePath = yield* resolveClaudeCodeExecutablePath(toolDiscovery);
    const metadata = yield* Effect.tryPromise({
      try: () => stat(executablePath),
      catch: (cause) =>
        new HostDependencyError({
          dependency: "claude",
          message: `Claude Code executable is not available: ${executablePath}`,
          cause,
          details: { executablePath },
        }),
    });
    if (!metadata.isFile() || metadata.size === 0) {
      return yield* Effect.fail(
        new HostDependencyError({
          dependency: "claude",
          message: `Claude Code executable is invalid: ${executablePath}`,
          details: { executablePath },
        }),
      );
    }
    const version = yield* systemCommands.versionCommand(executablePath, ["--version"], {
      timeoutMs: 2_000,
    });
    if (version === null) {
      return yield* Effect.fail(
        new HostDependencyError({
          dependency: "claude",
          message: `Failed reading Claude Code version from ${executablePath}`,
          details: { executablePath },
        }),
      );
    }
    return {
      executablePath,
      version,
    };
  });
