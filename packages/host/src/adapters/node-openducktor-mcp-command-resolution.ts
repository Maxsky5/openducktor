import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { SystemCommandPort } from "../ports/system-command-port";
import { isExecutableFile, resolveUserPath } from "./node-runtime-binary-resolution";

const MCP_COMMAND_JSON_ENV = "OPENDUCKTOR_MCP_COMMAND_JSON";
const MCP_SIDECAR_PATH_ENV = "OPENDUCKTOR_OPENDUCKTOR_MCP_PATH";
const WORKSPACE_ROOT_ENV = "OPENDUCKTOR_WORKSPACE_ROOT";

export type ResolveOpenDucktorMcpCommandInput = {
  systemCommands: SystemCommandPort;
  env?: NodeJS.ProcessEnv;
  startPath?: string;
};

export const parseMcpCommandJson = (raw: string): string[] => {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${MCP_COMMAND_JSON_ENV} must be a JSON string array.`);
  }

  const command = parsed.map((entry) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new Error(`${MCP_COMMAND_JSON_ENV} must contain only non-empty strings.`);
    }
    return entry.trim();
  });

  if (command.length === 0) {
    throw new Error(`${MCP_COMMAND_JSON_ENV} cannot be empty.`);
  }

  return command;
};

const isFile = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
};

const isDirectory = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
};

const isWorkspaceRootCandidate = async (path: string): Promise<boolean> =>
  (await isFile(join(path, "bun.lock"))) &&
  (await isFile(join(path, "package.json"))) &&
  (await isDirectory(join(path, "apps"))) &&
  (await isDirectory(join(path, "packages")));

const parentPath = (path: string): string | null => {
  const parent = dirname(path);
  return parent === path ? null : parent;
};

const findWorkspaceRoot = async (startPath: string): Promise<string | null> => {
  let current: string | null = resolve(resolveUserPath(startPath));
  while (current) {
    if (await isWorkspaceRootCandidate(current)) {
      return current;
    }
    current = parentPath(current);
  }
  return null;
};

const resolveWorkspaceRoot = async (
  env: NodeJS.ProcessEnv,
  startPath: string,
): Promise<string | null> => {
  const override = env[WORKSPACE_ROOT_ENV];
  if (override !== undefined) {
    if (override.trim().length === 0) {
      throw new Error(`${WORKSPACE_ROOT_ENV} is set but empty.`);
    }
    const workspaceRoot = resolve(resolveUserPath(override));
    if (!(await isWorkspaceRootCandidate(workspaceRoot))) {
      throw new Error(`${WORKSPACE_ROOT_ENV} does not point to an OpenDucktor workspace root.`);
    }
    return workspaceRoot;
  }

  return findWorkspaceRoot(startPath);
};

const resolveExplicitSidecarCommand = async (env: NodeJS.ProcessEnv): Promise<string[] | null> => {
  const sidecarPath = env[MCP_SIDECAR_PATH_ENV];
  if (sidecarPath === undefined) {
    return null;
  }
  if (sidecarPath.trim().length === 0) {
    throw new Error(`${MCP_SIDECAR_PATH_ENV} is set but empty.`);
  }

  const resolved = resolve(resolveUserPath(sidecarPath));
  if (!(await isExecutableFile(resolved))) {
    throw new Error(
      `${MCP_SIDECAR_PATH_ENV} points to a missing or non-executable file: ${resolved}`,
    );
  }

  return [resolved];
};

export const resolveOpenDucktorMcpCommand = async ({
  systemCommands,
  env = process.env,
  startPath = process.cwd(),
}: ResolveOpenDucktorMcpCommandInput): Promise<string[]> => {
  const rawCommand = env[MCP_COMMAND_JSON_ENV];
  if (rawCommand !== undefined) {
    return parseMcpCommandJson(rawCommand);
  }

  const sidecarCommand = await resolveExplicitSidecarCommand(env);
  if (sidecarCommand) {
    return sidecarCommand;
  }

  const workspaceRoot = await resolveWorkspaceRoot(env, startPath);
  if (!workspaceRoot) {
    throw new Error(
      `Unable to resolve an OpenDucktor workspace root for MCP execution. Set ${WORKSPACE_ROOT_ENV} or ${MCP_SIDECAR_PATH_ENV}.`,
    );
  }

  const entrypoint = join(workspaceRoot, "packages", "openducktor-mcp", "src", "index.ts");
  if (!(await isFile(entrypoint))) {
    throw new Error(`Missing OpenDucktor MCP entrypoint at ${entrypoint}.`);
  }

  const bunError = await systemCommands.requiredCommandError("bun");
  if (bunError !== null) {
    throw new Error("OpenDucktor MCP workspace execution requires bun on PATH.");
  }

  return ["bun", entrypoint];
};
