import type { CodexLiveSessionMutation } from "@openducktor/adapters-codex-app-server";
import {
  type AgentSessionLiveRef,
  type AgentSessionLiveSnapshot,
  agentSessionLiveRefSchema,
  agentSessionLiveSnapshotSchema,
  agentSessionTranscriptEventSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  type HostError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type { AgentSessionLiveAdapterChange } from "../../ports/agent-session-live-adapter-port";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";

type CodexProjectionRuntime = {
  readonly runtimeId: string;
  readonly repoPath: string;
  readonly workingDirectory: string;
};

type QueuedMutation = {
  readonly mutation: CodexLiveSessionMutation;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
};

const refKey = (ref: AgentSessionLiveRef): string =>
  [ref.repoPath, ref.runtimeKind, ref.workingDirectory, ref.externalSessionId].join("\u0000");

const refsEqual = (left: AgentSessionLiveRef, right: AgentSessionLiveRef): boolean =>
  refKey(left) === refKey(right);

const snapshotsEqual = (left: AgentSessionLiveSnapshot, right: AgentSessionLiveSnapshot): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const parseProjectionValue = <Output>(
  schema: { parse(value: unknown): Output },
  value: unknown,
  operation: string,
): Effect.Effect<Output, HostValidationError> =>
  Effect.try({
    try: () => schema.parse(value),
    catch: (cause) =>
      new HostValidationError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
        details: { operation },
      }),
  });

