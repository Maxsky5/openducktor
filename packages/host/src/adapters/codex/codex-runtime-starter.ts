import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Effect, Fiber } from "effect";
import {
  HostOperationError,
  type HostOperationErrorAggregate,
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
import type { RuntimeStarterPort } from "../../ports/runtime-registry-port";
import { type ToolDiscoveryPort, validateExactToolPath } from "../../ports/tool-discovery-port";
import type { CodexLiveSessionAdapterPreparer } from "../agent-sessions/codex-live-session-adapter";
import { withoutOpenDucktorMcpEnvironment } from "../mcp/openducktor-mcp-environment";
import { createCodexAppServerTransport } from "./codex-app-server-transport";
import type { CodexAppServerTransportRegistry } from "./codex-app-server-transport-registry";
import { createRuntimeCleanup } from "../runtimes/runtime-cleanup";
import {
  createLiveSessionAttachment,
  createRuntimeSummary,
} from "../runtimes/runtime-live-session-attachment";
import { type CodexChildProcess, cleanupCodexRuntime } from "./codex-runtime-cleanup";

export type CreateCodexRuntimeStarterInput = {
  toolDiscovery: ToolDiscoveryPort;
  codexAppServer: CodexAppServerTransportRegistry;
  liveSessionLifecycle: RuntimeLiveSessionLifecyclePort;
  prepareLiveSessionAdapter: CodexLiveSessionAdapterPreparer;
  /** Process working directory. The shared app-server belongs to no repository. */
  launchDirectory: string;
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
 * Own the shared Codex child, transport, and live adapter through one cleanup path.
 * Share cleanup across fatal errors, child close, and stop calls so each resource closes once.
 * Share the stop result so callers and the exit reporter see the same cleanup error.
 */
export const createCodexRuntimeStarter = ({
  toolDiscovery,
  codexAppServer,
  liveSessionLifecycle,
  prepareLiveSessionAdapter,
  launchDirectory,
  processEnv = process.env,
  clientVersion = processEnv.npm_package_version ?? "0.0.0",
  requestTimeoutMs = DEFAULT_CODEX_REQUEST_TIMEOUT_MS,
  stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
  now = () => new Date(),
  runtimeId = () => randomUUID(),
  platform = process.platform,
  processTreeTerminator = terminateProcessTree,
}: CreateCodexRuntimeStarterInput): RuntimeStarterPort => ({
  startRuntime(input) {
    let fatalError: Error | null = null;
    let reporting: Fiber.RuntimeFiber<void, never> | null = null;
    return Effect.gen(function* () {
      const { path: binary } = yield* validateExactToolPath(
        toolDiscovery,
        "codex",
        input.configuredExecutablePath,
      );
      const command = yield* Effect.try({
        try: () =>
          createProcessCommandLaunch(
            binary,
            ["app-server"],
            // Each thread receives its workspace MCP binding through per-thread config.
            withoutOpenDucktorMcpEnvironment(processEnv),
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
      const runtime = yield* createRuntimeSummary({
        kind: "codex",
        runtimeId: nextRuntimeId,
        runtimeRoute: { type: "stdio", identity: nextRuntimeId },
        descriptor: input.descriptor,
        startedAt: now(),
      });
      const preparedLiveSession = yield* prepareLiveSessionAdapter(runtime).pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "codexRuntime.prepareLiveSessionAdapter", {
            runtimeId: nextRuntimeId,
          }),
        ),
      );
      let closed = false;
      let stopping = false;
      let startupComplete = false;
      let closeDescription: string | null = null;
      const liveSession = createLiveSessionAttachment({
        runtimeId: nextRuntimeId,
        runtimeLabel: "Codex",
        operationPrefix: "codexRuntime",
        lifecycle: liveSessionLifecycle,
        isClosed: () => closed || stopping,
        closeDescription: () => closeDescription,
      });
      liveSession.adopt(preparedLiveSession);
      let cleanupProcess: Effect.Effect<void, HostOperationErrorAggregate> = Effect.void;
      // A failed stop keeps the unfinished steps, so a later explicit action can finish them.
      const sharedCleanup = createRuntimeCleanup({
        runtimeId: nextRuntimeId,
        operation: "codexRuntime.close",
        releaseLiveState: liveSession.release,
        stopProcess: Effect.suspend(() => cleanupProcess),
        onStart: () => {
          stopping = true;
        },
      });
      // The host owns the prepared adapter and the later process until startup returns. A failed
      // start leaves their cleanup to the host.
      input.ownCleanup(sharedCleanup);
      const closeRuntime = Effect.gen(function* () {
        const result = yield* Effect.either(sharedCleanup);
        if (result._tag === "Right") return;
        if (fatalError) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "codexRuntime.transportFailed",
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
      });
      const child = yield* Effect.try({
        try: (): CodexChildProcess =>
          spawn(command.command, command.args, {
            cwd: launchDirectory,
            detached: shouldStartDetachedProcessGroup(platform),
            env: command.env,
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: command.windowsHide,
            windowsVerbatimArguments: command.windowsVerbatimArguments,
          }),
        catch: (cause) =>
          toHostOperationError(cause, "codexRuntime.spawn", {
            binary,
            launchDirectory,
          }),
      });
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
          // A deliberate stop or a failed startup already owns the outcome.
          const unexpectedExit = startupComplete && !stopping;
          fatalError = error;
          stopping = true;
          // The generation is unavailable from the failure on, not only after cleanup.
          if (unexpectedExit) {
            input.onRuntimeExit(error.message);
          }
          reporting = Effect.runFork(
            Effect.gen(function* () {
              const result = yield* Effect.either(sharedCleanup);
              // A failed cleanup stays unfinished, so an explicit stop can retry it.
              if (result._tag === "Left" && unexpectedExit)
                yield* Effect.sync(() => input.onRuntimeCleanupFailed(result.left.message));
            }),
          );
        },
      );
      cleanupProcess = transport.close();
      const pid = child.pid;
      if (!pid || pid <= 0) {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "codexRuntime.startRuntime",
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
        platform,
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
      yield* liveSession.attach;

      startupComplete = true;
      return {
        runtime,
        configuredExecutablePath: input.configuredExecutablePath,
        effectiveExecutablePath: binary,
        stop() {
          return closeRuntime.pipe(
            Effect.ensuring(
              Effect.suspend(() => (reporting ? Fiber.join(reporting) : Effect.void)),
            ),
            Effect.mapError((cause) => toHostOperationError(cause, "codexRuntime.stop")),
          );
        },
      };
    }).pipe(
      // A fatal transport failure explains a failed startup request better than the request does.
      Effect.mapError((failure) =>
        fatalError ? toHostOperationError(fatalError, "codexRuntime.startRuntime") : failure,
      ),
    );
  },
});
