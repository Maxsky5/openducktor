import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { type RuntimeInstanceSummary, runtimeInstanceSummarySchema } from "@openducktor/contracts";
import type {
  RuntimeEnsureWorkspaceInput,
  RuntimeWorkspaceHandle,
  RuntimeWorkspaceStarterPort,
} from "../../ports/runtime-registry-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import { parseMcpCommandJson, resolveOpenDucktorMcpCommand } from "../mcp/openducktor-mcp-command";
import {
  type ProcessTreePlatform,
  type ProcessTreeTerminator,
  shouldStartDetachedProcessGroup,
  terminateProcessTree,
  waitForChildProcessClose,
} from "../process/process-tree";
import { resolveOpencodeBinary } from "../runtimes/runtime-binaries";
import { createSystemCommandLaunch } from "../system/system-command-runner";

export type OpenCodeMcpBridgeConnection = {
  workspaceId: string;
  hostUrl: string;
  hostToken: string;
};

export type OpenCodeMcpBridgeConnectionResolver = (
  input: RuntimeEnsureWorkspaceInput,
) => Promise<OpenCodeMcpBridgeConnection>;

type LocalPortAllocator = () => Promise<number>;

type LocalPortProbe = (port: number, timeoutMs: number) => Promise<boolean>;

export type CreateOpenCodeWorkspaceRuntimeStarterInput = {
  systemCommands: SystemCommandPort;
  resolveMcpBridgeConnection?: OpenCodeMcpBridgeConnectionResolver;
  processEnv?: NodeJS.ProcessEnv;
  mcpCommand?: string[];
  opencodeBinary?: string;
  startupTimeoutMs?: number;
  connectTimeoutMs?: number;
  retryDelayMs?: number;
  stopTimeoutMs?: number;
  now?: () => Date;
  runtimeId?: () => string;
  portAllocator?: LocalPortAllocator;
  portProbe?: LocalPortProbe;
  platform?: ProcessTreePlatform;
  processTreeTerminator?: ProcessTreeTerminator;
};

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 250;
const DEFAULT_RETRY_DELAY_MS = 100;
const DEFAULT_STOP_TIMEOUT_MS = 3_000;
const MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024;

const resolveConfiguredMcpCommand = (
  env: NodeJS.ProcessEnv,
  configuredCommand?: string[],
): string[] | null => {
  if (configuredCommand) {
    const command = configuredCommand.map((entry) => entry.trim());
    if (command.length === 0 || command.some((entry) => entry.length === 0)) {
      throw new Error("OpenCode MCP command must contain only non-empty strings.");
    }
    return command;
  }

  const rawCommand = env.OPENDUCKTOR_MCP_COMMAND_JSON;
  if (rawCommand !== undefined) {
    return parseMcpCommandJson(rawCommand);
  }

  return null;
};

const requireBridgeValue = (value: string, label: keyof OpenCodeMcpBridgeConnection): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`OpenCode MCP bridge ${label} is required.`);
  }
  return trimmed;
};

export const buildOpenCodeConfigContent = (
  bridge: OpenCodeMcpBridgeConnection,
  mcpCommand: string[],
): string =>
  JSON.stringify({
    logLevel: "INFO",
    mcp: {
      openducktor: {
        type: "local",
        enabled: true,
        command: mcpCommand,
        environment: {
          ODT_WORKSPACE_ID: requireBridgeValue(bridge.workspaceId, "workspaceId"),
          ODT_HOST_URL: requireBridgeValue(bridge.hostUrl, "hostUrl"),
          ODT_HOST_TOKEN: requireBridgeValue(bridge.hostToken, "hostToken"),
          ODT_FORBID_WORKSPACE_ID_INPUT: "true",
        },
      },
    },
  });

const pickFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => {
          reject(new Error("Failed to allocate a local OpenCode runtime port."));
        });
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });

const appendCapturedOutput = (current: string, chunk: Buffer): string => {
  const next = current + chunk.toString("utf8");
  if (next.length <= MAX_CAPTURED_OUTPUT_BYTES) {
    return next;
  }
  return next.slice(next.length - MAX_CAPTURED_OUTPUT_BYTES);
};

const outputDetail = (stderr: string, stdout: string, fallback: string): string => {
  const trimmedStderr = stderr.trim();
  if (trimmedStderr) {
    return trimmedStderr;
  }
  const trimmedStdout = stdout.trim();
  return trimmedStdout || fallback;
};

const canConnect = (port: number, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;

    const finish = (connected: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(connected);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, "127.0.0.1");
  });

