import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { HostValidationError, toHostOperationError } from "../../effect/host-errors";
import {
  RuntimeExecutableIncompatibleError,
  type RuntimeExecutableProbePort,
} from "../../ports/runtime-executable-probe-port";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import type { RuntimeStarterPort } from "../../ports/runtime-registry-port";
import { type ToolDiscoveryPort, validateExactToolPath } from "../../ports/tool-discovery-port";
import type { ClaudeLiveSessionAdapterPreparer } from "../agent-sessions/claude-live-session-adapter-contract";
import {
  createLiveSessionAttachment,
  createRuntimeSummary,
} from "../runtimes/runtime-live-session-attachment";

export type CreateClaudeRuntimeStarterInput = {
  liveSessionLifecycle: RuntimeLiveSessionLifecyclePort;
  now?: () => Date;
  prepareLiveSessionAdapter: ClaudeLiveSessionAdapterPreparer;
  runtimeId?: () => string;
  runtimeExecutableProbe: RuntimeExecutableProbePort;
  toolDiscovery: ToolDiscoveryPort;
};

/** Starts the one Claude host service of this host. Each start probes the saved executable again. */
export const createClaudeRuntimeStarter = ({
  liveSessionLifecycle,
  now = () => new Date(),
  prepareLiveSessionAdapter,
  runtimeId = () => randomUUID(),
  runtimeExecutableProbe,
  toolDiscovery,
}: CreateClaudeRuntimeStarterInput): RuntimeStarterPort => ({
  startRuntime(input) {
    return Effect.gen(function* () {
      const { path: executablePath } = yield* validateExactToolPath(
        toolDiscovery,
        "claude",
        input.configuredExecutablePath,
      );
      yield* runtimeExecutableProbe.probeExecutable(executablePath).pipe(
        Effect.mapError((cause) =>
          cause instanceof RuntimeExecutableIncompatibleError
            ? new HostValidationError({
                field: "agentRuntimes.claude.executablePath",
                message: cause.message,
                cause,
              })
            : cause,
        ),
      );

      const nextRuntimeId = runtimeId();
      const runtime = yield* createRuntimeSummary({
        kind: "claude",
        runtimeId: nextRuntimeId,
        runtimeRoute: { type: "host_service", identity: nextRuntimeId },
        descriptor: input.descriptor,
        startedAt: now(),
      });

      const preparedLiveSession = yield* prepareLiveSessionAdapter(runtime, executablePath).pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "claudeRuntime.prepareLiveSessionAdapter", {
            runtimeId: nextRuntimeId,
          }),
        ),
      );

      // Claude owns no process. Its live adapter is the only resource.
      const liveSession = createLiveSessionAttachment({
        runtimeId: nextRuntimeId,
        runtimeLabel: "Claude",
        operationPrefix: "claudeRuntime",
        lifecycle: liveSessionLifecycle,
        isClosed: () => false,
        closeDescription: () => null,
      });
      liveSession.adopt(preparedLiveSession);
      // The host owns the prepared adapter until startup returns its handle. A failed start
      // leaves its cleanup to the host.
      input.ownCleanup(liveSession.release);
      yield* liveSession.attach;

      return {
        runtime,
        configuredExecutablePath: input.configuredExecutablePath,
        effectiveExecutablePath: executablePath,
        stop: () => liveSession.release,
      };
    });
  },
});
