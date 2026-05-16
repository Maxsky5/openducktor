import { type ChildProcessByStdio, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import {
  ODT_WORKFLOW_AGENT_TOOL_NAMES,
  type RuntimeInstanceSummary,
  runtimeInstanceSummarySchema,
} from "@openducktor/contracts";
import type {
  RuntimeWorkspaceHandle,
  RuntimeWorkspaceStarterPort,
} from "../../ports/runtime-registry-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import { parseMcpCommandJson, resolveOpenDucktorMcpCommand } from "../mcp/openducktor-mcp-command";
import {
  type ProcessTreePlatform,
  shouldStartDetachedProcessGroup,
  terminateProcessTree,
  waitForChildProcessClose,
} from "../process/process-tree";
import { resolveCodexBinary } from "../runtimes/runtime-binaries";
import {
  type CodexAppServerEventEmitter,
  createCodexAppServerTransport,
} from "./codex-app-server-transport";
import type { CodexAppServerTransportRegistry } from "./codex-app-server-transport-registry";

type CodexChildProcess = ChildProcessByStdio<Writable, Readable, Readable>;
type ProcessTreeTerminator = typeof terminateProcessTree;

export type CodexMcpBridgeConnection = {
  workspaceId: string;
  hostUrl: string;
  hostToken: string;
};

export type CodexMcpBridgeConnectionResolver = () => Promise<CodexMcpBridgeConnection>;

export type CreateCodexWorkspaceRuntimeStarterInput = {
  systemCommands: SystemCommandPort;
  codexAppServer: CodexAppServerTransportRegistry;
  resolveMcpBridgeConnection?: CodexMcpBridgeConnectionResolver;
  processEnv?: NodeJS.ProcessEnv;
  mcpCommand?: string[];
  codexBinary?: string;
  eventEmitter?: CodexAppServerEventEmitter;
  clientVersion?: string;
  requestTimeoutMs?: number;
  stopTimeoutMs?: number;
  now?: () => Date;
  runtimeId?: () => string;
  platform?: ProcessTreePlatform;
  commandShell?: string;
  processTreeTerminator?: ProcessTreeTerminator;
};

const CODEX_MCP_ENV_VARS = [
  "ODT_WORKSPACE_ID",
  "ODT_HOST_URL",
  "ODT_HOST_TOKEN",
  "ODT_FORBID_WORKSPACE_ID_INPUT",
  "ODT_ALLOWED_TOOLS",
];

const DEFAULT_CODEX_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_STOP_TIMEOUT_MS = 3_000;

const resolveConfiguredMcpCommand = (
  env: NodeJS.ProcessEnv,
  configuredCommand?: string[],
): string[] | null => {
  if (configuredCommand) {
    const command = configuredCommand.map((entry) => entry.trim());
    if (command.length === 0 || command.some((entry) => entry.length === 0)) {
      throw new Error("Codex MCP command must contain only non-empty strings.");
    }
    return command;
  }

  const rawCommand = env.OPENDUCKTOR_MCP_COMMAND_JSON;
  if (rawCommand !== undefined) {
    return parseMcpCommandJson(rawCommand);
  }

  return null;
};

const tomlString = (value: string): string => JSON.stringify(value);

const tomlStringArray = (values: string[]): string =>
  `[${values.map((value) => tomlString(value)).join(", ")}]`;

export const buildCodexMcpConfigArgs = (mcpCommand: string[]): string[] => {
  const [mcpBinary, ...mcpArgs] = mcpCommand;
  if (!mcpBinary) {
    throw new Error("OpenDucktor MCP command cannot be empty.");
  }

  return [
    `mcp_servers.openducktor.command=${tomlString(mcpBinary)}`,
    `mcp_servers.openducktor.args=${tomlStringArray(mcpArgs)}`,
    `mcp_servers.openducktor.env_vars=${tomlStringArray(CODEX_MCP_ENV_VARS)}`,
    "mcp_servers.openducktor.enabled=true",
  ].flatMap((config) => ["--config", config]);
};

const requireBridgeValue = (value: string, label: keyof CodexMcpBridgeConnection): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Codex MCP bridge ${label} is required.`);
  }
  return trimmed;
};

export const codexCommand = (
  binary: string,
  args: string[],
  platform: ProcessTreePlatform = process.platform,
  commandShell = process.env.ComSpec ?? "cmd.exe",
): { file: string; args: string[] } => {
  const lowerBinary = binary.toLowerCase();
  const isWindowsCommandScript =
    platform === "win32" && (lowerBinary.endsWith(".cmd") || lowerBinary.endsWith(".bat"));

  return isWindowsCommandScript
    ? { file: commandShell, args: ["/d", "/c", "call", binary, ...args] }
    : { file: binary, args };
};

const throwCleanupErrors = (errors: string[]): void => {
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
};

export const createCodexWorkspaceRuntimeStarter = ({
  systemCommands,
  codexAppServer,
  resolveMcpBridgeConnection,
  processEnv = process.env,
  mcpCommand,
  codexBinary,
  eventEmitter,
  clientVersion = processEnv.npm_package_version ?? "0.0.0",
  requestTimeoutMs = DEFAULT_CODEX_REQUEST_TIMEOUT_MS,
  stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
  now = () => new Date(),
  runtimeId = () => randomUUID(),
  platform = process.platform,
  commandShell,
  processTreeTerminator = terminateProcessTree,
}: CreateCodexWorkspaceRuntimeStarterInput): RuntimeWorkspaceStarterPort => ({
  async startWorkspaceRuntime(input): Promise<RuntimeWorkspaceHandle> {
    if (input.runtimeKind !== "codex") {
      throw new Error(
        `Codex workspace runtime starter does not support runtime kind ${input.runtimeKind}.`,
      );
    }
    if (!resolveMcpBridgeConnection) {
      throw new Error("Codex workspace startup requires an MCP host bridge connection.");
    }

    const bridge = await resolveMcpBridgeConnection();
    const resolvedMcpCommand =
      resolveConfiguredMcpCommand(processEnv, mcpCommand) ??
      (await resolveOpenDucktorMcpCommand({ systemCommands, env: processEnv }));
    const binary = codexBinary ?? (await resolveCodexBinary(systemCommands, processEnv));
    const command = codexCommand(
      binary,
      [...buildCodexMcpConfigArgs(resolvedMcpCommand), "app-server"],
      platform,
      commandShell,
    );
    const nextRuntimeId = runtimeId();
    const child = spawn(command.file, command.args, {
      cwd: input.workingDirectory,
      detached: shouldStartDetachedProcessGroup(),
      env: {
        ...processEnv,
        ODT_WORKSPACE_ID: requireBridgeValue(bridge.workspaceId, "workspaceId"),
        ODT_HOST_URL: requireBridgeValue(bridge.hostUrl, "hostUrl"),
        ODT_HOST_TOKEN: requireBridgeValue(bridge.hostToken, "hostToken"),
        ODT_FORBID_WORKSPACE_ID_INPUT: "true",
        ODT_ALLOWED_TOOLS: ODT_WORKFLOW_AGENT_TOOL_NAMES.join(","),
      },
      stdio: ["pipe", "pipe", "pipe"],
    }) as CodexChildProcess;
    const pid = child.pid;
    if (!pid || pid <= 0) {
      throw new Error("Failed to start Codex app-server: child process has no valid pid.");
    }

    let closed = false;
    child.once("close", () => {
      closed = true;
    });

    const transport = createCodexAppServerTransport(
      nextRuntimeId,
      child,
      requestTimeoutMs,
      eventEmitter,
    );
    codexAppServer.registerTransport(nextRuntimeId, transport);

    const cleanupCodexRuntime = async (): Promise<void> => {
      const errors: string[] = [];
      codexAppServer.unregisterTransport(nextRuntimeId);
      try {
        await processTreeTerminator({
          pid,
          label: `Codex app-server runtime ${nextRuntimeId}`,
          isClosed: () => closed,
          waitForExit: (timeoutMs) => waitForChildProcessClose(child, () => closed, timeoutMs),
          stopTimeoutMs,
        });
      } catch (error) {
        errors.push(`process tree: ${error instanceof Error ? error.message : String(error)}`);
      }
      try {
        await transport.close();
      } catch (error) {
        errors.push(`transport: ${error instanceof Error ? error.message : String(error)}`);
      }
      throwCleanupErrors(errors);
    };

    try {
      await transport.request({
        method: "initialize",
        params: {
          clientInfo: {
            name: "openducktor",
            title: "OpenDucktor",
            version: clientVersion,
          },
          capabilities: {
            experimentalApi: true,
            optOutNotificationMethods: [],
          },
        },
      });
      await transport.notify("initialized", {});
    } catch (error) {
      try {
        await cleanupCodexRuntime();
      } catch (cleanupError) {
        const startupMessage = error instanceof Error ? error.message : String(error);
        const cleanupMessage =
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        throw new Error(`${startupMessage}\nCleanup failed:\n${cleanupMessage}`, { cause: error });
      }
      throw error;
    }

    const runtime = runtimeInstanceSummarySchema.parse({
      kind: "codex",
      runtimeId: nextRuntimeId,
      repoPath: input.repoPath,
      taskId: null,
      role: "workspace",
      workingDirectory: input.workingDirectory,
      runtimeRoute: {
        type: "stdio",
        identity: nextRuntimeId,
      },
      startedAt: now().toISOString(),
      descriptor: input.descriptor,
    } satisfies RuntimeInstanceSummary);

    return {
      runtime,
      async stop() {
        await cleanupCodexRuntime();
      },
    };
  },
});
