import { type ChildProcessByStdio, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import {
  ODT_WORKFLOW_AGENT_TOOL_NAMES,
  type RuntimeInstanceSummary,
  runtimeInstanceSummarySchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  HostOperationError,
  HostResourceError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type { RuntimeWorkspaceStarterPort } from "../../ports/runtime-registry-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import { parseMcpCommandJson, resolveOpenDucktorMcpCommand } from "../mcp/openducktor-mcp-command";
import {
  type ProcessTreePlatform,
  type ProcessTreeTerminator,
  shouldStartDetachedProcessGroup,
  terminateProcessTree,
  waitForChildProcessClose,
} from "../process/process-tree";
import { resolveCodexBinary } from "../runtimes/runtime-binaries";
import { createSystemCommandLaunch } from "../system/system-command-runner";
import {
  type CodexAppServerEventEmitter,
  createCodexAppServerTransport,
} from "./codex-app-server-transport";
import type { CodexAppServerTransportRegistry } from "./codex-app-server-transport-registry";

type CodexChildProcess = ChildProcessByStdio<Writable, Readable, Readable>;

export type CodexMcpBridgeConnection = {
  workspaceId: string;
  hostUrl: string;
  hostToken: string;
};

export type CodexMcpBridgeConnectionResolver = () => Effect.Effect<
  CodexMcpBridgeConnection,
  HostOperationError | HostResourceError
>;

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
      throw new HostValidationError({
        message: "Codex MCP command must contain only non-empty strings.",
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

const tomlString = (value: string): string => JSON.stringify(value);

const tomlStringArray = (values: string[]): string =>
  `[${values.map((value) => tomlString(value)).join(", ")}]`;

export const buildCodexMcpConfigArgs = (mcpCommand: string[]): string[] => {
  const [mcpBinary, ...mcpArgs] = mcpCommand;
  if (!mcpBinary) {
    throw new HostValidationError({
      message: "OpenDucktor MCP command cannot be empty.",
      field: "mcpCommand",
    });
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
    throw new HostValidationError({
      message: `Codex MCP bridge ${label} is required.`,
      field: label,
    });
  }
  return trimmed;
};

const cleanupCodexRuntime = ({
  child,
  closed,
  codexAppServer,
  nextRuntimeId,
  pid,
  processTreeTerminator,
  stopTimeoutMs,
  transport,
}: {
  child: CodexChildProcess;
  closed: () => boolean;
  codexAppServer: CodexAppServerTransportRegistry;
  nextRuntimeId: string;
  pid: number;
  processTreeTerminator: ProcessTreeTerminator;
  stopTimeoutMs: number;
  transport: ReturnType<typeof createCodexAppServerTransport>;
}) =>
  Effect.gen(function* () {
    const errors: string[] = [];
    codexAppServer.unregisterTransport(nextRuntimeId);

    const processExit = yield* Effect.either(
      Effect.tryPromise({
        try: () =>
          processTreeTerminator({
            pid,
            label: `Codex app-server runtime ${nextRuntimeId}`,
            isClosed: closed,
            waitForExit: (timeoutMs) => waitForChildProcessClose(child, closed, timeoutMs),
            stopTimeoutMs,
          }),
        catch: (cause) => toHostOperationError(cause, "codexWorkspaceRuntime.stopProcess"),
      }),
    );
    if (processExit._tag === "Left") {
      errors.push(`process tree: ${processExit.left.message}`);
    }

    yield* transport.close();

    if (errors.length > 0) {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "codexWorkspaceRuntime.cleanup",
          message: errors.join("\n"),
          details: { runtimeId: nextRuntimeId },
        }),
      );
    }
  });

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
  processTreeTerminator = terminateProcessTree,
}: CreateCodexWorkspaceRuntimeStarterInput): RuntimeWorkspaceStarterPort => ({
  startWorkspaceRuntime(input) {
    return Effect.gen(function* () {
      if (input.runtimeKind !== "codex") {
        return yield* Effect.fail(
          new HostValidationError({
            field: "runtimeKind",
            message: `Codex workspace runtime starter does not support runtime kind ${input.runtimeKind}.`,
            details: { runtimeKind: input.runtimeKind },
          }),
        );
      }
      if (!resolveMcpBridgeConnection) {
        return yield* Effect.fail(
          new HostResourceError({
            resource: "mcpBridgeConnection",
            operation: "codexWorkspaceRuntime.startWorkspaceRuntime",
            message: "Codex workspace startup requires an MCP host bridge connection.",
          }),
        );
      }

      const bridge = yield* resolveMcpBridgeConnection().pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "codexWorkspaceRuntime.resolveMcpBridgeConnection"),
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
      const binary = codexBinary ?? (yield* resolveCodexBinary(systemCommands, processEnv));
      const command = yield* Effect.try({
        try: () =>
          createSystemCommandLaunch(
            binary,
            [...buildCodexMcpConfigArgs(resolvedMcpCommand), "app-server"],
            processEnv,
            platform,
          ),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
            details: { binary, runtimeKind: input.runtimeKind },
          }),
      });
      const nextRuntimeId = runtimeId();
      const child = yield* Effect.try({
        try: () =>
          spawn(command.command, command.args, {
            cwd: input.workingDirectory,
            detached: shouldStartDetachedProcessGroup(platform),
            env: {
              ...processEnv,
              ODT_WORKSPACE_ID: requireBridgeValue(bridge.workspaceId, "workspaceId"),
              ODT_HOST_URL: requireBridgeValue(bridge.hostUrl, "hostUrl"),
              ODT_HOST_TOKEN: requireBridgeValue(bridge.hostToken, "hostToken"),
              ODT_FORBID_WORKSPACE_ID_INPUT: "true",
              ODT_ALLOWED_TOOLS: ODT_WORKFLOW_AGENT_TOOL_NAMES.join(","),
            },
            stdio: ["pipe", "pipe", "pipe"],
            windowsVerbatimArguments: command.windowsVerbatimArguments === true,
          }) as CodexChildProcess,
        catch: (cause) =>
          toHostOperationError(cause, "codexWorkspaceRuntime.spawn", {
            binary,
            workingDirectory: input.workingDirectory,
          }),
      });
      const pid = child.pid;
      if (!pid || pid <= 0) {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "codexWorkspaceRuntime.startWorkspaceRuntime",
            message: "Failed to start Codex app-server: child process has no valid pid.",
          }),
        );
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

      const cleanup = cleanupCodexRuntime({
        child,
        closed: () => closed,
        codexAppServer,
        nextRuntimeId,
        pid,
        processTreeTerminator,
        stopTimeoutMs,
        transport,
      });

      const initialized = yield* Effect.either(
        Effect.gen(function* () {
          yield* transport.request({
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
          yield* transport.notify("initialized", {});
        }),
      );
      if (initialized._tag === "Left") {
        const cleanupExit = yield* Effect.either(cleanup);
        if (cleanupExit._tag === "Left") {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "codexWorkspaceRuntime.initialize",
              message: `${initialized.left.message}\nCleanup failed:\n${cleanupExit.left.message}`,
              cause: initialized.left,
              details: { runtimeId: nextRuntimeId },
            }),
          );
        }
        return yield* Effect.fail(initialized.left);
      }

      const runtime = yield* Effect.try({
        try: () =>
          runtimeInstanceSummarySchema.parse({
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
          } satisfies RuntimeInstanceSummary),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
            details: { runtimeKind: input.runtimeKind, runtimeId: nextRuntimeId },
          }),
      });

      return {
        runtime,
        stop() {
          return cleanup;
        },
      };
    });
  },
});
