import {
  type AgentSessionLiveEnvelope,
  type AgentSessionLiveRef,
  type AgentSessionLiveSnapshot,
  agentSessionLiveSnapshotSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
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
import { createRetryableCleanup } from "../../effect/retryable-cleanup";
import { createLiveRuntimeRelease, type OpenRelease } from "./agent-session-live-runtime-release";

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
  observedRepoPaths,
  onDetach,
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
  /** Repositories whose live state a renderer has observed. */
  readonly observedRepoPaths: () => ReadonlyArray<string>;
  readonly onDetach: (binding: AgentSessionLiveRegistration) => void;
}): LiveRuntimeLifecycle => {
  const detachedBindings = new WeakSet<AgentSessionLiveRegistration>();
  const activeRegistrations = new WeakSet<AgentSessionLiveRegistration>();
  /**
   * One open release per runtime. Concurrent callers share it. A failed native cleanup keeps the
   * release open until a later call retries the cleanup and it succeeds.
   */
  const releases = new Map<string, Effect.Effect<ReadonlyArray<AgentSessionLiveRef>, HostError>>();
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
  const markDetached = (binding: AgentSessionLiveRegistration) => {
    detachedBindings.add(binding);
    activeRegistrations.delete(binding);
    onDetach(binding);
  };

  const releaseAttached = createLiveRuntimeRelease({
    adapterRegistry,
    coordinator,
    publishChanges,
    publishEnvelope,
    listSnapshots,
    observedRepoPaths,
    markDetached: (adapter) => markDetached(adapter.binding),
  });

  return {
    requireAttached,
    registerRuntimeAdapter: (adapter) => {
      let registered = false;
      return Effect.gen(function* () {
        yield* coordinator.run(
          requireAttached(adapter.binding).pipe(
            Effect.andThen(adapterRegistry.register(adapter)),
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
            const snapshots = yield* adapter.listSnapshots();
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
                  markDetached(adapter.binding);
                  if (adapterRegistry.list().includes(adapter)) {
                    yield* adapterRegistry.remove(adapter.binding.runtimeId);
                  }
                }),
              )
            : Effect.void,
        ),
      );
    },
    releaseRuntime: (runtimeId) =>
      Effect.suspend(() => {
        const existing = releases.get(runtimeId);
        if (existing) return existing;
        // The release exists before detach, so a concurrent caller cannot miss it. It stays
        // open while a failed native cleanup still owns resources.
        const open: OpenRelease = { retry: null };
        const release = createRetryableCleanup(
          Effect.suspend(() => open.retry ?? releaseAttached(runtimeId, open)).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                if (open.retry === null) releases.delete(runtimeId);
              }),
            ),
          ),
        );
        releases.set(runtimeId, release);
        return release;
      }),
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
