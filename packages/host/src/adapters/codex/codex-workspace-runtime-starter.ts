import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { type RuntimeInstanceSummary, runtimeInstanceSummarySchema } from "@openducktor/contracts";
import { Cause, Deferred, Effect, Exit, Scope } from "effect";
import { resolveSavedRuntimeExecutableConfig } from "../../application/runtimes/saved-runtime-executable";
import {
  HostOperationError,
  type HostOperationErrorAggregate,
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
} from "../../infrastructure/process/process-tree";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import type {
  RuntimeEnsureWorkspaceInput,
  RuntimeWorkspaceStarterPort,
} from "../../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type { CodexLiveSessionAdapterPreparer } from "../agent-sessions/codex-live-session-adapter";
import { resolveOpenDucktorMcpCommand } from "../mcp/openducktor-mcp-command";
import { buildOpenDucktorMcpBridgeEnvironment } from "../mcp/openducktor-mcp-environment";
import type { HostRuntimeDistribution } from "../runtimes/runtime-distribution";
import { createCodexAppServerTransport } from "./codex-app-server-transport";
import type { CodexAppServerTransportRegistry } from "./codex-app-server-transport-registry";
import { type CodexChildProcess, cleanupCodexRuntime } from "./codex-workspace-runtime-cleanup";
import { buildCodexMcpConfigArgs } from "./codex-workspace-runtime-config";

export type CodexMcpBridgeConnection = {
  workspaceId: string;
  hostUrl: string;
  hostToken: string;
};

export type CodexMcpBridgeConnectionResolver = (
  input: RuntimeEnsureWorkspaceInput,
) => Effect.Effect<CodexMcpBridgeConnection, HostOperationError | HostResourceError>;

