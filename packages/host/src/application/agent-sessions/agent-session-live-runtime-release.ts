import {
  type AgentSessionLiveEnvelope,
  type AgentSessionLiveRef,
  type AgentSessionLiveSnapshot,
  agentSessionLiveRefSchema,
  agentSessionLiveSnapshotSchema,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { Effect, Exit } from "effect";
import { causeMessage, type HostError, HostOperationError } from "../../effect/host-errors";
import type {
  AgentSessionLiveAdapterChange,
  AgentSessionLiveAdapterPort,
  AgentSessionLiveAdapterRegistryPort,
} from "../../ports/agent-session-live-adapter-port";
import { parseAdapterOutput } from "./agent-session-live-validation";
import type { LiveStateCoordinator } from "./live-state-coordinator";

type Refs = ReadonlyArray<AgentSessionLiveRef>;

/** An open release of one runtime. */
export type OpenRelease = {
  /** The retry of a failed native cleanup that still owns resources. */
  retry: Effect.Effect<Refs, HostError> | null;
};

type Detached = {
  readonly adapter: AgentSessionLiveAdapterPort;
  readonly snapshots: Exit.Exit<ReadonlyArray<AgentSessionLiveSnapshot>, HostError>;
  readonly settlement: Exit.Exit<void, HostError>;
  readonly detachedPublication: Exit.Exit<void, HostError> | null;
};

const releaseError = (runtimeId: string, message: string) =>
  new HostOperationError({
    operation: "agent-session-live.release-runtime",
    message,
    details: { runtimeId },
  });

/**
 * Releases one runtime from live state in four steps: detach the adapter and settle its known
 * sessions, run native cleanup outside the coordinator, publish sessions that native cleanup
 * released, and report every failure. A failed native cleanup leaves a retry on the open release.
 */
export const createLiveRuntimeRelease = ({
  adapterRegistry,
  coordinator,
  publishChanges,
  publishEnvelope,
  listSnapshots,
  observedRepoPaths,
  markDetached,
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
  readonly observedRepoPaths: () => ReadonlyArray<string>;
  /** Stops new operations and publications through the adapter's registration. */
  readonly markDetached: (adapter: AgentSessionLiveAdapterPort) => void;
}) => {
  const publishRemovals = (refs: Refs) =>
    publishChanges(refs.map((ref) => ({ type: "session_removed" as const, ref })));

  /** Removes the adapter and settles the sessions it knows, under the live coordinator. */
  const detach = (runtimeId: string): Effect.Effect<Detached | null, HostError> =>
    coordinator.run(
      Effect.gen(function* () {
        const adapter = yield* adapterRegistry.remove(runtimeId);
        if (!adapter) return null;
        markDetached(adapter);
        const snapshots = yield* Effect.exit(
          adapter
            .listSnapshots()
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
          ? yield* Effect.exit(publishRemovals(snapshots.value.map((snapshot) => snapshot.ref)))
          : null;
        return { adapter, snapshots, settlement, detachedPublication };
      }),
    );

  /** Builds native cleanup and the publication of sessions it releases after the detach. */
  const nativeRelease = ({ adapter, snapshots }: Detached) => {
    const detachedRefs = Exit.isSuccess(snapshots)
      ? snapshots.value.map((snapshot) => snapshot.ref)
      : [];
    const detachedKeys = new Set(detachedRefs.map(agentSessionRefKey));
    let nativeRefs: Refs = [];
    const release = adapter.releaseRuntime().pipe(
      Effect.flatMap((refs) =>
        Effect.forEach(refs, (ref) =>
          parseAdapterOutput(
            agentSessionLiveRefSchema,
            ref,
            "agent-session-live.release-runtime-refs",
          ),
        ),
      ),
      Effect.tap((refs) =>
        Effect.sync(() => {
          nativeRefs = refs;
        }),
      ),
      Effect.asVoid,
    );
    const publishReleased = coordinator.run(
      Effect.gen(function* () {
        const refsByKey = new Map<string, AgentSessionLiveRef>();
        for (const ref of [...detachedRefs, ...nativeRefs])
          refsByKey.set(agentSessionRefKey(ref), ref);
        const refs = [...refsByKey.values()];
        const replacement = adapterRegistry
          .list()
          .some((candidate) => candidate.binding.runtimeKind === adapter.binding.runtimeKind);
        // Known sessions settled at detach, before any replacement could register.
        const remaining = replacement
          ? []
          : refs.filter((ref) => !detachedKeys.has(agentSessionRefKey(ref)));
        return { refs, publication: yield* Effect.exit(publishRemovals(remaining)) };
      }),
    );
    return { release, publishReleased };
  };

  /** Retries a failed native cleanup, then publishes what it released. */
  const retryNativeRelease = (
    runtimeId: string,
    open: OpenRelease,
    native: ReturnType<typeof nativeRelease>,
  ): Effect.Effect<Refs, HostError> =>
    Effect.gen(function* () {
      yield* native.release;
      open.retry = null;
      const retried = yield* native.publishReleased;
      if (Exit.isFailure(retried.publication)) {
        return yield* releaseError(
          runtimeId,
          `session removal publication: ${causeMessage(retried.publication.cause)}`,
        );
      }
      return retried.refs;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new HostOperationError({
            operation: "agent-session-live.release-runtime",
            message: `adapter cleanup: ${cause.message}`,
            cause,
            details: { runtimeId },
          }),
      ),
    );

  /** Resets collections that a failed detach read could not identify, and reports failures. */
  const finish = (
    runtimeId: string,
    detached: Detached,
    cleanup: Exit.Exit<void, HostError>,
    released: { refs: Refs; publication: Exit.Exit<void, HostError> },
  ): Effect.Effect<Refs, HostError> =>
    coordinator.run(
      Effect.gen(function* () {
        const { snapshots, settlement, detachedPublication } = detached;
        // Reset every observed repository, including when a replacement registered meanwhile.
        const reset = Exit.isFailure(snapshots)
          ? yield* Effect.exit(
              Effect.forEach(
                [...new Set([...observedRepoPaths(), ...released.refs.map((ref) => ref.repoPath)])],
                (repoPath) =>
                  listSnapshots(repoPath).pipe(
                    Effect.flatMap((sessions) =>
                      publishEnvelope({ type: "snapshot", repoPath, sessions: [...sessions] }),
                    ),
                  ),
                { discard: true },
              ),
            )
          : null;
        const outcomes: ReadonlyArray<readonly [string, Exit.Exit<unknown, HostError> | null]> = [
          ["transcript settlement", settlement],
          ["live snapshots", snapshots],
          ["adapter cleanup", cleanup],
          ["detached session publication", detachedPublication],
          ["session removal publication", released.publication],
          ["authoritative snapshot", reset],
        ];
        const failures = outcomes.flatMap(([label, exit]) =>
          exit && Exit.isFailure(exit) ? [`${label}: ${causeMessage(exit.cause)}`] : [],
        );
        if (failures.length > 0) return yield* releaseError(runtimeId, failures.join("\n"));
        return released.refs;
      }),
    );

  return (runtimeId: string, open: OpenRelease): Effect.Effect<Refs, HostError> =>
    Effect.gen(function* () {
      const detached = yield* detach(runtimeId);
      if (!detached) return [];
      const native = nativeRelease(detached);
      // Native cleanup can wait for controls or events that need the live coordinator.
      const cleanup = yield* Effect.exit(native.release);
      const released = yield* native.publishReleased;
      if (Exit.isFailure(cleanup)) open.retry = retryNativeRelease(runtimeId, open, native);
      return yield* finish(runtimeId, detached, cleanup, released);
    });
};
