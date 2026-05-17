import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Effect } from "effect";
import {
  HostDependencyError,
  HostValidationError,
  toHostPathStatError,
} from "../../effect/host-errors";
import { parseJson } from "../../effect/json";
import type { SystemCommandPort } from "../../ports/system-command-port";
import { isExecutableFile, resolveUserPath } from "../runtimes/runtime-binaries";

const MCP_COMMAND_JSON_ENV = "OPENDUCKTOR_MCP_COMMAND_JSON";
const MCP_SIDECAR_PATH_ENV = "OPENDUCKTOR_OPENDUCKTOR_MCP_PATH";
const WORKSPACE_ROOT_ENV = "OPENDUCKTOR_WORKSPACE_ROOT";
export type ResolveOpenDucktorMcpCommandInput = {
  systemCommands: SystemCommandPort;
  env?: NodeJS.ProcessEnv;
  startPath?: string;
};
export const parseMcpCommandJson = (raw: string): string[] => {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) {
    throw new HostValidationError({
      field: MCP_COMMAND_JSON_ENV,
      message: `${MCP_COMMAND_JSON_ENV} must be a JSON string array.`,
    });
  }
  const command = parsed.map((entry) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new HostValidationError({
        field: MCP_COMMAND_JSON_ENV,
        message: `${MCP_COMMAND_JSON_ENV} must contain only non-empty strings.`,
      });
    }
    return entry.trim();
  });
  if (command.length === 0) {
    throw new HostValidationError({
      field: MCP_COMMAND_JSON_ENV,
      message: `${MCP_COMMAND_JSON_ENV} cannot be empty.`,
    });
  }
  return command;
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
const parentPath = (path: string): string | null => {
  const parent = dirname(path);
  return parent === path ? null : parent;
};
const findWorkspaceRoot = (startPath: string) =>
  Effect.gen(function* () {
    let current: string | null = resolve(resolveUserPath(startPath));
    while (current) {
      if (yield* isWorkspaceRootCandidate(current)) {
        return current;
      }
      current = parentPath(current);
    }
    return null;
  });
const resolveWorkspaceRoot = (env: NodeJS.ProcessEnv, startPath: string) =>
  Effect.gen(function* () {
    const override = env[WORKSPACE_ROOT_ENV];
    if (override !== undefined) {
      if (override.trim().length === 0) {
        return yield* Effect.fail(
          new HostValidationError({
            field: WORKSPACE_ROOT_ENV,
            message: `${WORKSPACE_ROOT_ENV} is set but empty.`,
          }),
        );
      }
      const workspaceRoot = resolve(resolveUserPath(override));
      if (!(yield* isWorkspaceRootCandidate(workspaceRoot))) {
        return yield* Effect.fail(
          new HostValidationError({
            field: WORKSPACE_ROOT_ENV,
            message: `${WORKSPACE_ROOT_ENV} does not point to an OpenDucktor workspace root.`,
            details: { workspaceRoot },
          }),
        );
      }
      return workspaceRoot;
    }
    return yield* findWorkspaceRoot(startPath);
  });
const resolveExplicitSidecarCommand = (env: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const sidecarPath = env[MCP_SIDECAR_PATH_ENV];
    if (sidecarPath === undefined) {
      return null;
    }
    if (sidecarPath.trim().length === 0) {
      return yield* Effect.fail(
        new HostValidationError({
          field: MCP_SIDECAR_PATH_ENV,
          message: `${MCP_SIDECAR_PATH_ENV} is set but empty.`,
        }),
      );
    }
    const resolved = resolve(resolveUserPath(sidecarPath));
    if (!(yield* isExecutableFile(resolved))) {
      return yield* Effect.fail(
        new HostValidationError({
          field: MCP_SIDECAR_PATH_ENV,
          message: `${MCP_SIDECAR_PATH_ENV} points to a missing or non-executable file: ${resolved}`,
          details: { resolved },
        }),
      );
    }
    return [resolved];
  });
export const resolveOpenDucktorMcpCommand = ({
  systemCommands,
  env = process.env,
  startPath = process.cwd(),
}: ResolveOpenDucktorMcpCommandInput) =>
  Effect.gen(function* () {
    const rawCommand = env[MCP_COMMAND_JSON_ENV];
    if (rawCommand !== undefined) {
      return yield* Effect.try({
        try: () => parseMcpCommandJson(rawCommand),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
            details: {
              env: MCP_COMMAND_JSON_ENV,
            },
          }),
      });
    }
    const sidecarCommand = yield* resolveExplicitSidecarCommand(env);
    if (sidecarCommand) {
      return sidecarCommand;
    }
    const workspaceRoot = yield* resolveWorkspaceRoot(env, startPath);
    if (!workspaceRoot) {
      return yield* Effect.fail(
        new HostDependencyError({
          dependency: "openducktor-workspace-root",
          operation: "openducktorMcpCommand.resolveOpenDucktorMcpCommand",
          message: `Unable to resolve an OpenDucktor workspace root for MCP execution. Set ${WORKSPACE_ROOT_ENV} or ${MCP_SIDECAR_PATH_ENV}.`,
          details: { startPath },
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