export const createOpenCodeWorkspaceRuntimeStarter = ({
  systemCommands,
  resolveMcpBridgeConnection,
  processEnv = process.env,
  mcpCommand,
  opencodeBinary,
  startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
  connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
  now = () => new Date(),
  runtimeId = () => randomUUID(),
  portAllocator = pickFreePort,
  portProbe = canConnect,
  platform = process.platform,
  processTreeTerminator = terminateProcessTree,
}: CreateOpenCodeWorkspaceRuntimeStarterInput): RuntimeWorkspaceStarterPort => ({
  async startWorkspaceRuntime(input): Promise<RuntimeWorkspaceHandle> {
    if (input.runtimeKind !== "opencode") {
      throw new Error(
        `OpenCode workspace runtime starter does not support runtime kind ${input.runtimeKind}.`,
      );
    }
    if (!resolveMcpBridgeConnection) {
      throw new Error("OpenCode workspace startup requires an MCP host bridge connection.");
    }

    const bridge = await resolveMcpBridgeConnection(input);
    const resolvedMcpCommand =
      resolveConfiguredMcpCommand(processEnv, mcpCommand) ??
      (await resolveOpenDucktorMcpCommand({ systemCommands, env: processEnv }));
    const configContent = buildOpenCodeConfigContent(bridge, resolvedMcpCommand);
    const binary = opencodeBinary ?? (await resolveOpencodeBinary(systemCommands, processEnv));
    const port = await portAllocator();
    const command = createSystemCommandLaunch(
      binary,
      ["serve", "--hostname", "127.0.0.1", "--port", port.toString()],
      processEnv,
      platform,
    );
    const child = spawn(command.command, command.args, {
      cwd: input.workingDirectory,
      detached: shouldStartDetachedProcessGroup(),
      env: {
        ...processEnv,
        OPENCODE_CONFIG_CONTENT: configContent,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsVerbatimArguments: command.windowsVerbatimArguments === true,
    });
    const pid = child.pid;
    if (!pid || pid <= 0) {
      throw new Error("Failed to start OpenCode runtime: child process has no valid pid.");
    }

    let closed = false;
    let closeDescription: string | null = null;
    let spawnError: Error | null = null;
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendCapturedOutput(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendCapturedOutput(stderr, chunk);
    });
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (exitCode, signal) => {
      closed = true;
      closeDescription =
        signal === null
          ? `process exited with code ${exitCode}`
          : `process exited from signal ${signal}`;
    });

    const deadline = Date.now() + startupTimeoutMs;
    while (Date.now() < deadline) {
      if (spawnError) {
        throw new Error(`Failed to start OpenCode runtime with ${binary}`, { cause: spawnError });
      }
      if (closed) {
        throw new Error(
          `OpenCode process exited before runtime became reachable: ${outputDetail(
            stderr,
            stdout,
            closeDescription ?? "process exited",
          )}`,
        );
      }
      if (await portProbe(port, connectTimeoutMs)) {
        const runtime = runtimeInstanceSummarySchema.parse({
          kind: "opencode",
          runtimeId: runtimeId(),
          repoPath: input.repoPath,
          taskId: null,
          role: "workspace",
          workingDirectory: input.workingDirectory,
          runtimeRoute: {
            type: "local_http",
            endpoint: `http://127.0.0.1:${port}`,
          },
          startedAt: now().toISOString(),
          descriptor: input.descriptor,
        } satisfies RuntimeInstanceSummary);

        return {
          runtime,
          async stop() {
            await processTreeTerminator({
              pid,
              label: `OpenCode runtime ${runtime.runtimeId}`,
              isClosed: () => closed,
              waitForExit: (timeoutMs) => waitForChildProcessClose(child, () => closed, timeoutMs),
              stopTimeoutMs,
            });
          },
        };
      }

      await delay(retryDelayMs);
    }

    const timeoutMessage = `Timed out waiting for OpenCode runtime on 127.0.0.1:${port}.`;
    try {
      await processTreeTerminator({
        pid,
        label: `OpenCode runtime on 127.0.0.1:${port}`,
        isClosed: () => closed,
        waitForExit: (timeoutMs) => waitForChildProcessClose(child, () => closed, timeoutMs),
        stopTimeoutMs,
      });
    } catch (error) {
      const cleanupMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`${timeoutMessage} Cleanup failed: ${cleanupMessage}`, { cause: error });
    }
    throw new Error(timeoutMessage);
  },
});
