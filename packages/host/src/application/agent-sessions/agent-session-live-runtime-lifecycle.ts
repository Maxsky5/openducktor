import {
  type AgentSessionLiveEnvelope,
  type AgentSessionLiveRef,
  type AgentSessionLiveSnapshot,
  agentSessionLiveRefSchema,
  agentSessionLiveSnapshotSchema,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { Cause, Effect, Exit } from "effect";
import { type HostError, HostOperationError } from "../../effect/host-errors";
import {
  AgentSessionLiveRegistration,
  type AgentSessionLiveAdapterChange,
  type AgentSessionLiveAdapterPort,
  type AgentSessionLiveAdapterRegistryPort,
} from "../../ports/agent-session-live-adapter-port";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import type { LiveStateCoordinator } from "./live-state-coordinator";
import { parseAdapterOutput } from "./agent-session-live-validation";

type LiveRuntimeLifecycle = RuntimeLiveSessionLifecyclePort & {
  readonly requireAttached: (
    registration: AgentSessionLiveRegistration,
  ) => Effect.Effect<void, HostError>;
};

export const createAgentSessionLiveRuntimeLifecycle = ({
  adapterRegistry,
  coordinator,
  publishChanges,
  publishEnvelope,
  listSnapshots,
  refreshSnapshots,
}: {
  readonly adapterRegistry: AgentSessionLiveAdapterRegistryPort;
  readonly coordinator: LiveStateCoordinator;
  readonly publishChanges: (
    changes: ReadonlyArray<AgentSessionLiveAdapterChange>,
  ) => Effect.Effect<void, HostError>;
  readonly publishEnvelope: (envelope: AgentSessionLiveEnvelope) => Effect.Effect<void, HostError>;
  readonly listSnapshots: (
    repoPath: string,
  ) => Effect.Effect<ReadonlyArray<AgentSessionLiveSnapshot>, HostError>;
  readonly refreshSnapshots: (
    adapter: AgentSessionLiveAdapterPort,
  ) => Effect.Effect<void, HostError>;
}): LiveRuntimeLifecycle => {
  const detachedBindings = new WeakSet<AgentSessionLiveRegistration>();
  const activeRegistrations = new WeakSet<AgentSessionLiveRegistration>();
  const requireAttached = (binding: AgentSessionLiveRegistration) =>
    detachedBindings.has(binding)
      ? Effect.fail(
          new HostOperationError({
            operation: "agent-session-live.runtime-detached",
            message: `Runtime '${binding.runtimeId}' was released before the session operation completed.`,
            details: { runtimeId: binding.runtimeId },
          }),
        )
      : Effect.void;

  return {
    requireAttached,
    registerRuntimeAdapter: (adapter) => {
      let registered = false;
      return Effect.gen(function* () {
        yield* coordinator.run(
          requireAttached(adapter.binding).pipe(
            Effect.zipRight(adapterRegistry.register(adapter)),
            Effect.tap(() =>
              Effect.sync(() => {
                registered = true;
                activeRegistrations.add(adapter.binding);
              }),
            ),
          ),
        );
        yield* refreshSnapshots(adapter);
        yield* coordinator.run(
          Effect.gen(function* () {
            yield* requireAttached(adapter.binding);
            const snapshots = yield* adapter.listSnapshots(adapter.binding.repoPath);
            const validatedSnapshots = yield* Effect.forEach(snapshots, (snapshot) =>
              parseAdapterOutput(
                agentSessionLiveSnapshotSchema,
                snapshot,
                "agent-session-live.register-runtime",
              ),
            );
            yield* publishChanges(
              validatedSnapshots.map((snapshot) => ({
                type: "session_upsert" as const,
                snapshot,
                provenance: "baseline" as const,
              })),
            );
          }),
        );
      }).pipe(
        Effect.onError(() =>
          registered
            ? coordinator.run(
                Effect.gen(function* () {
                  detachedBindings.add(adapter.binding);
                  activeRegistrations.delete(adapter.binding);
                  if (adapterRegistry.listForRepo(adapter.binding.repoPath).includes(adapter)) {
                    yield* adapterRegistry.remove(adapter.binding.runtimeId);
                  }
                }),
              )
            : Effect.void,
        ),
      );
    },
    releaseRuntime: (runtimeId) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const detached = yield* coordinator.run(
            Effect.gen(function* () {
              const adapter = yield* adapterRegistry.remove(runtimeId);
              if (!adapter) return null;
              detachedBindings.add(adapter.binding);
              activeRegistrations.delete(adapter.binding);
              const snapshots = yield* Effect.exit(
                adapter
                  .listSnapshots(adapter.binding.repoPath)
                  .pipe(
                    Effect.flatMap((values) =>
                      Effect.forEach(values, (snapshot) =>
                        parseAdapterOutput(
                          agentSessionLiveSnapshotSchema,
                          snapshot,
                          "agent-session-live.release-runtime",
                        ),
                      ),
                    ),
                  ),
              );
              const settlement = yield* Effect.exit(
                Effect.gen(function* () {
                  if (!adapter.settleRuntimeTranscript) return;
                  const events = yield* adapter.settleRuntimeTranscript();
                  yield* publishChanges(
                    events.map((event) => ({ type: "transcript_event" as const, event })),
                  );
                }),
              );
              const detachedPublication = Exit.isSuccess(snapshots)
                ? yield* Effect.exit(
                    publishChanges(
                      snapshots.value.map((snapshot) => ({
                        type: "session_removed" as const,
                        ref: snapshot.ref,
                      })),
                    ),
                  )
                : null;
              return { adapter, snapshots, settlement, detachedPublication };
            }),
          );
          if (!detached) return [];
          const { adapter, snapshots, settlement, detachedPublication } = detached;
          // Native cleanup can wait for controls or events that need the live coordinator.
          const cleanup = yield* Effect.exit(adapter.releaseRuntime());
          const releasedRefs = Exit.isSuccess(cleanup)
            ? yield* Effect.exit(
                Effect.forEach(cleanup.value, (ref) =>
                  parseAdapterOutput(
                    agentSessionLiveRefSchema,
                    ref,
                    "agent-session-live.release-runtime-refs",
                  ),
                ),
              )
            : null;
          return yield* coordinator.run(
            Effect.gen(function* () {
              const refsByKey = new Map<string, AgentSessionLiveRef>();
              if (Exit.isSuccess(snapshots)) {
                for (const snapshot of snapshots.value)
                  refsByKey.set(agentSessionRefKey(snapshot.ref), snapshot.ref);
              }
              if (releasedRefs && Exit.isSuccess(releasedRefs)) {
                for (const ref of releasedRefs.value) refsByKey.set(agentSessionRefKey(ref), ref);
              }
              const registrations = adapterRegistry.listForRepo(adapter.binding.repoPath);
              const replacement = registrations.some(
                (candidate) => candidate.binding.runtimeKind === adapter.binding.runtimeKind,
              );
              const refs = [...refsByKey.values()];
              const detachedKeys = new Set(
                Exit.isSuccess(snapshots)
                  ? snapshots.value.map((snapshot) => agentSessionRefKey(snapshot.ref))
                  : [],
              );
              // Known sessions settled at detach, before any replacement could register.
              const remainingRefs = replacement
                ? []
                : refs.filter((ref) => !detachedKeys.has(agentSessionRefKey(ref)));
              const publication = yield* Effect.exit(
                publishChanges(
                  remainingRefs.map((ref) => ({
                    type: "session_removed" as const,
                    ref,
                  })),
                ),
              );
              // A failed detach read cannot identify the old published collection. Reset it,
              // including when a replacement registered while native cleanup was running.
              const reset = Exit.isFailure(snapshots)
                ? yield* Effect.exit(
                    listSnapshots(adapter.binding.repoPath).pipe(
                      Effect.flatMap((sessions) =>
                        publishEnvelope({
                          type: "snapshot",
                          repoPath: adapter.binding.repoPath,
                          sessions: [...sessions],
                        }),
                      ),
                    ),
                  )
                : null;
              const failures: string[] = [];
              if (Exit.isFailure(settlement))
                failures.push(`transcript settlement: ${Cause.pretty(settlement.cause)}`);
              if (Exit.isFailure(snapshots))
                failures.push(`live snapshots: ${Cause.pretty(snapshots.cause)}`);
              if (Exit.isFailure(cleanup))
                failures.push(`adapter cleanup: ${Cause.pretty(cleanup.cause)}`);
              if (releasedRefs && Exit.isFailure(releasedRefs))
                failures.push(`released refs: ${Cause.pretty(releasedRefs.cause)}`);
              if (detachedPublication && Exit.isFailure(detachedPublication))
                failures.push(
                  `detached session publication: ${Cause.pretty(detachedPublication.cause)}`,
                );
              if (Exit.isFailure(publication))
                failures.push(`session removal publication: ${Cause.pretty(publication.cause)}`);
              if (reset && Exit.isFailure(reset))
                failures.push(`authoritative snapshot: ${Cause.pretty(reset.cause)}`);
              if (failures.length > 0)
                return yield* new HostOperationError({
                  operation: "agent-session-live.release-runtime",
                  message: failures.join("\n"),
                  details: { runtimeId },
                });
              return refs;
            }),
          );
        }),
      ),
    createRuntimeRegistration: (binding) => {
      const registration = new AgentSessionLiveRegistration(binding, (mutation) =>
        coordinator.run(
          Effect.gen(function* () {
            const result = yield* mutation;
            // Cleanup can drain native events. A detached lease cannot publish them.
            if (activeRegistrations.has(registration)) yield* publishChanges(result.changes);
            return result.value;
          }),
        ),
      );
      return registration;
    },
  };
};
