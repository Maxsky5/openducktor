import { type ChildProcessByStdio, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, Socket } from "node:net";
import type { Readable } from "node:stream";
import { type RuntimeInstanceSummary, runtimeInstanceSummarySchema } from "@openducktor/contracts";
import { Effect, Schedule } from "effect";
import {
  HostOperationError,
  HostResourceError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type {
  RuntimeEnsureWorkspaceInput,
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
) => Effect.Effect<OpenCodeMcpBridgeConnection, HostOperationError | HostResourceError>;

type LocalPortAllocator = () => Effect.Effect<number, HostOperationError>;

type LocalPortProbe = (
  port: number,
  timeoutMs: number,
) => Effect.Effect<boolean, HostOperationError>;

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

type OpenCodeChildProcess = ChildProcessByStdio<null, Readable, Readable>;

const resolveConfiguredMcpCommand = (
  env: NodeJS.ProcessEnv,
  configuredCommand?: string[],
): string[] | null => {
  if (configuredCommand) {
    const command = configuredCommand.map((entry) => entry.trim());
    if (command.length === 0 || command.some((entry) => entry.length === 0)) {
      throw new HostValidationError({
        message: "OpenCode MCP command must contain only non-empty strings.",
        field: "mcpCommand",
      });
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
    throw new HostValidationError({
      message: `OpenCode MCP bridge ${label} is required.`,
      field: label,
    });
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
          reject(
            new HostResourceError({
              resource: "localPort",
              operation: "opencode.pickFreePort",
              message: "Failed to allocate a local OpenCode runtime port.",
            }),
          );
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

const startupProbeSchedule = (startupTimeoutMs: number, retryDelayMs: number) =>
  Schedule.addDelay(
    Schedule.recurs(Math.max(1, Math.ceil(startupTimeoutMs / Math.max(1, retryDelayMs))) - 1),
    () => `${retryDelayMs} millis`,
  );

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
  portAllocator = () =>
    Effect.tryPromise({
      try: pickFreePort,
      catch: (cause) => toHostOperationError(cause, "opencodeRuntime.pickFreePort"),
    }),
  portProbe = (port, timeoutMs) =>
    Effect.tryPromise({
      try: () => canConnect(port, timeoutMs),
      catch: (cause) =>
        toHostOperationError(cause, "opencodeRuntime.probePort", {
          port,
          timeoutMs,
        }),
    }),
  platform = process.platform,
  processTreeTerminator = terminateProcessTree,
}: CreateOpenCodeWorkspaceRuntimeStarterInput): RuntimeWorkspaceStarterPort => ({
  startWorkspaceRuntime(input) {
    return Effect.gen(function* () {
      if (input.runtimeKind !== "opencode") {
        return yield* Effect.fail(
          new HostValidationError({
            field: "runtimeKind",
            message: `OpenCode workspace runtime starter does not support runtime kind ${input.runtimeKind}.`,
            details: { runtimeKind: input.runtimeKind },
          }),
        );
      }
      if (!resolveMcpBridgeConnection) {
        return yield* Effect.fail(
          new HostResourceError({
            resource: "mcpBridgeConnection",
            operation: "opencodeWorkspaceRuntime.startWorkspaceRuntime",
            message: "OpenCode workspace startup requires an MCP host bridge connection.",
          }),
        );
      }

      const bridge = yield* resolveMcpBridgeConnection(input).pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "opencodeWorkspaceRuntime.resolveMcpBridgeConnection"),
        ),
      );
      const configuredMcpCommand = yield* Effect.try({
        try: () => resolveConfiguredMcpCommand(processEnv, mcpCommand),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
            details: { runtimeKind: input.runtimeKind },
          }),
      });
      const resolvedMcpCommand =
        configuredMcpCommand ??
        (yield* resolveOpenDucktorMcpCommand({ systemCommands, env: processEnv }));
      const configContent = yield* Effect.try({
        try: () => buildOpenCodeConfigContent(bridge, resolvedMcpCommand),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
            details: { runtimeKind: input.runtimeKind },
          }),
      });
      const binary = opencodeBinary ?? (yield* resolveOpencodeBinary(systemCommands, processEnv));
      const port = yield* portAllocator().pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "opencodeWorkspaceRuntime.pickFreePort"),
        ),
      );
      const command = createSystemCommandLaunch(
        binary,
        ["serve", "--hostname", "127.0.0.1", "--port", port.toString()],
        processEnv,
        platform,
      );
      const child = yield* Effect.try({
        try: () =>
          spawn(command.command, command.args, {
            cwd: input.workingDirectory,
            detached: shouldStartDetachedProcessGroup(platform),
            env: {
              ...processEnv,
              OPENCODE_CONFIG_CONTENT: configContent,
            },
            stdio: ["ignore", "pipe", "pipe"],
            windowsVerbatimArguments: command.windowsVerbatimArguments === true,
          }) as OpenCodeChildProcess,
        catch: (cause) =>
          toHostOperationError(cause, "opencodeWorkspaceRuntime.spawn", {
            binary,
            workingDirectory: input.workingDirectory,
          }),
      });
      const pid = child.pid;
      if (!pid || pid <= 0) {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "opencodeWorkspaceRuntime.startWorkspaceRuntime",
            message: "Failed to start OpenCode runtime: child process has no valid pid.",
          }),
        );
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
      child.once("error", (error: Error) => {
        spawnError = error;
      });
      child.once("close", (exitCode, signal) => {
        closed = true;
        closeDescription =
          signal === null
            ? `process exited with code ${exitCode}`
            : `process exited from signal ${signal}`;
      });

      const stopRuntimeProcess = (operation: string) =>
        Effect.tryPromise({
          try: () =>
            processTreeTerminator({
              pid,
              label: `OpenCode runtime on 127.0.0.1:${port}`,
              isClosed: () => closed,
              waitForExit: (timeoutMs) => waitForChildProcessClose(child, () => closed, timeoutMs),
              stopTimeoutMs,
            }),
          catch: (cause) => toHostOperationError(cause, operation),
        });

      const startupProbeDriver = yield* Schedule.driver(
        startupProbeSchedule(startupTimeoutMs, retryDelayMs),
      );
      while (true) {
        if (spawnError) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "opencodeWorkspaceRuntime.startWorkspaceRuntime",
              message: `Failed to start OpenCode runtime with ${binary}`,
              cause: spawnError,
              details: { binary },
            }),
          );
        }
        if (closed) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "opencodeWorkspaceRuntime.startWorkspaceRuntime",
              message: `OpenCode process exited before runtime became reachable: ${outputDetail(
                stderr,
                stdout,
                closeDescription ?? "process exited",
              )}`,
              details: { binary, stdout, stderr, closeDescription },
            }),
          );
        }
        if (
          yield* portProbe(port, connectTimeoutMs).pipe(
            Effect.mapError((cause) =>
              toHostOperationError(cause, "opencodeWorkspaceRuntime.portProbe"),
            ),
          )
        ) {
          const nextRuntimeId = runtimeId();
          const runtime = yield* Effect.try({
            try: () =>
              runtimeInstanceSummarySchema.parse({
                kind: "opencode",
                runtimeId: nextRuntimeId,
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
              } satisfies RuntimeInstanceSummary),
            catch: (cause) =>
              new HostValidationError({
                message: cause instanceof Error ? cause.message : String(cause),
                cause,
                details: { runtimeKind: input.runtimeKind, port },
              }),
          });

          return {
            runtime,
            stop() {
              return stopRuntimeProcess("opencodeWorkspaceRuntime.stop");
            },
          };
        }

        const nextProbe = yield* Effect.either(startupProbeDriver.next(undefined));
        if (nextProbe._tag === "Left") {
          break;
        }
      }

      const cleanupExit = yield* Effect.either(
        stopRuntimeProcess("opencodeWorkspaceRuntime.stopTimedOutProcess"),
      );
      const timeoutMessage = `Timed out waiting for OpenCode runtime on 127.0.0.1:${port}.`;
      if (cleanupExit._tag === "Left") {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "opencodeWorkspaceRuntime.startWorkspaceRuntime",
            message: `${timeoutMessage} Cleanup failed: ${cleanupExit.left.message}`,
            cause: cleanupExit.left,
            details: { port, startupTimeoutMs },
          }),
        );
      }
      return yield* Effect.fail(
        new HostOperationError({
          operation: "opencodeWorkspaceRuntime.startWorkspaceRuntime",
          message: timeoutMessage,
          details: { port, startupTimeoutMs },
        }),
      );
    });
  },
});
