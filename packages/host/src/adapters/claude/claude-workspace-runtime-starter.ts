import { randomUUID } from "node:crypto";
import { type RuntimeInstanceSummary, runtimeInstanceSummarySchema } from "@openducktor/contracts";
import { Effect, Exit, Scope } from "effect";
import { resolveSavedRuntimeExecutable } from "../../application/runtimes/saved-runtime-executable";
import { HostValidationError, toHostOperationError } from "../../effect/host-errors";
import type { RuntimeExecutableProbePort } from "../../ports/runtime-executable-probe-port";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import type { RuntimeWorkspaceStarterPort } from "../../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type { ClaudeLiveSessionAdapterPreparer } from "../agent-sessions/claude-live-session-adapter";

export type CreateClaudeWorkspaceRuntimeStarterInput = {
  liveSessionLifecycle: RuntimeLiveSessionLifecyclePort;
  now?: () => Date;
  prepareLiveSessionAdapter: ClaudeLiveSessionAdapterPreparer;
  runtimeId?: () => string;
  runtimeExecutableProbe: RuntimeExecutableProbePort;
  settingsConfig: SettingsConfigPort;
  toolDiscovery: ToolDiscoveryPort;
};

export const createClaudeWorkspaceRuntimeStarter = ({
  liveSessionLifecycle,
  now = () => new Date(),
  prepareLiveSessionAdapter,
  runtimeId = () => randomUUID(),
  runtimeExecutableProbe,
  settingsConfig,
  toolDiscovery,
}: CreateClaudeWorkspaceRuntimeStarterInput): RuntimeWorkspaceStarterPort => ({
  startWorkspaceRuntime(input) {
    let scope: Parameters<typeof Scope.close>[0] | null = null;
    return Effect.gen(function* () {
      if (input.runtimeKind !== "claude") {
        return yield* Effect.fail(
          new HostValidationError({
            field: "runtimeKind",
            message: `Claude workspace runtime starter does not support runtime kind ${input.runtimeKind}.`,
            details: { runtimeKind: input.runtimeKind },
          }),
        );
      }
      const executablePath = yield* resolveSavedRuntimeExecutable({
        kind: "claude",
        settingsConfig,
        toolDiscovery,
      });
      yield* runtimeExecutableProbe.probeExecutable(executablePath);

      const runtimeScope = yield* Scope.make();
      scope = runtimeScope;
      const nextRuntimeId = runtimeId();
      let closed = false;
      let stopping = false;
      const runtime = yield* Effect.try({
        try: () =>
          runtimeInstanceSummarySchema.parse({
            kind: "claude",
            runtimeId: nextRuntimeId,
            repoPath: input.repoPath,
            taskId: null,
            role: "workspace",
            workingDirectory: input.workingDirectory,
            runtimeRoute: {
              type: "host_service",
              identity: nextRuntimeId,
            },
            startedAt: now().toISOString(),
            descriptor: input.descriptor,
          } satisfies RuntimeInstanceSummary),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
            details: {
              runtimeKind: input.runtimeKind,
              runtimeId: nextRuntimeId,
            },
          }),
      });

      const preparedLiveSession = yield* prepareLiveSessionAdapter(runtime).pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "claudeWorkspaceRuntime.prepareLiveSessionAdapter", {
            runtimeId: nextRuntimeId,
          }),
        ),
      );

      let liveAdapterRegistered = false;
      const releaseLiveAdapter = Effect.suspend(() => {
        if (!liveAdapterRegistered) {
          return preparedLiveSession.discard();
        }
        liveAdapterRegistered = false;
        return liveSessionLifecycle.releaseRuntime(nextRuntimeId).pipe(Effect.asVoid);
      }).pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "claudeWorkspaceRuntime.releaseLiveSessionAdapter", {
            runtimeId: nextRuntimeId,
          }),
        ),
      );
      const closeRuntime = Effect.gen(function* () {
        if (closed) {
          return;
        }
        stopping = true;
        yield* releaseLiveAdapter;
        closed = true;
      });
      yield* Scope.addFinalizer(runtimeScope, closeRuntime.pipe(Effect.ignore));
      yield* liveSessionLifecycle.registerRuntimeAdapter(preparedLiveSession.adapter).pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "claudeWorkspaceRuntime.registerLiveSessionAdapter", {
            runtimeId: nextRuntimeId,
          }),
        ),
      );
      liveAdapterRegistered = true;
      yield* preparedLiveSession.startForwarding().pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "claudeWorkspaceRuntime.startLiveSessionForwarding", {
            runtimeId: nextRuntimeId,
          }),
        ),
      );

      return {
        runtime,
        isAlive() {
          return !stopping;
        },
        stop() {
          return closeRuntime.pipe(
            Effect.zipRight(Scope.close(runtimeScope, Exit.succeed(undefined)).pipe(Effect.ignore)),
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
