import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { type RuntimeInstanceSummary, runtimeInstanceSummarySchema } from "@openducktor/contracts";
import { Cause, Effect, Exit, Scope } from "effect";
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
} from "../../infrastructure/process/process-tree";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import type {
  RuntimeEnsureWorkspaceInput,
  RuntimeWorkspaceStarterPort,
} from "../../ports/runtime-registry-port";
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
  codexAppServer: CodexAppServerTransportRegistry;
  liveSessionLifecycle: RuntimeLiveSessionLifecyclePort;
  prepareLiveSessionAdapter: CodexLiveSessionAdapterPreparer;
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

export const createCodexWorkspaceRuntimeStarter = ({
  toolDiscovery,
  codexAppServer,
  liveSessionLifecycle,
  prepareLiveSessionAdapter,
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
      let liveAdapterRegistered = false;
      let liveAdapterReleaseRequested = false;
      let liveAdapterReleasePromise: Promise<Exit.Exit<void, HostOperationError>> | null = null;
      let preparedLiveAdapterDiscardPromise: Promise<Exit.Exit<void, HostOperationError>> | null =
        null;
      const startLiveAdapterRelease = (): Promise<Exit.Exit<void, HostOperationError>> => {
        if (!liveAdapterReleasePromise) {
          liveAdapterReleasePromise = Effect.runPromiseExit(
            liveSessionLifecycle.releaseRuntime(nextRuntimeId).pipe(
              Effect.asVoid,
              Effect.mapError((cause) =>
                toHostOperationError(cause, "codexWorkspaceRuntime.releaseLiveSessionAdapter", {
                  runtimeId: nextRuntimeId,
                }),
              ),
            ),
          );
        }
        return liveAdapterReleasePromise;
      };
      const requestLiveAdapterRelease = (): void => {
        liveAdapterReleaseRequested = true;
        if (liveAdapterRegistered) {
          void startLiveAdapterRelease();
        }
      };
      const startPreparedLiveAdapterDiscard = (): Promise<Exit.Exit<void, HostOperationError>> => {
        if (!preparedLiveAdapterDiscardPromise) {
          preparedLiveAdapterDiscardPromise = Effect.runPromiseExit(
            preparedLiveSession.discard().pipe(
              Effect.mapError((cause) =>
                toHostOperationError(cause, "codexWorkspaceRuntime.discardLiveSessionAdapter", {
                  runtimeId: nextRuntimeId,
                }),
              ),
            ),
          );
        }
        return preparedLiveAdapterDiscardPromise;
      };
      const awaitLiveAdapterCleanup = Effect.suspend(() =>
        Effect.promise(() =>
          liveAdapterRegistered ? startLiveAdapterRelease() : startPreparedLiveAdapterDiscard(),
        ).pipe(
          Effect.flatMap((exit) =>
            Exit.isFailure(exit)
              ? Effect.fail(
                  new HostOperationError({
                    operation: "codexWorkspaceRuntime.releaseLiveSessionState",
                    message: Cause.pretty(exit.cause),
                    details: { runtimeId: nextRuntimeId },
                  }),
                )
              : Effect.void,
          ),
        ),
      );
      const failAfterLiveAdapterCleanup = (failure: HostOperationError) =>
        Effect.gen(function* () {
          const cleanup = yield* Effect.either(awaitLiveAdapterCleanup);
          if (cleanup._tag === "Left") {
            return yield* Effect.fail(
              new HostOperationError({
                operation: failure.operation,
                message: `${failure.message}\nCleanup failed: ${cleanup.left.message}`,
                cause: failure,
                details: { runtimeId: nextRuntimeId },
              }),
            );
          }
          return yield* Effect.fail(failure);
        });
      yield* Scope.addFinalizer(runtimeScope, awaitLiveAdapterCleanup.pipe(Effect.ignore));
      const child = yield* Effect.try({
        try: () =>
          spawn(command.command, command.args, {
            cwd: input.workingDirectory,
            detached: shouldStartDetachedProcessGroup(platform),
            env: command.env,
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: command.windowsHide,
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
      let stopping = false;
      let closeDescription: string | null = null;
      child.once("close", (exitCode, signal) => {
        closed = true;
        closeDescription =
          signal === null
            ? `process exited with code ${exitCode}`
            : `process exited from signal ${signal}`;
        if (!stopping) {
          requestLiveAdapterRelease();
        }
      });

      const transport = createCodexAppServerTransport(
        nextRuntimeId,
        child,
        requestTimeoutMs,
        preparedLiveSession.emitRuntimeEvent,
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
        stopping = true;
        const liveExit = yield* Effect.exit(awaitLiveAdapterCleanup);
        const cleanupExit = yield* Effect.exit(cleanup);
        const errors: string[] = [];
        if (liveExit._tag === "Failure") {
          errors.push(`live session: ${liveExit.cause}`);
        }
        if (cleanupExit._tag === "Failure") {
          errors.push(`runtime: ${cleanupExit.cause}`);
        }
        if (errors.length > 0) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "codexWorkspaceRuntime.close",
              message: errors.join("\n"),
              details: { runtimeId: nextRuntimeId },
            }),
          );
        }
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
      if (closed) {
        return yield* failAfterLiveAdapterCleanup(
          new HostOperationError({
            operation: "codexWorkspaceRuntime.registerLiveSessionAdapter",
            message: `Codex process exited before its live-session adapter was registered: ${
              closeDescription ?? "process exited"
            }`,
            details: { runtimeId: nextRuntimeId, closeDescription },
          }),
        );
      }
      const registration = yield* Effect.either(
        liveSessionLifecycle.registerRuntimeAdapter(preparedLiveSession.adapter).pipe(
          Effect.mapError((cause) =>
            toHostOperationError(cause, "codexWorkspaceRuntime.registerLiveSessionAdapter", {
              runtimeId: nextRuntimeId,
            }),
          ),
        ),
      );
      if (registration._tag === "Left") {
        return yield* failAfterLiveAdapterCleanup(registration.left);
      }
      liveAdapterRegistered = true;
      if (closed || liveAdapterReleaseRequested) {
        return yield* failAfterLiveAdapterCleanup(
          new HostOperationError({
            operation: "codexWorkspaceRuntime.registerLiveSessionAdapter",
            message: `Codex process exited while its live-session adapter was being registered: ${
              closeDescription ?? "process exited"
            }`,
            details: { runtimeId: nextRuntimeId, closeDescription },
          }),
        );
      }
      const forwarding = yield* Effect.either(
        preparedLiveSession.startForwarding().pipe(
          Effect.mapError((cause) =>
            toHostOperationError(cause, "codexWorkspaceRuntime.startLiveSessionForwarding", {
              runtimeId: nextRuntimeId,
            }),
          ),
        ),
      );
      if (forwarding._tag === "Left") {
        return yield* failAfterLiveAdapterCleanup(forwarding.left);
      }
      if (closed || liveAdapterReleaseRequested) {
        return yield* failAfterLiveAdapterCleanup(
          new HostOperationError({
            operation: "codexWorkspaceRuntime.startLiveSessionForwarding",
            message: `Codex process exited while live-session forwarding was starting: ${
              closeDescription ?? "process exited"
            }`,
            details: { runtimeId: nextRuntimeId, closeDescription },
          }),
        );
      }

      return {
        runtime,
        isAlive() {
          return !closed;
        },
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
