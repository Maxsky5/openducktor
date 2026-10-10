import { createWorkflowLaunchHold } from "./workflow-launch-hold";
import {
  type AgentSessionLiveEnvelope,
  type AgentSessionLiveReadResult,
  type AgentSessionLiveSnapshot,
  agentSessionContextUsageSchema,
  agentSessionLiveLoadDiffResultSchema,
  agentSessionLiveReadResultSchema,
  agentSessionLiveSnapshotSchema,
  isAgentSessionLiveStateEnvelope,
  type RuntimeKind,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { Clock, Effect } from "effect";
import { type HostError, HostInvariantError, HostValidationError } from "../../effect/host-errors";
import { createKeyedSharedFlight } from "../../effect/shared-flight";
import type {
  AgentSessionLiveAdapterChange,
  AgentSessionLiveAdapterPort,
  AgentSessionRuntimeAdapterPort,
  AgentSessionLiveAdapterScope,
} from "../../ports/agent-session-live-adapter-port";
import { AgentSessionResumeError } from "../../ports/agent-session-resume-error";
import { messageAcceptedFailure } from "../../ports/agent-session-send-error";
import {
  createAgentSessionLiveEnvelopePublisher,
  toAgentSessionLiveEnvelope,
} from "./agent-session-live-envelope";
import { createRuntimeSessionEngagement } from "./agent-session-runtime-engagement";
import { createLiveStateCoordinator } from "./live-state-coordinator";
import { createAgentSessionLiveRuntimeLifecycle } from "./agent-session-live-runtime-lifecycle";
import { parseAdapterOutput } from "./agent-session-live-validation";
import { createAgentSessionExecutionEpisodes } from "./agent-session-execution-episodes";
import {
  continuationSessionRef,
  toContinuationResolutionError,
} from "./agent-session-continuation-errors";

export type {
  AgentSessionLiveEnvelopePublisher,
  AgentSessionLiveFaultLogger,
} from "./agent-session-live-envelope";

export type {
  AgentSessionLiveStateService,
  CreateAgentSessionLiveStateServiceInput,
} from "./agent-session-live-state-service.types";
import type {
  AgentSessionLiveStateService,
  CreateAgentSessionLiveStateServiceInput,
} from "./agent-session-live-state-service.types";

export const createAgentSessionLiveStateService = ({
  adapterRegistry,
  runtimeAdmission,
  readSessionRootRefs,
  withProcessStartAdmission,
  faultLog,
  publish,
  observeNotificationInput,
  coordinator = createLiveStateCoordinator(),
  persistence,
}: CreateAgentSessionLiveStateServiceInput): AgentSessionLiveStateService => {
  // Controls enter the shared runtime only while its current generation is ready.
  const withStartAdmission =
    <Input extends { repoPath: string; runtimeKind: RuntimeKind }, Success>(
      operation: (input: Input) => Effect.Effect<Success, HostError>,
    ) =>
    (input: Input): Effect.Effect<Success, HostError> => {
      const admitted = runtimeAdmission.admit(input.runtimeKind, operation(input));
      return withProcessStartAdmission
        ? withProcessStartAdmission(input.repoPath, admitted)
        : admitted;
    };
  const observedRepoPaths = new Set<string>();
  // Native events keep a restored repository current, so attachments do not read it again.
  const restoredRepoPaths = new Set<string>();
  const restoration = createKeyedSharedFlight<string, void, HostError>();
  // Runtime reads can wait on the network, so they need a gate that does not block live events.
  const refreshGate = createLiveStateCoordinator();
  // Transient admission guard that spans the probe and the native continuation for one session.
  const continuationsInFlight = new Set<string>();
  const workflowLaunchHold = createWorkflowLaunchHold();
  const launchFailures = new Map<string, NonNullable<AgentSessionLiveSnapshot["launchFailure"]>>();
  const projectSnapshot = (snapshot: AgentSessionLiveSnapshot): AgentSessionLiveSnapshot => {
    const projected = workflowLaunchHold.project(snapshot);
    const launchFailure = launchFailures.get(agentSessionRefKey(snapshot.ref));
    return launchFailure ? { ...projected, launchFailure } : projected;
  };
  const executionEpisodes = createAgentSessionExecutionEpisodes();
  const engagement = createRuntimeSessionEngagement();
  // Numbers state changes in publication order, so an attachment can drop the ones its snapshot covers.
  let liveStateSequence = 0;
  const publishEnvelopeResult = createAgentSessionLiveEnvelopePublisher(
    (envelope) =>
      publish(
        isAgentSessionLiveStateEnvelope(envelope)
          ? { ...envelope, sequence: ++liveStateSequence }
          : envelope,
      ),
    faultLog,
    persistence,
  );
  const publishEnvelope = (envelope: AgentSessionLiveEnvelope) =>
    publishEnvelopeResult(envelope).pipe(
      Effect.flatMap((faultLogFailure) =>
        faultLogFailure ? Effect.fail(faultLogFailure) : Effect.void,
      ),
    );
  const publishChanges = (changes: ReadonlyArray<AgentSessionLiveAdapterChange>) =>
    Effect.gen(function* () {
      let faultLogFailure: HostError | null = null;
      // Release holds on removal even if an earlier publication fails.
      for (const change of changes) {
        if (change.type === "session_removed") workflowLaunchHold.release(change.ref);
      }
      for (const change of changes) {
        const projected = workflowLaunchHold.projectChange(change);
        if (!projected) continue;
        const envelope = executionEpisodes.accept(
          projected.type === "session_upsert"
            ? { type: "session_upsert", session: projectSnapshot(projected.snapshot) }
            : toAgentSessionLiveEnvelope(projected),
        );
        observeNotificationInput?.(envelope, change.provenance ?? "live");
        const result = yield* publishEnvelopeResult(envelope, change.provenance);
        if (faultLogFailure === null && result) {
          faultLogFailure = result;
        }
      }
      if (faultLogFailure) {
        return yield* Effect.fail(faultLogFailure);
      }
    });

  const readAdapterSnapshots = (
    adapters: ReadonlyArray<AgentSessionLiveAdapterPort>,
    include: (snapshot: AgentSessionLiveSnapshot) => boolean,
  ) =>
    Effect.gen(function* () {
      const snapshots = yield* Effect.forEach(adapters, (adapter) => adapter.listSnapshots());
      return yield* Effect.forEach(snapshots.flat().filter(include), (snapshot) =>
        parseAdapterOutput(agentSessionLiveSnapshotSchema, snapshot, "agent-session-live.list"),
      );
    });

  const listSnapshots = (repoPath: string) =>
    Effect.gen(function* () {
      const flattened = yield* readAdapterSnapshots(
        adapterRegistry.list(),
        (snapshot) => snapshot.ref.repoPath === repoPath,
      );
      const seen = new Set<string>();
      for (const snapshot of flattened) {
        const key = agentSessionRefKey(snapshot.ref);
        if (seen.has(key)) {
          return yield* Effect.fail(
            new HostInvariantError({
              invariant: "agent_session_live_snapshot_has_one_owner",
              message: `Multiple live runtimes projected session '${snapshot.ref.externalSessionId}' in '${snapshot.ref.workingDirectory}'.`,
              details: { ref: snapshot.ref },
            }),
          );
        }
        seen.add(key);
      }
      return executionEpisodes.replaceSnapshots(repoPath, flattened.map(projectSnapshot));
    });
  const refreshAdapters = (
    repoPath: string,
    adapters: ReadonlyArray<AgentSessionLiveAdapterPort>,
  ): Effect.Effect<void, HostError> =>
    Effect.gen(function* () {
      const roots = readSessionRootRefs ? yield* readSessionRootRefs(repoPath) : [];
      yield* Effect.forEach(
        adapters,
        (adapter) =>
          adapter.refreshSnapshots?.(
            repoPath,
            roots.filter((root) => root.runtimeKind === adapter.binding.runtimeKind),
          ) ?? Effect.void,
      );
    });
  // Run inside `refreshGate`. Observe the repository before listing adapters, so a runtime that
  // registers during the read restores this repository itself.
  const restoreRepository = (repoPath: string): Effect.Effect<void, HostError> =>
    Effect.gen(function* () {
      observedRepoPaths.add(repoPath);
      yield* refreshAdapters(repoPath, adapterRegistry.list());
      restoredRepoPaths.add(repoPath);
    });
  const lifecycle = createAgentSessionLiveRuntimeLifecycle({
    adapterRegistry,
    coordinator,
    publishChanges,
    publishEnvelope,
    listSnapshots,
    // A new shared runtime restores the exact roots of every repository a renderer observes.
    // A failed repository gets its own fault, so it cannot stop the runtime for the others.
    refreshSnapshots: (adapter) =>
      adapter.refreshSnapshots
        ? refreshGate.run(
            Effect.forEach([...observedRepoPaths], (repoPath) =>
              refreshAdapters(repoPath, [adapter]).pipe(
                Effect.catch((cause) => {
                  // The next attachment restores the repository again.
                  restoredRepoPaths.delete(repoPath);
                  return publishEnvelope({
                    type: "fault",
                    repoPath,
                    operation: "agent-session-live.restore-runtime-sessions",
                    message: `Cannot restore the ${adapter.binding.runtimeKind} sessions of this repository: ${cause.message}`,
                  });
                }),
              ),
            ),
          )
        : Effect.void,
    observedRepoPaths: () => [...observedRepoPaths],
    onDetach: workflowLaunchHold.releaseRuntime,
  });

  const readSession: AgentSessionLiveStateService["read"] = (input) =>
    Effect.gen(function* () {
      const adapter = yield* adapterRegistry.resolveForScope(input).pipe(
        Effect.map((value): AgentSessionLiveAdapterPort | null => value),
        Effect.catchTag("HostResourceError", () => Effect.succeed(null)),
      );
      if (!adapter) {
        return { type: "missing", ref: input } satisfies AgentSessionLiveReadResult;
      }
      const result = yield* adapter.readSnapshot(input);
      const parsed = yield* parseAdapterOutput(
        agentSessionLiveReadResultSchema,
        result,
        "agent-session-live.read",
      );
      if (parsed.type === "missing") return parsed;
      return {
        ...parsed,
        session: executionEpisodes.snapshotWithEpisode(projectSnapshot(parsed.session)),
      };
    });

  const runControl = <A>(
    scope: AgentSessionLiveAdapterScope,
    control: (adapter: AgentSessionRuntimeAdapterPort) => Effect.Effect<A, HostError>,
    isCommitted: (result: A) => boolean = () => false,
  ) =>
    Effect.gen(function* () {
      const adapter = engagement.trackControls(
        yield* adapterRegistry.resolveControlForScope(scope),
      );
      const result = yield* control(adapter);
      // A committed native change stays valid when the runtime detaches right after it.
      if (isCommitted(result)) return result;
      yield* lifecycle.requireAttached(adapter.binding);
      return result;
    });

  // A lifecycle action drains admitted controls. It stops and releases the sessions itself.
  const runAdmittedControl: typeof runControl = (scope, control, isCommitted) =>
    runtimeAdmission.admit(scope.runtimeKind, runControl(scope, control, isCommitted));

  const service: AgentSessionLiveStateService = {
    reportLaunchFailure: (ref, message) =>
      coordinator.run(
        Effect.gen(function* () {
          // Without a live session nothing shows the failure, so the caller must report it.
          const observed = yield* readSession(ref);
          if (observed.type !== "live") return null;
          const failure = {
            messageId: `launch-failure:${crypto.randomUUID()}`,
            message,
            timestamp: new Date(yield* Clock.currentTimeMillis).toISOString(),
          };
          launchFailures.set(agentSessionRefKey(ref), failure);
          // A launch failure is host state, not a runtime event, so it must not end the turn.
          yield* publishChanges([{ type: "session_upsert", snapshot: observed.session }]);
          return failure.messageId;
        }),
      ),
    publishTaskSessionRecords: (ref, records) =>
      coordinator.run(
        Effect.gen(function* () {
          // Bind ownership with current activity before a native event can pass this publication.
          const observed = yield* readSession(ref);
          const envelope: Extract<
            AgentSessionLiveEnvelope,
            { type: "task_session_records_updated" }
          > = {
            type: "task_session_records_updated",
            repoPath: ref.repoPath,
            ...records,
          };
          if (observed.type === "live") envelope.liveSession = observed.session;
          yield* publishEnvelope(envelope);
        }),
      ),
    holdWorkflowLaunch: (ref, held) =>
      coordinator.run(
        Effect.gen(function* () {
          const deferred = held ? undefined : workflowLaunchHold.release(ref);
          if (!held && !deferred) return;
          const adapter = yield* adapterRegistry.resolveForScope(ref);
          if (held) workflowLaunchHold.acquire(ref, adapter.binding);
          const result = yield* adapter.readSnapshot(ref);
          if (result.type === "live") {
            const changes: AgentSessionLiveAdapterChange[] = [
              { type: "session_upsert", snapshot: result.session },
            ];
            if (result.session.activity === "idle" && deferred) changes.push(...deferred);
            yield* publishChanges(changes);
          }
        }),
      ),
    attach: (input) =>
      Effect.gen(function* () {
        if (!restoredRepoPaths.has(input.repoPath)) {
          yield* restoration.run(
            input.repoPath,
            refreshGate.run(restoreRepository(input.repoPath)),
          );
        }
        return yield* coordinator.run(
          listSnapshots(input.repoPath).pipe(
            Effect.map((snapshots) => ({
              type: "snapshot" as const,
              repoPath: input.repoPath,
              sessions: [...snapshots],
              sequence: liveStateSequence,
            })),
          ),
        );
      }),
    refresh: (input) =>
      refreshGate.run(
        Effect.gen(function* () {
          yield* restoreRepository(input.repoPath);
          yield* coordinator.run(
            Effect.gen(function* () {
              const snapshots = yield* listSnapshots(input.repoPath);
              yield* publishEnvelope({
                type: "snapshot",
                repoPath: input.repoPath,
                sessions: [...snapshots],
              });
            }),
          );
        }),
      ),
    list: (input) => coordinator.run(listSnapshots(input.repoPath)),
    listRuntimeSessions: (runtimeKind) =>
      coordinator.run(
        Effect.forEach(
          adapterRegistry.list().filter((adapter) => adapter.binding.runtimeKind === runtimeKind),
          (adapter) =>
            readAdapterSnapshots([adapter], () => true).pipe(
              Effect.map((snapshots) => engagement.affected(adapter.binding, snapshots)),
            ),
        ).pipe(
          Effect.map((snapshots) =>
            snapshots.flat().map((snapshot) => executionEpisodes.snapshotWithEpisode(snapshot)),
          ),
        ),
      ),
    read: (input) => coordinator.run(readSession(input)),
    loadContext: (input) =>
      adapterRegistry.resolveForScope(input).pipe(
        Effect.flatMap((adapter) => adapter.loadContext(input)),
        Effect.flatMap((result) =>
          parseAdapterOutput(
            agentSessionContextUsageSchema.nullable(),
            result,
            "agent-session-live.load-context",
          ),
        ),
      ),
    loadSessionDiff: (input) =>
      adapterRegistry.resolveForScope(input).pipe(
        Effect.flatMap((adapter) => {
          if (!adapter.loadSessionDiff) {
            return Effect.fail(
              new HostValidationError({
                field: "runtimeKind",
                message: `Runtime '${input.runtimeKind}' does not expose live session diff state.`,
                details: { runtimeKind: input.runtimeKind },
              }),
            );
          }
          return adapter.loadSessionDiff(input);
        }),
        Effect.flatMap((result) =>
          parseAdapterOutput(
            agentSessionLiveLoadDiffResultSchema,
            result,
            "agent-session-live.load-diff",
          ),
        ),
      ),
    replyApproval: withStartAdmission((input) =>
      adapterRegistry
        .resolveForScope(input)
        .pipe(Effect.flatMap((adapter) => engagement.trackReplies(adapter).replyApproval(input))),
    ),
    replyQuestion: withStartAdmission((input) =>
      adapterRegistry
        .resolveForScope(input)
        .pipe(Effect.flatMap((adapter) => engagement.trackReplies(adapter).replyQuestion(input))),
    ),
    startSession: withStartAdmission((input) =>
      runControl(input, (adapter) => adapter.startSession(input)),
    ),
    resumeSession: withStartAdmission((input) =>
      runControl(input, (adapter) => adapter.resumeSession(input)),
    ),
    continueInterruptedTurn: withStartAdmission((input) =>
      Effect.gen(function* () {
        const adapter = yield* adapterRegistry.resolveControlForScope(input).pipe(
          Effect.map(engagement.trackControls),
          Effect.mapError((cause) => toContinuationResolutionError(cause, input)),
        );
        const continuationKey = [
          adapter.binding.runtimeId,
          input.externalSessionId,
          input.workingDirectory,
        ].join("\u0000");
        if (continuationsInFlight.has(continuationKey)) {
          return yield* Effect.fail(
            new AgentSessionResumeError({
              reason: "continuation_in_progress",
              sessionRef: continuationSessionRef(input),
              operation: "agent-session.continue-interrupted-turn",
              message: `Session '${input.externalSessionId}' already has a continuation in progress. Wait for it to settle, then retry Resume.`,
            }),
          );
        }
        continuationsInFlight.add(continuationKey);
        const summary = yield* adapter
          .continueInterruptedTurn(input)
          .pipe(Effect.ensuring(Effect.sync(() => continuationsInFlight.delete(continuationKey))));
        yield* lifecycle.requireAttached(adapter.binding).pipe(
          Effect.mapError(
            (cause) =>
              new AgentSessionResumeError({
                reason: "runtime_unavailable",
                sessionRef: continuationSessionRef(input),
                operation: "agent-session.continue-interrupted-turn",
                message: `${cause.message} The adapter already accepted the continuation, so the runtime can be working on it.`,
                nextAction:
                  "Inspect the runtime and this session. Retry Resume only if the turn is still unfinished.",
                cause,
              }),
          ),
        );
        return summary;
      }),
    ),
    forkSession: withStartAdmission((input) =>
      runControl(input, (adapter) => adapter.forkSession(input)),
    ),
    sendUserMessage: (input, options) =>
      withStartAdmission((input: Parameters<AgentSessionLiveStateService["sendUserMessage"]>[0]) =>
        Effect.gen(function* () {
          const adapter = engagement.trackControls(
            yield* adapterRegistry.resolveControlForScope(input),
          );
          const acceptedMessage = yield* adapter.sendUserMessage(input, options);
          launchFailures.delete(agentSessionRefKey(input));
          yield* lifecycle
            .requireAttached(adapter.binding)
            .pipe(Effect.mapError(messageAcceptedFailure(input, acceptedMessage)));
          return acceptedMessage;
        }),
      )(input),
    updateSessionModel: (input) =>
      runAdmittedControl(input, (adapter) => adapter.updateSessionModel(input)),
    updateSessionTitle: (input) =>
      runAdmittedControl(
        input,
        (adapter) => adapter.updateSessionTitle(input),
        (outcome) => outcome.status === "renamed",
      ),
    stopSession: (input) =>
      runControl(input, (adapter) => adapter.stopSession(input)).pipe(
        Effect.andThen(service.holdWorkflowLaunch(input, false)),
      ),
    releaseSession: (input) =>
      runControl(input, (adapter) => adapter.releaseSession(input)).pipe(
        Effect.andThen(service.holdWorkflowLaunch(input, false)),
      ),
    registerRuntimeAdapter: lifecycle.registerRuntimeAdapter,
    releaseRuntime: lifecycle.releaseRuntime,
    createRuntimeRegistration: lifecycle.createRuntimeRegistration,
  };
  return service;
};
