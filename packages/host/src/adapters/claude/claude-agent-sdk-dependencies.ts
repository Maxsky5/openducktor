import { stat } from "node:fs/promises";
import { Effect } from "effect";
import { HostDependencyError, type HostPathAccessError } from "../../effect/host-errors";
import type { SystemCommandPort } from "../../ports/system-command-port";
import {
  type ToolDiscoveryError,
  type ToolDiscoveryPort,
  validateExactToolPath,
} from "../../ports/tool-discovery-port";

export type ClaudeAgentSdkStartupDependencies = {
  executablePath: string;
  version: string;
};

export const validateClaudeAgentSdkStartupDependencies = ({
  systemCommands,
  toolDiscovery,
  executablePath,
}: {
  systemCommands: SystemCommandPort;
  toolDiscovery: ToolDiscoveryPort;
  executablePath: string;
}): Effect.Effect<
  ClaudeAgentSdkStartupDependencies,
  HostDependencyError | HostPathAccessError | ToolDiscoveryError
> =>
  Effect.gen(function* () {
    const resolvedExecutablePath = (yield* validateExactToolPath(
      toolDiscovery,
      "claude",
      executablePath,
    )).path;
    const metadata = yield* Effect.tryPromise({
      try: () => stat(resolvedExecutablePath),
      catch: (cause) =>
        new HostDependencyError({
          dependency: "claude",
          message: `Claude Code executable is not available: ${resolvedExecutablePath}`,
          cause,
          details: { executablePath: resolvedExecutablePath },
        }),
    });
    if (!metadata.isFile() || metadata.size === 0) {
      return yield* Effect.fail(
        new HostDependencyError({
          dependency: "claude",
          message: `Claude Code executable is invalid: ${resolvedExecutablePath}`,
          details: { executablePath: resolvedExecutablePath },
        }),
      );
    }
    const version = yield* systemCommands.versionCommand(resolvedExecutablePath, ["--version"], {
      timeoutMs: 10_000,
    });
    if (version === null) {
      return yield* Effect.fail(
        new HostDependencyError({
          dependency: "claude",
          message: `Failed reading Claude Code version from ${resolvedExecutablePath}`,
          details: { executablePath: resolvedExecutablePath },
        }),
      );
    }
    return {
      executablePath: resolvedExecutablePath,
      version,
    };
  });
