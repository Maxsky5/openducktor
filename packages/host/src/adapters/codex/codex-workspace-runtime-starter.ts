import { type ChildProcessByStdio, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import { type RuntimeInstanceSummary, runtimeInstanceSummarySchema } from "@openducktor/contracts";
import { Effect, Exit, Scope } from "effect";
import {
  HostOperationError,
  HostResourceError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import { createProcessCommandLaunch } from "../../infrastructure/process/process-command-launch";
import {
  type ProcessTreePlatform,
  type ProcessTreeTerminator,
  shouldStartDetachedProcessGroup,
  terminateProcessTree,
  waitForChildProcessClose,
} from "../../infrastructure/process/process-tree";
import type { RuntimeWorkspaceStarterPort } from "../../ports/runtime-registry-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { resolveOpenDucktorMcpCommand } from "../mcp/openducktor-mcp-command";
import {
  buildOpenDucktorMcpBridgeEnvironment,
  OPENDUCKTOR_MCP_ENV_VAR_NAMES,
} from "../mcp/openducktor-mcp-environment";
import type { HostRuntimeDistribution } from "../runtimes/runtime-distribution";
import { createCodexAppServerTransport } from "./codex-app-server-transport";
import type { CodexAppServerTransportRegistry } from "./codex-app-server-transport-registry";
import type { CodexAppServerEventEmitter } from "./codex-app-server-transport-types";

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
  toolDiscovery: ToolDiscoveryPort;
  codexAppServer: CodexAppServerTransportRegistry;
  runtimeDistribution: HostRuntimeDistribution;
  resolveMcpBridgeConnection?: CodexMcpBridgeConnectionResolver;
  processEnv?: NodeJS.ProcessEnv;
  eventEmitter?: CodexAppServerEventEmitter;
  clientVersion?: string;
  requestTimeoutMs?: number;
  stopTimeoutMs?: number;
  now?: () => Date;
  runtimeId?: () => string;
  platform?: ProcessTreePlatform;
  processTreeTerminator?: ProcessTreeTerminator;
};

const DEFAULT_CODEX_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_STOP_TIMEOUT_MS = 3_000;

const tomlString = (value: string): string => JSON.stringify(value);

const tomlStringArray = (values: readonly string[]): string =>
  `[${values.map((value) => tomlString(value)).join(", ")}]`;
const buildCodexMcpConfigArgs = (mcpCommand: string[]): string[] => {
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
    `mcp_servers.openducktor.env_vars=${tomlStringArray(OPENDUCKTOR_MCP_ENV_VAR_NAMES)}`,
    "mcp_servers.openducktor.enabled=true",
  ].flatMap((config) => ["--config", config]);
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
      processTreeTerminator({
        pid,
        label: `Codex app-server runtime ${nextRuntimeId}`,
        isClosed: closed,
        waitForExit: (timeoutMs) => waitForChildProcessClose(child, closed, timeoutMs),
        stopTimeoutMs,
      }).pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "codexWorkspaceRuntime.stopProcess"),
        ),
      ),
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
  toolDiscovery,
  codexAppServer,
  resolveMcpBridgeConnection,
  runtimeDistribution,
  processEnv = process.env,
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
    let scope: Parameters<typeof Scope.close>[0] | null = null;
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
      const resolvedMcpCommand = yield* resolveOpenDucktorMcpCommand({
        runtimeDistribution,
        toolDiscovery,
      });
      const binary = yield* toolDiscovery.resolveToolPath("codex");
      const runtimeEnv = {
        ...processEnv,
        ...buildOpenDucktorMcpBridgeEnvironment(bridge, "Codex"),
      };
      const command = yield* Effect.try({
        try: () =>
          createProcessCommandLaunch(
            binary,
            [...buildCodexMcpConfigArgs(resolvedMcpCommand), "app-server"],
            runtimeEnv,
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
      const runtimeScope = yield* Scope.make();
      scope = runtimeScope;
      const child = yield* Effect.try({
        try: () =>
          spawn(command.command, command.args, {
            cwd: input.workingDirectory,
            detached: shouldStartDetachedProcessGroup(platform),
            env: command.env,
            stdio: ["pipe", "pipe", "pipe"],
            windowsVerbatimArguments: command.windowsVerbatimArguments,
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
      let released = false;
      const closeRuntime = Effect.gen(function* () {
        if (released) {
          return;
        }
        released = true;
        yield* cleanup;
      });
      yield* Scope.addFinalizer(runtimeScope, closeRuntime.pipe(Effect.ignore));

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
                requestAttestation: false,
                optOutNotificationMethods: [],
              },
            },
          });
          yield* transport.notify({ method: "initialized" });
        }),
      );
      if (initialized._tag === "Left") {
        const cleanupExit = yield* Effect.either(closeRuntime);
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
          return closeRuntime.pipe(
            Effect.zipRight(Scope.close(runtimeScope, Exit.succeed(undefined)).pipe(Effect.ignore)),
            Effect.mapError((cause) => toHostOperationError(cause, "codexWorkspaceRuntime.stop")),
          );
        },
      };
    }).pipe(
      Effect.onError(() =>
        scope ? Scope.close(scope, Exit.fail("startup failed")).pipe(Effect.ignore) : Effect.void,
      ),
    );
  },
});