export type CreateCodexWorkspaceRuntimeStarterInput = {
  toolDiscovery: ToolDiscoveryPort;
  settingsConfig: SettingsConfigPort;
  codexAppServer: CodexAppServerTransportRegistry;
  liveSessionLifecycle: RuntimeLiveSessionLifecyclePort;
  prepareLiveSessionAdapter: CodexLiveSessionAdapterPreparer;
  onRuntimeFailure: (failure: HostOperationErrorAggregate) => Effect.Effect<void, never>;
  runtimeDistribution: HostRuntimeDistribution;
  resolveMcpBridgeConnection?: CodexMcpBridgeConnectionResolver;
  processEnv?: NodeJS.ProcessEnv;
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

/**
 * Own each Codex child, transport, and live adapter through one cleanup path.
 * Share cleanup across fatal errors, child close, and stop calls so each resource closes once.
 * Share the stop result so callers and the runtime reporter see the same cleanup error.
 */
export const createCodexWorkspaceRuntimeStarter = ({
  toolDiscovery,
  settingsConfig,
  codexAppServer,
  liveSessionLifecycle,
  prepareLiveSessionAdapter,
  onRuntimeFailure,
  resolveMcpBridgeConnection,
  runtimeDistribution,
  processEnv = process.env,
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
    let startupCleanup: Effect.Effect<void, HostOperationErrorAggregate> = Effect.void;
    let fatalError: Error | null = null;
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

      const bridge = yield* resolveMcpBridgeConnection(input).pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "codexWorkspaceRuntime.resolveMcpBridgeConnection"),
        ),
      );
      const resolvedMcpCommand = yield* resolveOpenDucktorMcpCommand({
        runtimeDistribution,
        toolDiscovery,
      });
      const { configuredPath, executablePath: binary } = yield* resolveSavedRuntimeExecutableConfig(
        {
          kind: "codex",
          settingsConfig,
          toolDiscovery,
        },
      );
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
      const preparedLiveSession = yield* prepareLiveSessionAdapter(runtime).pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "codexWorkspaceRuntime.prepareLiveSessionAdapter", {
            runtimeId: nextRuntimeId,
          }),
        ),
      );
      const runtimeScope = yield* Scope.make();
      scope = runtimeScope;
      let adapterRegistered = false;
      let registrationStarted = false;
      const registrationDone = yield* Deferred.make<void>();
      const releaseAdapter = Effect.gen(function* () {
        // Registration decides whether cleanup releases the adapter or discards it.
        if (registrationStarted) yield* Deferred.await(registrationDone);
        yield* (
          adapterRegistered
            ? liveSessionLifecycle.releaseRuntime(nextRuntimeId)
            : preparedLiveSession.discard()
        ).pipe(
          Effect.asVoid,
          Effect.mapError((cause) =>
            toHostOperationError(cause, "codexWorkspaceRuntime.releaseLiveSessionState", {
              runtimeId: nextRuntimeId,
            }),
          ),
        );
      });
      let closed = false;
      let stopping = false;
      let startupComplete = false;
      let cleanupProcess: Effect.Effect<void, HostOperationErrorAggregate> = Effect.void;
      const sharedCleanup = yield* Effect.cached(
        Effect.gen(function* () {
          stopping = true;
          const liveExit = yield* Effect.exit(releaseAdapter);
          const cleanupExit = yield* Effect.exit(cleanupProcess);
          const errors: string[] = [];
          if (Exit.isFailure(liveExit)) {
            errors.push(`live session: ${Cause.pretty(liveExit.cause)}`);
          }
          if (Exit.isFailure(cleanupExit)) {
            errors.push(`runtime: ${Cause.pretty(cleanupExit.cause)}`);
          }
          if (errors.length > 0) {
            return yield* Effect.fail(
              new HostOperationError({
                operation: "codexWorkspaceRuntime.close",
                message: errors.join("\n"),
                cause: { liveExit, cleanupExit },
                details: { runtimeId: nextRuntimeId },
              }),
            );
          }
        }).pipe(Effect.uninterruptible),
      );
      startupCleanup = sharedCleanup;
      const closeRuntime = yield* Effect.cached(
        Effect.gen(function* () {
          const result = yield* Effect.either(sharedCleanup);
          if (result._tag === "Right") return;
          if (fatalError) {
            return yield* Effect.fail(
              new HostOperationError({
                operation: "codexWorkspaceRuntime.transportFailed",
                message: `${fatalError.message}\nCleanup failed:\n${result.left.message}`,
                cause: fatalError,
                details: {
                  runtimeId: nextRuntimeId,
                  cleanupFailure: result.left,
                },
              }),
            );
          }
          return yield* Effect.fail(result.left);
        }).pipe(Effect.uninterruptible),
      );
      yield* Scope.addFinalizer(runtimeScope, sharedCleanup.pipe(Effect.ignore));
      const child = yield* Effect.try({
        try: (): CodexChildProcess =>
          spawn(command.command, command.args, {
            cwd: input.workingDirectory,
            detached: shouldStartDetachedProcessGroup(platform),
            env: command.env,
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: command.windowsHide,
            windowsVerbatimArguments: command.windowsVerbatimArguments,
          }),
        catch: (cause) =>
          toHostOperationError(cause, "codexWorkspaceRuntime.spawn", {
            binary,
            workingDirectory: input.workingDirectory,
          }),
      });
      let closeDescription: string | null = null;
      child.once("close", (exitCode, signal) => {
        closed = true;
        closeDescription =
          signal === null
            ? `process exited with code ${exitCode}`
            : `process exited from signal ${signal}`;
      });

      const transport = createCodexAppServerTransport(
        nextRuntimeId,
        child,
        requestTimeoutMs,
        preparedLiveSession.emitRuntimeEvent,
        (error) => {
          fatalError = error;
          stopping = true;
          Effect.runFork(
            Effect.gen(function* () {
              const result = yield* Effect.either(closeRuntime);
              if (!startupComplete) return;
              const failure =
                result._tag === "Left"
                  ? result.left
                  : toHostOperationError(error, "codexWorkspaceRuntime.transportFailed", {
                      runtimeId: nextRuntimeId,
                    });
              yield* onRuntimeFailure(failure);
            }).pipe(
              Effect.ensuring(
                Scope.close(runtimeScope, Exit.succeed(undefined)).pipe(Effect.ignore),
              ),
            ),
          );
        },
      );
      cleanupProcess = transport.close();
      const pid = child.pid;
      if (!pid || pid <= 0) {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "codexWorkspaceRuntime.startWorkspaceRuntime",
            message: "Failed to start Codex app-server: child process has no valid pid.",
          }),
        );
      }
      cleanupProcess = cleanupCodexRuntime({
        child,
        closed: () => closed,
        codexAppServer,
        nextRuntimeId,
        pid,
        processTreeTerminator,
        stopTimeoutMs,
        transport,
      });
      codexAppServer.registerTransport(nextRuntimeId, transport);

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
      if (closed || stopping) {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "codexWorkspaceRuntime.registerLiveSessionAdapter",
            message: `Codex process exited before its live-session adapter was registered: ${
              closeDescription ?? "process exited"
            }`,
            details: { runtimeId: nextRuntimeId, closeDescription },
          }),
        );
      }
      registrationStarted = true;
      yield* liveSessionLifecycle.registerRuntimeAdapter(preparedLiveSession.adapter).pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "codexWorkspaceRuntime.registerLiveSessionAdapter", {
            runtimeId: nextRuntimeId,
          }),
        ),
        Effect.onExit((exit) =>
          Effect.sync(() => {
            adapterRegistered = Exit.isSuccess(exit);
          }).pipe(Effect.zipRight(Deferred.succeed(registrationDone, undefined))),
        ),
      );
      if (closed || stopping) {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "codexWorkspaceRuntime.registerLiveSessionAdapter",
            message: `Codex process exited while its live-session adapter was being registered: ${
              closeDescription ?? "process exited"
            }`,
            details: { runtimeId: nextRuntimeId, closeDescription },
          }),
        );
      }
      yield* preparedLiveSession.startForwarding().pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "codexWorkspaceRuntime.startLiveSessionForwarding", {
            runtimeId: nextRuntimeId,
          }),
        ),
      );
      if (closed || stopping) {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "codexWorkspaceRuntime.startLiveSessionForwarding",
            message: `Codex process exited while live-session forwarding was starting: ${
              closeDescription ?? "process exited"
            }`,
            details: { runtimeId: nextRuntimeId, closeDescription },
          }),
        );
      }

      startupComplete = true;
      return {
        runtime,
        configuredExecutablePath: configuredPath,
        isAlive() {
          return !closed && !stopping && fatalError === null;
        },
        stop() {
          return closeRuntime.pipe(
            Effect.ensuring(Scope.close(runtimeScope, Exit.succeed(undefined)).pipe(Effect.ignore)),
            Effect.mapError((cause) => toHostOperationError(cause, "codexWorkspaceRuntime.stop")),
          );
        },
      };
    }).pipe(
      Effect.catchAll((failure) =>
        Effect.gen(function* () {
          const cleanup = yield* Effect.either(startupCleanup);
          const firstFailure = fatalError ?? failure;
          if (cleanup._tag === "Left") {
            return yield* Effect.fail(
              new HostOperationError({
                operation: "codexWorkspaceRuntime.startWorkspaceRuntime",
                message: `${firstFailure.message}\nCleanup failed:\n${cleanup.left.message}`,
                cause: firstFailure,
                details: { cleanupFailure: cleanup.left },
              }),
            );
          }
          return yield* Effect.fail(
            fatalError
              ? toHostOperationError(fatalError, "codexWorkspaceRuntime.startWorkspaceRuntime")
              : failure,
          );
        }),
      ),
      Effect.onError(() =>
        scope ? Scope.close(scope, Exit.fail("startup failed")).pipe(Effect.ignore) : Effect.void,
      ),
    );
  },
});
