import type { Stats } from "node:fs";
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
import type {
  ArtifactRuntimeDistribution,
  HostRuntimeDistribution,
  SourceRuntimeDistribution,
} from "../runtimes/runtime-distribution";

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
const statPath = (path: string, operation: string) =>
  Effect.tryPromise({
    try: () => stat(path),
    catch: (cause) => toHostPathStatError(cause, operation, path),
  });

const nonFileDescription = (stats: Stats): string =>
  stats.isDirectory() ? "directory" : "non-file path";

const resolveWorkspaceRoot = (runtimeDistribution: SourceRuntimeDistribution) =>
  Effect.gen(function* () {
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
    const stats = yield* statPath(resolvedPath, "openducktorMcpCommand.statExecutable").pipe(
      Effect.catchTag("HostPathNotFoundError", () =>
        Effect.fail(
          new HostValidationError({
            field,
            message: `Runtime artifact distribution MCP launcher points to a missing file: ${resolvedPath}`,
            details: { resolvedPath },
          }),
        ),
      ),
    );
    if (!stats.isFile()) {
      return yield* Effect.fail(
        new HostValidationError({
          field,
          message: `Runtime artifact distribution MCP launcher points to a ${nonFileDescription(
            stats,
          )}, not an executable file: ${resolvedPath}`,
          details: { resolvedPath },
        }),
      );
    }
    if (!(yield* isExecutableFile(resolvedPath))) {
      return yield* Effect.fail(
        new HostValidationError({
          field,
          message: `Runtime artifact distribution MCP launcher points to a non-executable file: ${resolvedPath}`,
          details: { resolvedPath },
        }),
      );
    }
    return resolvedPath;
  });

const resolveRequiredFile = (path: string, field: string) =>
  Effect.gen(function* () {
    const resolvedPath = resolve(resolveUserPath(path));
    const stats = yield* statPath(resolvedPath, "openducktorMcpCommand.statRequiredFile").pipe(
      Effect.catchTag("HostPathNotFoundError", () =>
        Effect.fail(
          new HostValidationError({
            field,
            message: `Runtime artifact distribution MCP launcher requires a missing file: ${resolvedPath}`,
            details: { resolvedPath },
          }),
        ),
      ),
    );
    if (!stats.isFile()) {
      return yield* Effect.fail(
        new HostValidationError({
          field,
          message: `Runtime artifact distribution MCP launcher requires a regular file but received a ${nonFileDescription(
            stats,
          )}: ${resolvedPath}`,
          details: { resolvedPath },
        }),
      );
    }
    return resolvedPath;
  });

const unsupportedArtifactMcpLauncher = (launcher: never) =>
  Effect.fail(
    new HostValidationError({
      field: "runtimeDistribution.mcpLauncher.kind",
      message: `Unsupported runtime artifact MCP launcher kind: ${String(
        (launcher as { kind?: unknown }).kind,
      )}`,
    }),
  );

const resolveArtifactCommand = (runtimeDistribution: ArtifactRuntimeDistribution) =>
  Effect.gen(function* () {
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

    return yield* unsupportedArtifactMcpLauncher(mcpLauncher);
  });

export const resolveOpenDucktorMcpCommand = ({
  systemCommands,
  runtimeDistribution,
}: ResolveOpenDucktorMcpCommandInput) =>
  Effect.gen(function* () {
    if (runtimeDistribution.mode === "artifact") {
      return yield* resolveArtifactCommand(runtimeDistribution);
    }
    const workspaceRoot = yield* resolveWorkspaceRoot(runtimeDistribution);
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
