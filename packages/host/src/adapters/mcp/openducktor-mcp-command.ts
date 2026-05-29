import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import {
  HostDependencyError,
  HostValidationError,
  toHostPathStatError,
} from "../../effect/host-errors";
import type { SystemCommandPort } from "../../ports/system-command-port";
import { isExecutableFile, resolveUserPath } from "../runtimes/runtime-binaries";
import type { HostRuntimeDistribution } from "../runtimes/runtime-distribution";

export type ResolveOpenDucktorMcpCommandInput = {
  systemCommands: SystemCommandPort;
  runtimeDistribution: HostRuntimeDistribution;
};
const isFile = (path: string) =>
  Effect.tryPromise({
    try: () => stat(path),
    catch: (cause) => toHostPathStatError(cause, "openducktorMcpCommand.statFile", path),
  }).pipe(
    Effect.map((stats) => stats.isFile()),
    Effect.catchTag("HostPathNotFoundError", () => Effect.succeed(false)),
  );
const isDirectory = (path: string) =>
  Effect.tryPromise({
    try: () => stat(path),
    catch: (cause) => toHostPathStatError(cause, "openducktorMcpCommand.statDirectory", path),
  }).pipe(
    Effect.map((stats) => stats.isDirectory()),
    Effect.catchTag("HostPathNotFoundError", () => Effect.succeed(false)),
  );
const isWorkspaceRootCandidate = (path: string) =>
  Effect.gen(function* () {
    return (
      (yield* isFile(join(path, "bun.lock"))) &&
      (yield* isFile(join(path, "package.json"))) &&
      (yield* isDirectory(join(path, "apps"))) &&
      (yield* isDirectory(join(path, "packages")))
    );
  });
const resolveWorkspaceRoot = (runtimeDistribution: HostRuntimeDistribution) =>
  Effect.gen(function* () {
    if (runtimeDistribution.mode !== "source") {
      return null;
    }

    const workspaceRoot = resolve(resolveUserPath(runtimeDistribution.workspaceRoot));
    if (!(yield* isWorkspaceRootCandidate(workspaceRoot))) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "runtimeDistribution.workspaceRoot",
          message: "Runtime source distribution does not point to an OpenDucktor workspace root.",
          details: { workspaceRoot },
        }),
      );
    }
    return workspaceRoot;
  });

const resolveExecutablePath = (path: string, field: string) =>
  Effect.gen(function* () {
    const resolvedPath = resolve(resolveUserPath(path));
    if (!(yield* isExecutableFile(resolvedPath))) {
      return yield* Effect.fail(
        new HostValidationError({
          field,
          message: `Runtime artifact distribution MCP launcher points to a missing or non-executable file: ${resolvedPath}`,
          details: { resolvedPath },
        }),
      );
    }
    return resolvedPath;
  });

const resolveRequiredFile = (path: string, field: string) =>
  Effect.gen(function* () {
    const resolvedPath = resolve(resolveUserPath(path));
    if (!(yield* isFile(resolvedPath))) {
      return yield* Effect.fail(
        new HostValidationError({
          field,
          message: `Runtime artifact distribution MCP launcher requires a missing file: ${resolvedPath}`,
          details: { resolvedPath },
        }),
      );
    }
    return resolvedPath;
  });

const resolveArtifactCommand = (runtimeDistribution: HostRuntimeDistribution) =>
  Effect.gen(function* () {
    if (runtimeDistribution.mode !== "artifact") {
      return null;
    }

    const { mcpLauncher } = runtimeDistribution;
    switch (mcpLauncher.kind) {
      case "executable":
        return [
          yield* resolveExecutablePath(
            mcpLauncher.executablePath,
            "runtimeDistribution.mcpLauncher.executablePath",
          ),
        ];
      case "bunScript": {
        const bunExecutable = yield* resolveExecutablePath(
          mcpLauncher.bunExecutablePath,
          "runtimeDistribution.mcpLauncher.bunExecutablePath",
        );
        const scriptPath = yield* resolveRequiredFile(
          mcpLauncher.scriptPath,
          "runtimeDistribution.mcpLauncher.scriptPath",
        );
        return [bunExecutable, scriptPath];
      }
    }

    const exhaustive: never = mcpLauncher;
    return exhaustive;
  });

export const resolveOpenDucktorMcpCommand = ({
  systemCommands,
  runtimeDistribution,
}: ResolveOpenDucktorMcpCommandInput) =>
  Effect.gen(function* () {
    const artifactCommand = yield* resolveArtifactCommand(runtimeDistribution);
    if (artifactCommand !== null) {
      return artifactCommand;
    }
    const workspaceRoot = yield* resolveWorkspaceRoot(runtimeDistribution);
    if (!workspaceRoot) {
      return yield* Effect.fail(
        new HostDependencyError({
          dependency: "openducktor-workspace-root",
          operation: "openducktorMcpCommand.resolveOpenDucktorMcpCommand",
          message:
            "Unable to resolve an OpenDucktor workspace root for MCP execution. Provide a source runtime distribution.",
        }),
      );
    }
    const entrypoint = join(workspaceRoot, "packages", "openducktor-mcp", "src", "index.ts");
    if (!(yield* isFile(entrypoint))) {
      return yield* Effect.fail(
        new HostDependencyError({
          dependency: "openducktor-mcp",
          operation: "openducktorMcpCommand.resolveOpenDucktorMcpCommand",
          message: `Missing OpenDucktor MCP entrypoint at ${entrypoint}.`,
          details: { entrypoint },
        }),
      );
    }
    const bunError = yield* systemCommands.requiredCommandError("bun");
    if (bunError !== null) {
      return yield* Effect.fail(
        new HostDependencyError({
          dependency: "bun",
          operation: "openducktorMcpCommand.resolveOpenDucktorMcpCommand",
          message: "OpenDucktor MCP workspace execution requires bun on PATH.",
          details: { requiredCommandError: bunError },
        }),
      );
    }
    return ["bun", entrypoint];
  });