export const createCodexLiveSessionProjection = ({
  runtime,
  liveSessionLifecycle,
}: {
  readonly runtime: CodexProjectionRuntime;
  readonly liveSessionLifecycle: Pick<RuntimeLiveSessionLifecyclePort, "runAdapterMutation">;
}) => {
  const snapshotsByRef = new Map<string, AgentSessionLiveSnapshot>();
  const queuedMutations: QueuedMutation[] = [];
  let forwarding = false;
  let released = false;
  let forwardingChain = Promise.resolve();

  const normalizeSnapshots = (snapshots: AgentSessionLiveSnapshot[]) =>
    Effect.forEach(snapshots, (snapshot) =>
      parseProjectionValue(
        agentSessionLiveSnapshotSchema,
        snapshot,
        "codex-live-session.normalize-snapshot",
      ).pipe(
        Effect.flatMap((parsed) =>
          parsed.ref.runtimeKind === "codex" && parsed.ref.repoPath === runtime.repoPath
            ? Effect.succeed(parsed)
            : Effect.fail(
                new HostValidationError({
                  field: "snapshot.ref",
                  message: `Codex runtime '${runtime.runtimeId}' produced a snapshot outside repo '${runtime.repoPath}'.`,
                  details: { runtimeId: runtime.runtimeId, ref: parsed.ref },
                }),
              ),
        ),
      ),
    );

  const normalizeFaultRef = (faultRef: AgentSessionLiveRef) =>
    parseProjectionValue(
      agentSessionLiveRefSchema,
      faultRef,
      "codex-live-session.normalize-fault-ref",
    ).pipe(
      Effect.flatMap((parsed) => {
        if (parsed.repoPath !== runtime.repoPath) {
          return Effect.fail(
            new HostValidationError({
              field: "faultRef.repoPath",
              message: `Codex runtime '${runtime.runtimeId}' produced a fault ref outside repo '${runtime.repoPath}'.`,
              details: { runtimeId: runtime.runtimeId, ref: parsed },
            }),
          );
        }
        if (parsed.runtimeKind !== "codex") {
          return Effect.fail(
            new HostValidationError({
              field: "faultRef.runtimeKind",
              message: `Codex runtime '${runtime.runtimeId}' produced a fault ref outside Codex runtime.`,
              details: { runtimeId: runtime.runtimeId, ref: parsed },
            }),
          );
        }
        return Effect.succeed(parsed);
      }),
    );

  const normalizeMutation = (mutation: CodexLiveSessionMutation) =>
    Effect.gen(function* () {
      if (mutation.runtimeId !== runtime.runtimeId) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "runtimeId",
            message: `Codex mutation for runtime '${mutation.runtimeId}' cannot update runtime '${runtime.runtimeId}'.`,
            details: { runtimeId: runtime.runtimeId, mutationRuntimeId: mutation.runtimeId },
          }),
        );
      }
      const snapshots = yield* normalizeSnapshots(mutation.snapshots);
      const transcriptEvents = yield* Effect.forEach(mutation.transcriptEvents, (event) =>
        parseProjectionValue(
          agentSessionTranscriptEventSchema,
          event,
          "codex-live-session.normalize-transcript-event",
        ),
      );
      const faultRef = mutation.faultRef ? yield* normalizeFaultRef(mutation.faultRef) : undefined;
      return {
        snapshots,
        transcriptEvents,
        catalogInvalidated: mutation.catalogInvalidated,
        ...(mutation.fault ? { fault: mutation.fault } : {}),
        ...(faultRef ? { faultRef } : {}),
      };
    });

  const applyMutation = (mutation: CodexLiveSessionMutation): Effect.Effect<void, HostError> =>
    normalizeMutation(mutation).pipe(
      Effect.flatMap((normalized) =>
        liveSessionLifecycle.runAdapterMutation(
          Effect.sync(() => {
            if (released) {
              return { value: undefined, changes: [] };
            }
            const changes: AgentSessionLiveAdapterChange[] = [];
            const incomingKeys = new Set<string>();
            for (const snapshot of normalized.snapshots) {
              const key = refKey(snapshot.ref);
              incomingKeys.add(key);
              const previous = snapshotsByRef.get(key);
              snapshotsByRef.set(key, snapshot);
              if (!previous || !snapshotsEqual(previous, snapshot)) {
                changes.push({ type: "session_upsert", snapshot });
              }
            }
            for (const [key, snapshot] of snapshotsByRef) {
              if (!incomingKeys.has(key)) {
                snapshotsByRef.delete(key);
                changes.push({ type: "session_removed", ref: snapshot.ref });
              }
            }
            for (const event of normalized.transcriptEvents) {
              changes.push({ type: "transcript_event", event });
            }
            if (normalized.catalogInvalidated) {
              changes.push({
                type: "catalog_invalidated",
                repoPath: runtime.repoPath,
                runtimeKind: "codex",
                workingDirectory: runtime.workingDirectory,
              });
            }
            if (normalized.fault) {
              changes.push({
                type: "fault",
                repoPath: runtime.repoPath,
                operation: "codex-live-session.process-event",
                message: normalized.fault,
                ...(normalized.faultRef ? { ref: normalized.faultRef } : {}),
              });
            }
            return { value: undefined, changes };
          }),
        ),
      ),
    );

  const drainQueuedMutations = (): Promise<void> => {
    forwardingChain = forwardingChain.then(async () => {
      while (forwarding && queuedMutations.length > 0) {
        const queued = queuedMutations.shift();
        if (!queued) {
          continue;
        }
        try {
          await Effect.runPromise(applyMutation(queued.mutation));
          queued.resolve();
        } catch (error) {
          queued.reject(error);
        }
      }
    });
    return forwardingChain;
  };

  const enqueueMutation = (mutation: CodexLiveSessionMutation): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      if (released) {
        reject(new Error(`Codex runtime '${runtime.runtimeId}' is already released.`));
        return;
      }
      queuedMutations.push({ mutation, resolve, reject });
      if (forwarding) {
        void drainQueuedMutations();
      }
    });

  return {
    applyMutation,
    enqueueMutation,
    hasSnapshot: (ref: AgentSessionLiveRef): boolean => snapshotsByRef.has(refKey(ref)),
    matches: (ref: AgentSessionLiveRef): boolean => snapshotsByRef.has(refKey(ref)),
    listRetainedSnapshots: (repoPath: string) =>
      repoPath === runtime.repoPath
        ? Effect.forEach([...snapshotsByRef.values()], (snapshot) =>
            parseProjectionValue(
              agentSessionLiveSnapshotSchema,
              snapshot,
              "codex-live-session.clone-retained-snapshot",
            ),
          )
        : Effect.succeed([]),
    readRetainedSnapshot: (ref: AgentSessionLiveRef) => {
      const snapshot = snapshotsByRef.get(refKey(ref));
      return Effect.succeed(
        snapshot && refsEqual(snapshot.ref, ref)
          ? ({ type: "live", session: snapshot } as const)
          : ({ type: "missing", ref } as const),
      );
    },
    startForwarding: (): Effect.Effect<void, HostError> =>
      Effect.tryPromise({
        try: async () => {
          if (released) {
            throw new Error(`Codex runtime '${runtime.runtimeId}' is already released.`);
          }
          forwarding = true;
          await drainQueuedMutations();
        },
        catch: (cause) =>
          toHostOperationError(cause, "codex-live-session.start-forwarding", {
            runtimeId: runtime.runtimeId,
          }),
      }),
    releaseRuntime: (
      releaseController: () => void,
    ): Effect.Effect<ReadonlyArray<AgentSessionLiveRef>, HostError> =>
      Effect.suspend(() => {
        if (released) {
          return Effect.succeed([]);
        }
        released = true;
        forwarding = false;
        for (const queued of queuedMutations.splice(0)) {
          queued.reject(new Error(`Codex runtime '${runtime.runtimeId}' was released.`));
        }
        const refs = [...snapshotsByRef.values()].map((snapshot) => snapshot.ref);
        snapshotsByRef.clear();
        return Effect.try({
          try: releaseController,
          catch: (cause) =>
            toHostOperationError(cause, "codex-live-session.release-runtime", {
              runtimeId: runtime.runtimeId,
            }),
        }).pipe(Effect.as(refs));
      }),
  };
};
